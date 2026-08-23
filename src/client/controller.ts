/**
 * The aggregated-search card's controller: the staged queue over the
 * `web-search-aggregation` settings namespace, projected into one snapshot
 * the card's slot entry injects.
 *
 * The queue is ONE structured section field (`providers`), staged whole: the
 * draft lives here until the card's save writes it in one `scope.set`. Key
 * literals never enter the section — adding a key stages its literal here and
 * the save writes it through the credentials domain, addressed by the
 * reference the queue names. Presence facts for those references come back
 * through `credentials.describe`, never the values.
 *
 * @module dsh-web-search-aggregation/client/controller
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { CardFieldState, CardShell, CredentialBadge, SnapshotStore } from './form.ts'

/**
 * Settings namespace this card edits. Spelled here rather than imported: a
 * client package must not depend on a Host package.
 */
export const WEB_SEARCH_AGGREGATION_NS = 'web-search-aggregation'

/** The section fields this card edits (mirrors the Host schema). */
export interface AggregatedSettingsSection {
  /** The prioritized queue; the resolved section always carries it. */
  providers?: Array<{
    kind: 'anysearch' | 'tinyfish' | 'tavily'
    enabled: boolean
    apiKeyRefs: string[]
    baseURL?: string
  }>
  /** Per-attempt timeout (ms). */
  attemptTimeoutMs?: number
}

/** Provider kinds the card can add, in the display order the select shows. */
export const PROVIDER_KINDS = ['anysearch', 'tinyfish', 'tavily'] as const

/** One provider kind. */
export type ProviderKind = typeof PROVIDER_KINDS[number]

/** Credential-reference grammar, mirrored from the Host credential seam. */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Accepted per-attempt timeout range, mirrored from the Host schema. */
const TIMEOUT_MIN = 1000
const TIMEOUT_MAX = 60000

/** One key literal staged for one entry; written through credentials on save. */
interface StagedKey {
  /** Reference the literal will be stored under. */
  ref: string
  /** The staged literal; empty means the reference is registered without a write. */
  literal: string
}

/** The editable form of one queue entry while staged. */
export interface EntryDraft {
  kind: ProviderKind
  enabled: boolean
  /** References as the queue names them, chips in this order. */
  apiKeyRefs: string[]
  /** Endpoint override; empty = the adapter default. */
  baseURL: string
  /** Key literals staged for this entry, keyed by reference. */
  staged: StagedKey[]
}

/** What the card renders for one entry. */
export interface EntryView {
  /** Queue position (1-based) as shown in the entry header. */
  position: number
  kind: ProviderKind
  enabled: boolean
  baseURL: string
  /** Key chips in queue order, each with its presence facts. */
  keys: Array<{ ref: string, configured: boolean | undefined, staged: boolean }>
  /** Why this entry blocks saving, when it does. */
  invalidReason: string | undefined
}

/** What the aggregated card renders. */
export interface AggregatedCardState extends CardShell {
  /** Per-attempt timeout control. */
  timeout: CardFieldState
  /** The staged queue, in priority order. */
  entries: EntryView[]
  /** Whether the user layer overrides the whole queue (enables the reset). */
  queueOverridden: boolean
}

/** The card's mutation and form actions, injected by the slot entry. */
export interface AggregatedCardActions {
  /** Stage a timeout draft; empty re-inherits the default. */
  editTimeout: (text: string) => void
  /** Clear the timeout's user-layer entry. */
  resetTimeout: () => void
  /** Move one entry one slot up (-1) or down (+1). */
  moveEntry: (index: number, direction: -1 | 1) => void
  /** Remove one entry from the queue. */
  removeEntry: (index: number) => void
  /** Append one entry of `kind` at the queue's end. */
  addEntry: (kind: ProviderKind) => void
  /** Change one entry's provider kind. */
  setKind: (index: number, kind: ProviderKind) => void
  /** Toggle one entry's enabled flag. */
  setEnabled: (index: number, enabled: boolean) => void
  /** Stage one entry's endpoint override (empty = default). */
  setBaseURL: (index: number, text: string) => void
  /**
   * Stage one key for an entry: the reference joins the queue immediately,
   * and the literal (when non-empty) is written through credentials on save.
   */
  stageKey: (index: number, ref: string, literal: string) => void
  /** Drop one reference from an entry, staged literal included. */
  removeKey: (index: number, ref: string) => void
  /** Clear the queue's user-layer entry, re-inheriting the shipped default. */
  resetQueue: () => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** The registration-side face the card's slot entry injects. */
export interface AggregatedCardFace extends AggregatedCardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useAggregatedCard. */
    aggregatedCard: SnapshotStore<AggregatedCardState>
  }
}

