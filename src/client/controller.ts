/**
 * The aggregated-search card's controller: the staged queue over the
 * `web-search-aggregation` settings namespace, projected into one snapshot
 * the card's slot entry injects.
 *
 * The queue is ONE structured section field (`providers`), staged whole: the
 * draft lives here until the card's save writes it in one `scope.set`. A
 * provider kind appears at most once, and each entry owns exactly one
 * credential — the kind's fixed `XXX_API_KEY` reference — whose value holds
 * all the provider's keys joined by `,`. Keys are added one at a time through
 * the card's input (+ or Enter); each becomes a masked, closable tag, and the
 * tag order IS the order a save writes and the runtime reads. Key literals
 * never enter the section, and the credentials API is value-free on read
 * (presence facts only), so stored literals are never echoed back — a save
 * REPLACES the credential's whole value, and removing every tag clears it.
 *
 * @module dsh-web-search-aggregation/client/controller
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { formatApiKeys, maskApiKey, parseApiKeys } from '../keys.ts'
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
    baseURL?: string
  }>
  /** Per-attempt timeout (ms). */
  attemptTimeoutMs?: number
}

/** Provider kinds the card can add, in the display order the select shows. */
export const PROVIDER_KINDS = ['anysearch', 'tinyfish', 'tavily'] as const

/** One provider kind. */
export type ProviderKind = typeof PROVIDER_KINDS[number]

/**
 * The single credential reference each kind reads (client copy of the Host's
 * `DEFAULT_KEY_REF`): its value is the provider's keys joined by `,`.
 */
export const KIND_CREDENTIAL_REF: Readonly<Record<ProviderKind, string>> = {
  anysearch: 'ANYSEARCH_API_KEY',
  tinyfish: 'TINYFISH_API_KEY',
  tavily: 'TAVILY_API_KEY',
}

/** Accepted per-attempt timeout range, mirrored from the Host schema. */
const TIMEOUT_MIN = 1000
const TIMEOUT_MAX = 60000

/** The editable form of one queue entry while staged. */
export interface EntryDraft {
  kind: ProviderKind
  enabled: boolean
  /** Endpoint override; empty = the adapter default. */
  baseURL: string
  /**
   * The staged key list for the kind's credential, in the exact order a save
   * writes and the runtime reads, or `undefined` while untouched (the stored
   * credential stays as-is). `[]` means "clear the stored keys".
   */
  keysDraft: string[] | undefined
}

