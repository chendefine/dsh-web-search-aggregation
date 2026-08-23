import { describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import { AggregatedCardController, type AggregatedSettingsSection } from '../src/client/controller.ts'
import type { CardShell } from '../src/client/form.ts'

/** A minimal settings scope over one in-memory document, matching the client contract's read face. */
export interface ScopeOptions {
  base?: AggregatedSettingsSection
  user?: Record<string, unknown>
}

export class FakeScope {
  private snapshotState: {
    status: 'ready'
    writable: boolean
    value: AggregatedSettingsSection | undefined
    base: AggregatedSettingsSection | undefined
    user: Record<string, unknown> | undefined
  }
  private readonly listeners = new Set<() => void>()

  constructor(options: ScopeOptions = {}) {
    const user = options.user
    const value = { ...(options.base ?? {}), ...(user as AggregatedSettingsSection | undefined) }
    this.snapshotState = { status: 'ready', writable: true, value, base: options.base, user }
  }

  getSnapshot() {
    return this.snapshotState
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<void> {
    const user = { ...(this.snapshotState.user ?? {}) }
    user[field] = value
    this.commit(user)
  }

  async unset(field: string): Promise<void> {
    const user = { ...(this.snapshotState.user ?? {}) }
    delete user[field]
    this.commit(user)
  }

  private commit(user: Record<string, unknown>): void {
    const value = { ...(this.snapshotState.base ?? {}), ...(user as AggregatedSettingsSection) }
    this.snapshotState = { ...this.snapshotState, value, user }
    for (const listener of this.listeners) listener()
  }
}

/** The credentials wire face as the controller uses it. */
/** The credentials wire face as the controller uses it (rpc plumbing faked as never). */
export function fakeCredentials(): Pick<IApiClient, 'credentials'> {
  const set = vi.fn(async (_request: { ref: string, value: string }) => ({} as never))
  const unset = vi.fn(async (_request: { ref: string }) => ({} as never))
  const describe = vi.fn(async (request: { refs: string[] }) => ({
    rpcId: 'test' as never,
    result: {
      ok: true as const,
      value: {
        credentials: Object.fromEntries(request.refs.map(ref => [ref, { configured: ref.includes('OK'), writable: true }])),
      },
    },
  }) as never)
  return { credentials: { set, unset, describe } }
}

export function defaultSection(): ScopeOptions {
  return {
    base: {
      providers: [
        { kind: 'anysearch', enabled: true, apiKeyRefs: ['ANYSEARCH_API_KEY'] },
        { kind: 'tavily', enabled: true, apiKeyRefs: ['TAVILY_API_KEY'] },
      ],
      attemptTimeoutMs: 15000,
    },
  }
}

async function settled(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('AggregatedCardController', () => {
  it('projects the committed queue with position and kinds', async () => {
    const scope = new FakeScope(defaultSection())
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const state = controller.inject().hooks.aggregatedCard.getSnapshot()
    expect(state.available).toBe(true)
    expect(state.entries.map(entry => entry.kind)).toEqual(['anysearch', 'tavily'])
    expect(state.entries[0]?.position).toBe(1)
    expect(state.timeout.text).toBe('15000')
    expect(state.dirty).toBe(false)
  })

  it('stages a key: chip appears, dirty flips, save writes the literal through credentials then the queue', async () => {
    const scope = new FakeScope(defaultSection())
    const api = fakeCredentials()
    const controller = new AggregatedCardController(scope as never, api)
    await settled()
    const face = controller.inject()
    face.stageKey(1, 'TAVILY_API_KEY_2', 'tvly-literal')
    let state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.dirty).toBe(true)
    expect(state.entries[1]?.keys.map(key => key.ref)).toContain('TAVILY_API_KEY_2')

    face.save()
    await settled()
    // The literal went through the credentials domain, keyed by its ref.
    expect(api.credentials.set).toHaveBeenCalledWith({ ref: 'TAVILY_API_KEY_2', value: 'tvly-literal' })
    // And the queue landed in the user layer with the new ref appended.
    const user = scope.getSnapshot().user as Record<string, unknown> | undefined
    const providers = user?.providers as Array<{ apiKeyRefs: string[] }>
    expect(providers?.[1]?.apiKeyRefs).toEqual(['TAVILY_API_KEY', 'TAVILY_API_KEY_2'])
    state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.dirty).toBe(false)
  })

  it('reorders, disables, and removes entries as staged drafts', async () => {
    const scope = new FakeScope(defaultSection())
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const face = controller.inject()
    face.moveEntry(1, -1)
    expect(face.hooks.aggregatedCard.getSnapshot().entries.map(entry => entry.kind))
      .toEqual(['tavily', 'anysearch'])
    face.setEnabled(0, false)
    expect(face.hooks.aggregatedCard.getSnapshot().entries[0]?.enabled).toBe(false)
    face.removeEntry(0)
    expect(face.hooks.aggregatedCard.getSnapshot().entries.map(entry => entry.kind)).toEqual(['anysearch'])
    face.discard()
    expect(face.hooks.aggregatedCard.getSnapshot().entries.map(entry => entry.kind)).toEqual(['anysearch', 'tavily'])
  })

  it('blocks saving on an invalid credential reference and reports why', async () => {
    const scope = new FakeScope(defaultSection())
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const face = controller.inject()
    face.stageKey(0, '1BAD-REF', 'lit')
    const state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.invalid).toBe(true)
    expect(state.entries[0]?.invalidReason).toBe('invalid-reference')
  })

  it('blocks saving on a duplicate credential reference within one entry', async () => {
    // re-staging an existing reference replaces its literal rather than duplicating it…
    const scope = new FakeScope(defaultSection())
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const face = controller.inject()
    face.stageKey(0, 'ANYSEARCH_API_KEY', 'x')
    face.stageKey(0, 'ANYSEARCH_API_KEY', 'y')
    let state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.entries[0]?.keys.map(key => key.ref)).toEqual(['ANYSEARCH_API_KEY'])
    expect(state.entries[0]?.keys[0]?.staged).toBe(true)
    expect(state.entries[0]?.invalidReason).toBeUndefined()
    // …but a hand-edited section carrying a duplicate is flagged and blocks saving.
    const duped = new FakeScope({
      base: { providers: [{ kind: 'anysearch', enabled: true, apiKeyRefs: ['D', 'D'] }], attemptTimeoutMs: 15000 },
    })
    const dupedController = new AggregatedCardController(duped as never, fakeCredentials())
    await settled()
    state = dupedController.inject().hooks.aggregatedCard.getSnapshot()
    expect(state.entries[0]?.invalidReason).toBe('duplicate-reference')
    expect(state.invalid).toBe(true)
  })

  it('stages and saves the timeout, and a reset un-inherits it', async () => {
    const scope = new FakeScope({ ...defaultSection(), user: { attemptTimeoutMs: 20000 } })
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const face = controller.inject()
    let state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.timeout.text).toBe('20000')
    expect(state.timeout.overridden).toBe(true)

    face.editTimeout('30000')
    face.save()
    await settled()
    expect((scope.getSnapshot().user as Record<string, unknown>).attemptTimeoutMs).toBe(30000)

    face.resetTimeout()
    state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.timeout.text).toBe('15000')
    expect(state.timeout.overridden).toBe(true)
    face.save()
    await settled()
    expect((scope.getSnapshot().user ?? {}).attemptTimeoutMs).toBeUndefined()
  })

  it('stages a queue reset: seeds from the base layer and un-inherits on save', async () => {
    const userQueue = [{ kind: 'tinyfish' as const, enabled: true, apiKeyRefs: ['T'], baseURL: 'https://proxy.test' }]
    const scope = new FakeScope({ ...defaultSection(), user: { providers: userQueue } })
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const face = controller.inject()
    expect(face.hooks.aggregatedCard.getSnapshot().entries.map(entry => entry.kind)).toEqual(['tinyfish'])

    face.resetQueue()
    let state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.entries.map(entry => entry.kind)).toEqual(['anysearch', 'tavily'])
    expect(state.dirty).toBe(true)

    face.save()
    await settled()
    expect((scope.getSnapshot().user ?? {}).providers).toBeUndefined()
    state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.entries.map(entry => entry.kind)).toEqual(['anysearch', 'tavily'])
    expect(state.dirty).toBe(false)
  })

  it('marks configured/unset badges from the credentials domain', async () => {
    const scope = new FakeScope(defaultSection())
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const state = controller.inject().hooks.aggregatedCard.getSnapshot()
    // fakeCredentials marks refs containing 'OK' configured.
    expect(state.entries[0]?.keys[0]?.configured).toBe(false)
    expect(state.entries[0]?.keys[0]?.ref).toBe('ANYSEARCH_API_KEY')
  })

  it('keeps drafts when a save fails to land', async () => {
    const scope = new FakeScope(defaultSection())
    scope.set = async () => { throw new Error('write refused') }
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const face = controller.inject()
    face.addEntry('tinyfish')
    face.save()
    await settled()
    const state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.failed).toBe(true)
    expect(state.dirty).toBe(true)
    expect(state.entries.map(entry => entry.kind)).toContain('tinyfish')
  })

  it('reports the shell facts the chrome renders', async () => {
    const scope = new FakeScope(defaultSection())
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const state = controller.inject().hooks.aggregatedCard.getSnapshot()
    const shell: CardShell = {
      available: state.available,
      writable: state.writable,
      dirty: state.dirty,
      invalid: state.invalid,
      saving: state.saving,
      failed: state.failed,
    }
    expect(shell).toEqual({ available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false })
  })
})