/**
 * Bridges the `web-search-aggregation` scope and the credentials domain onto
 * the card. The staged queue and the committed section are compared through
 * one normalization so reformatting-only edits never read dirty.
 */
export class AggregatedCardController {
  private entries: EntryDraft[]
  private entriesDrafted = false
  private timeoutDraft: string | undefined
  /** Staged resets, applied by the save like every other edit. */
  private timeoutReset = false
  private queueReset = false
  private saving = false
  private failed = false
  private credentials = new Map<string, CredentialBadge>()
  private readonly listeners = new Set<() => void>()

  /**
   * @param scope - the bound settings scope for the `web-search-aggregation` namespace.
   * @param api - wire face used for the key literals the queue references.
   */
  constructor(
    private readonly scope: SettingsScope<AggregatedSettingsSection>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.entries = this.seed(this.scope.getSnapshot())
    this.scope.subscribe(() => {
      // A scope change while the user is mid-edit is the section moving under
      // the drafts (another surface, a save landing): drafts win until the
      // user saves or discards, mirroring the shipped card-form semantics.
      // While THIS card's save is crossing the wire its own writes reseed
      // nothing — the post-save bookkeeping owns the drafts.
      if (this.saving || this.entriesDrafted || this.queueReset) return
      this.reseed()
      void this.readCredentials()
    })
    void this.readCredentials()
  }

  /** Bind one projection of this controller as a snapshot store. */
  bind(): SnapshotStore<AggregatedCardState> {
    let last = this.projection()
    const listeners = new Set<() => void>()
    const store: SnapshotStore<AggregatedCardState> = {
      getSnapshot: () => last,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (next) => {
        last = next
        for (const listener of listeners) listener()
      },
    }
    this.listeners.add(() => { store.set(this.projection()) })
    return store
  }

  /** The card's actions. */
  actions(): AggregatedCardActions {
    return {
      editTimeout: (text) => {
        this.timeoutDraft = text
        this.timeoutReset = false
        this.failed = false
        this.publish()
      },
      resetTimeout: () => {
        // Staged like every edit: the badge flips now, the write happens at save.
        this.timeoutReset = true
        this.timeoutDraft = undefined
        this.failed = false
        this.publish()
      },
      moveEntry: (index, direction) => {
        const target = index + direction
        if (index < 0 || target < 0 || target >= this.entries.length) return
        const next = [...this.entries]
        const [moved] = next.splice(index, 1)
        if (moved === undefined) return
        next.splice(target, 0, moved)
        this.assign(next)
      },
      removeEntry: (index) => {
        this.assign(this.entries.filter((_, position) => position !== index))
      },
      addEntry: (kind) => {
        this.assign([...this.entries, { kind, enabled: true, apiKeyRefs: [], baseURL: '', staged: [] }])
      },
      setKind: (index, kind) => {
        this.mutate(index, entry => ({ ...entry, kind }))
      },
      setEnabled: (index, enabled) => {
        this.mutate(index, entry => ({ ...entry, enabled }))
      },
      setBaseURL: (index, text) => {
        this.mutate(index, entry => ({ ...entry, baseURL: text }))
      },
      stageKey: (index, ref, literal) => {
        const trimmed = ref.trim()
        if (trimmed.length === 0) return
        this.mutate(index, entry => ({
          ...entry,
          apiKeyRefs: [...entry.apiKeyRefs.filter(existing => existing !== trimmed), trimmed],
          staged: [...entry.staged.filter(existing => existing.ref !== trimmed), { ref: trimmed, literal }],
        }))
      },
      removeKey: (index, ref) => {
        this.mutate(index, entry => ({
          ...entry,
          apiKeyRefs: entry.apiKeyRefs.filter(existing => existing !== ref),
          staged: entry.staged.filter(existing => existing.ref !== ref),
        }))
      },
      resetQueue: () => {
        // Staged: the projection re-seeds from the base layer until saved.
        this.queueReset = true
        this.entriesDrafted = false
        this.entries = this.seed(this.scope.getSnapshot(), true)
        this.failed = false
        this.publish()
      },
      save: () => { void this.save() },
      discard: () => {
        this.entriesDrafted = false
        this.queueReset = false
        this.timeoutDraft = undefined
        this.timeoutReset = false
        this.reseed()
        this.failed = false
        this.publish()
      },
    }
  }