/** What the card renders for one entry. */
export interface EntryView {
  /** Queue position (1-based) as shown in the entry header. */
  position: number
  kind: ProviderKind
  enabled: boolean
  baseURL: string
  /** The entry's one credential control: fixed ref, masked key tags, presence. */
  keys: {
    /** The kind's fixed credential reference (`TAVILY_API_KEY`, …). */
    ref: string
    /** The staged keys as masked tags, in storage order. */
    tags: string[]
    /** Whether a save would write the credential. */
    staged: boolean
    /** Whether any layer supplies a value for the reference. */
    configured: boolean | undefined
  }
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
  /** Append one entry of `kind` at the queue's end (no-op when already queued). */
  addEntry: (kind: ProviderKind) => void
  /** Change one entry's provider kind (no-op when another entry already uses it). */
  setKind: (index: number, kind: ProviderKind) => void
  /** Toggle one entry's enabled flag. */
  setEnabled: (index: number, enabled: boolean) => void
  /** Stage one entry's endpoint override (empty = default). */
  setBaseURL: (index: number, text: string) => void
  /**
   * Append one key (or a comma-joined batch pasted into the input) to the
   * entry's staged list: trimmed, split on `,`, empties and keys already
   * staged dropped. The tag order IS the stored and runtime order.
   */
  addKey: (index: number, literal: string) => void
  /** Remove the staged key at `keyIndex`; removing the last one stages a clear. */
  removeKey: (index: number, keyIndex: number) => void
  /** Drop the entry's staged key list, leaving the stored credential as-is. */
  resetKeys: (index: number) => void
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
   * @param api - wire face used for the key values the entries write.
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
        // One provider can be queued once: refuse a kind that is already there.
        if (this.entries.some(entry => entry.kind === kind)) return
        this.assign([...this.entries, { kind, enabled: true, baseURL: '', keysDraft: undefined }])
      },
      setKind: (index, kind) => {
        // Same rule on edit: the kind's single credential would otherwise
        // be claimed by two entries.
        if (this.entries.some((entry, position) => position !== index && entry.kind === kind)) return
        this.mutate(index, entry => ({ ...entry, kind }))
      },
      setEnabled: (index, enabled) => {
        this.mutate(index, entry => ({ ...entry, enabled }))
      },
      setBaseURL: (index, text) => {
        this.mutate(index, entry => ({ ...entry, baseURL: text }))
      },
      addKey: (index, literal) => {
        this.mutate(index, entry => {
          const additions = parseApiKeys(literal)
          if (additions.length === 0) return entry
          const next = [...(entry.keysDraft ?? [])]
          // A duplicate literal would double-count one key in rotation.
          for (const key of additions) {
            if (!next.includes(key)) next.push(key)
          }
          return { ...entry, keysDraft: next }
        })
      },
      removeKey: (index, keyIndex) => {
        this.mutate(index, entry => {
          if (entry.keysDraft === undefined) return entry
          return { ...entry, keysDraft: entry.keysDraft.filter((_, position) => position !== keyIndex) }
        })
      },
      resetKeys: (index) => {
        this.mutate(index, entry => entry.keysDraft === undefined ? entry : { ...entry, keysDraft: undefined })
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
   * Write the staged queue: each entry's staged key value through the
   * credentials domain first (so the reference the section implies already
   * resolves), then the section fields, staged resets included. A failure
   * keeps every draft for correcting.
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
      if (entry.keysDraft === undefined) continue
      const ref = KIND_CREDENTIAL_REF[entry.kind]
      try {
        // The staged list is already clean (addKey trims and drops empties);
        // write it as the whole comma-joined replacement, in tag order.
        const joined = formatApiKeys(entry.keysDraft)
        if (joined.length > 0) {
          await this.api.credentials.set({ ref, value: joined })
        } else {
          // Every tag removed: clear the provider's single credential.
          await this.api.credentials.unset({ ref })
        }
      } catch (_credentialWriteFailure) {
        // The Host refused (read-only shadow, locked store): surface via
        // the badge re-read and keep the draft for correcting.
        landed = false
      }
    }
    if (landed) {
      // The key values are durably in the credentials domain; drop them from
      // the drafts so the card stops reporting a pending write.
      for (const entry of this.entries) entry.keysDraft = undefined
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
    // Faithful seeding (duplicates included): a hand-edited duplicate kind is
    // flagged per entry and blocks saving, mirroring the old duplicate-ref UX.
    return (rows ?? []).map(entry => ({
      kind: entry.kind,
      enabled: entry.enabled,
      baseURL: entry.baseURL ?? '',
      keysDraft: undefined,
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

  /** The entries as a save writes them: trimmed, defaulted, credential-free. */
  private committedEntries(): Array<{
    kind: ProviderKind
    enabled: boolean
    baseURL?: string
  }> {
    return this.entries.map(entry => {
      const baseURL = entry.baseURL.trim()
      return {
        kind: entry.kind,
        enabled: entry.enabled,
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
    const kinds = new Set<ProviderKind>()
    for (const entry of this.entries) {
      if (kinds.has(entry.kind)) return `duplicate provider kind ${entry.kind}`
      kinds.add(entry.kind)
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
        ...baseURL !== undefined && baseURL.length > 0 ? { baseURL } : {},
      }
    })
  }

  /** Whether any staged entry still holds an unwritten key value. */
  private pendingKeys(): boolean {
    return this.entries.some(entry => entry.keysDraft !== undefined)
  }

  /** The controller's projection; `dirty` also honors staged key values. */
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
        keys: {
          ref: KIND_CREDENTIAL_REF[entry.kind],
          tags: (entry.keysDraft ?? []).map(key => maskApiKey(key)),
          staged: entry.keysDraft !== undefined,
          configured: this.credentials.get(KIND_CREDENTIAL_REF[entry.kind])?.configured,
        },
        invalidReason: this.entries.some((other, position) => position < index && other.kind === entry.kind)
          ? 'duplicate-kind'
          : undefined,
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
      ...this.entries.map(entry => KIND_CREDENTIAL_REF[entry.kind]),
      ...(this.section().providers ?? []).map(entry => KIND_CREDENTIAL_REF[entry.kind]),
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

  /** Notify every bound stores. */
  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