  /**
   * Re-read presence facts after the Host reports a change to a reference
   * this card shows (a key written from another surface, e.g. the Models page).
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (this.credentials.has(ref)) void this.readCredentials()
  }

  /** Build the face the card's slot registration injects. */
  inject(): AggregatedCardFace {
    return { hooks: { aggregatedCard: this.bind() }, ...this.actions() }
  }

  /**
   * Write the staged queue: key literals through the credentials domain
   * first (so references the section is about to name already resolve), then
   * the section fields, staged resets included. A failure keeps every draft
   * for correcting.
   */
  private async save(): Promise<void> {
    if (this.saving || (!this.dirty() && !this.pendingKeys()) || this.invalidReason() !== undefined) return
    this.saving = true
    this.failed = false
    this.publish()
    // The scope subscriber reseeds drafts on every commit this save makes
    // itself; a pure timeout edit would be wiped by its own providers write.
    // Freeze the staged timeout across the writes and re-apply afterwards.
    const stagedTimeoutReset = this.timeoutReset
    const stagedTimeoutDraft = this.timeoutDraft
    let landed = true
    for (const entry of this.entries) {
      for (const staged of entry.staged) {
        if (staged.literal.length === 0) continue
        try {
          await this.api.credentials.set({ ref: staged.ref, value: staged.literal })
        } catch (_credentialWriteFailure) {
          // The Host refused (read-only shadow, locked store): surface via
          // the badge re-read and keep the draft for correcting.
          landed = false
        }
      }
    }
    if (landed) {
      // The literals are durably in the credentials domain; drop them from
      // the drafts so the card stops reporting a pending write.
      for (const entry of this.entries) entry.staged = []
      if (this.queueReset) {
        try {
          await this.scope.unset('providers')
        } catch (_queueResetFailure) {
          landed = false
        }
        if (landed) {
          const userLayer = this.scope.getSnapshot().user as Record<string, unknown> | undefined
          landed = userLayer === undefined || !Object.hasOwn(userLayer, 'providers')
        }
      } else {
        const value = this.committedEntries()
        try {
          await this.scope.set('providers', value)
        } catch (_queueWriteFailure) {
          // The Host refused the write: keep the drafts, flag the failure.
          landed = false
        }
        if (landed) {
          const userLayer = this.scope.getSnapshot().user as Record<string, unknown> | undefined
          landed = JSON.stringify(userLayer?.providers) === JSON.stringify(value)
        }
      }
      if (landed && stagedTimeoutReset) {
        await this.scope.unset('attemptTimeoutMs')
      } else if (landed && stagedTimeoutDraft !== undefined) {
        const trimmed = stagedTimeoutDraft.trim()
        const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined
        const timeout = parsed !== undefined && parsed >= TIMEOUT_MIN && parsed <= TIMEOUT_MAX ? parsed : undefined
        if (timeout === undefined) await this.scope.unset('attemptTimeoutMs')
        else await this.scope.set('attemptTimeoutMs', timeout)
      }
    }
    if (landed) {
      this.entriesDrafted = false
      this.queueReset = false
      this.timeoutDraft = undefined
      this.timeoutReset = false
    } else {
      this.failed = true
    }
    this.saving = false
    this.publish()
    void this.readCredentials()
  }

  /** The section's current committed value. */
  private section(): AggregatedSettingsSection {
    return this.scope.getSnapshot().value ?? {}
  }

  /** Re-seed the staged queue from the section unless edits are in flight. */
  private reseed(): void {
    this.entries = this.seed(this.scope.getSnapshot())
    this.timeoutDraft = undefined
    this.timeoutReset = false
  }

  /** Seed drafts from one scope snapshot; `fromBase` reads the base layer (a staged queue reset). */
  private seed(snapshot: SettingsScopeSnapshot<AggregatedSettingsSection>, fromBase = false): EntryDraft[] {
    const rows = fromBase
      ? (snapshot.base as AggregatedSettingsSection | undefined)?.providers
      : snapshot.value?.providers
    return (rows ?? []).map(entry => ({
      kind: entry.kind,
      enabled: entry.enabled,
      apiKeyRefs: [...entry.apiKeyRefs],
      baseURL: entry.baseURL ?? '',
      staged: [],
    }))
  }

  /** Record a whole-queue replacement as a draft. */
  private assign(entries: EntryDraft[]): void {
    this.entries = entries
    this.entriesDrafted = true
    this.queueReset = false
    this.failed = false
    this.publish()
  }

  /** Record one entry's replacement as a draft. */
  private mutate(index: number, replace: (entry: EntryDraft) => EntryDraft): void {
    if (index < 0 || index >= this.entries.length) return
    const next = [...this.entries]
    const current = next[index]
    if (current === undefined) return
    next[index] = replace(current)
    this.assign(next)
  }

  /** The entries as a save writes them: trimmed, defaulted, literal-free. */
  private committedEntries(): Array<{
    kind: ProviderKind
    enabled: boolean
    apiKeyRefs: string[]
    baseURL?: string
  }> {
    return this.entries.map(entry => {
      const baseURL = entry.baseURL.trim()
      return {
        kind: entry.kind,
        enabled: entry.enabled,
        apiKeyRefs: entry.apiKeyRefs.map(ref => ref.trim()).filter(ref => ref.length > 0),
        ...baseURL.length > 0 ? { baseURL } : {},
      }
    })
  }

  /** The staged timeout as a save writes it; `undefined` re-inherits the default. */
  private timeoutValue(): number | undefined {
    if (this.timeoutDraft === undefined) return undefined
    const trimmed = this.timeoutDraft.trim()
    if (trimmed.length === 0) return undefined
    if (!/^\d+$/.test(trimmed)) return undefined
    const value = Number(trimmed)
    return value >= TIMEOUT_MIN && value <= TIMEOUT_MAX ? value : undefined
  }

  /** Whether the staged timeout draft is present but not acceptable. */
  private timeoutInvalid(): boolean {
    if (this.timeoutDraft === undefined) return false
    const trimmed = this.timeoutDraft.trim()
    if (trimmed.length === 0) return false
    if (!/^\d+$/.test(trimmed)) return true
    const value = Number(trimmed)
    return value < TIMEOUT_MIN || value > TIMEOUT_MAX
  }

  /** The first reason the staged queue blocks a save, or undefined. */
  private invalidReason(): string | undefined {
    if (this.timeoutInvalid()) return 'attemptTimeoutMs'
    for (const entry of this.entries) {
      const refs = entry.apiKeyRefs.map(ref => ref.trim())
      if (refs.some(ref => ref.length === 0 || !REF_PATTERN.test(ref))) {
        return `invalid credential reference in ${entry.kind}`
      }
      if (new Set(refs).size !== refs.length) {
        return `duplicate credential reference in ${entry.kind}`
      }
    }
    return undefined
  }

  /** Whether anything staged differs from the committed section. */
  private dirty(): boolean {
    if (this.queueReset) return true
    if (this.timeoutReset) return true
    if (this.timeoutDraft !== undefined && this.timeoutValue() !== this.section().attemptTimeoutMs) {
      return true
    }
    return JSON.stringify(this.committedEntries()) !== JSON.stringify(this.normalizedSection())
  }

  /** The section's queue normalized exactly like {@link committedEntries}. */
  private normalizedSection(): Array<Record<string, unknown>> {
    return (this.section().providers ?? []).map(entry => {
      const baseURL = entry.baseURL?.trim()
      return {
        kind: entry.kind,
        enabled: entry.enabled,
        apiKeyRefs: entry.apiKeyRefs.map(ref => ref.trim()).filter(ref => ref.length > 0),
        ...baseURL !== undefined && baseURL.length > 0 ? { baseURL } : {},
      }
    })
  }

  /** Whether any staged entry still holds an unwritten key literal. */
  private pendingKeys(): boolean {
    return this.entries.some(entry => entry.staged.some(staged => staged.literal.length > 0))
  }

  /** The controller's projection; `dirty` also honors staged literals. */
  private projection(): AggregatedCardState {
    const snapshot = this.scope.getSnapshot()
    const invalid = this.invalidReason()
    const committed = this.section().attemptTimeoutMs
    const baseTimeout = (snapshot.base as AggregatedSettingsSection | undefined)?.attemptTimeoutMs ?? 15000
    const timeoutText = this.timeoutReset
      ? String(baseTimeout)
      : this.timeoutDraft !== undefined
        ? this.timeoutDraft
        : committed === undefined ? String(15000) : String(committed)
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.dirty() || this.pendingKeys(),
      invalid: invalid !== undefined,
      saving: this.saving,
      failed: this.failed,
      timeout: {
        text: timeoutText,
        overridden: this.timeoutReset
          || Object.hasOwn((snapshot.user ?? {}) as Record<string, unknown>, 'attemptTimeoutMs'),
        invalid: this.timeoutInvalid(),
      },
      entries: this.entries.map((entry, index) => ({
        position: index + 1,
        kind: entry.kind,
        enabled: entry.enabled,
        baseURL: entry.baseURL,
        keys: entry.apiKeyRefs.map(ref => ({
          ref,
          configured: this.credentials.get(ref.trim())?.configured,
          staged: entry.staged.some(staged => staged.ref === ref && staged.literal.length > 0),
        })),
        invalidReason: entryInvalidReason(entry),
      })),
      queueOverridden: this.queueReset
        || Object.hasOwn((snapshot.user ?? {}) as Record<string, unknown>, 'providers'),
    }
  }

  /**
   * Read presence facts for every reference the drafts or the section name.
   * Failures keep the last known badges — the card stays usable and a save
   * still reaches the Host.
   */
  private async readCredentials(): Promise<void> {
    const refs = [...new Set([
      ...this.committedEntries().flatMap(entry => entry.apiKeyRefs),
      ...(this.section().providers ?? []).flatMap(entry => entry.apiKeyRefs),
    ])]
    if (refs.length === 0) return
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs })
    } catch (_credentialReadFailure) {
      return
    }
    if (!response.result.ok) return
    for (const ref of refs) {
      const view = response.result.value.credentials[ref]
      this.credentials.set(ref, {
        configured: view?.configured ?? false,
        writable: view?.writable ?? true,
      })
    }
    this.publish()
  }

  /** Notify every bound store. */
  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

/** The first reason one entry blocks a save, when it does. */
function entryInvalidReason(entry: EntryDraft): string | undefined {
  const refs = entry.apiKeyRefs.map(ref => ref.trim())
  if (refs.some(ref => ref.length === 0 || !REF_PATTERN.test(ref))) return 'invalid-reference'
  if (new Set(refs).size !== refs.length) return 'duplicate-reference'
  return undefined
}
