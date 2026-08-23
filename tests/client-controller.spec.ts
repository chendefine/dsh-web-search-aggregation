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

/** The credentials wire face as the controller uses it (rpc plumbing faked as never). */
export function fakeCredentials(overrides: Partial<Pick<IApiClient['credentials'], 'set' | 'unset'>> = {}): Pick<IApiClient, 'credentials'> {
  const set = overrides.set ?? vi.fn(async (_request: { ref: string, value: string }) => ({} as never))
  const unset = overrides.unset ?? vi.fn(async (_request: { ref: string }) => ({} as never))
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
        { kind: 'anysearch', enabled: true },
        { kind: 'tavily', enabled: true },
      ],
      attemptTimeoutMs: 10000,
    },
  }
}

async function settled(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('AggregatedCardController', () => {
  it('projects the committed queue with position, kinds, and one credential per kind', async () => {
    const scope = new FakeScope(defaultSection())
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const state = controller.inject().hooks.aggregatedCard.getSnapshot()
    expect(state.available).toBe(true)
    expect(state.entries.map(entry => entry.kind)).toEqual(['anysearch', 'tavily'])
    expect(state.entries[0]?.position).toBe(1)
    expect(state.entries[0]?.keys.ref).toBe('ANYSEARCH_API_KEY')
    expect(state.entries[1]?.keys.ref).toBe('TAVILY_API_KEY')
    expect(state.entries[0]?.keys.staged).toBe(false)
    expect(state.timeout.text).toBe('10000')
    expect(state.dirty).toBe(false)
  })

  it('stages keys as an ordered tag list: save writes them joined, in order, through credentials', async () => {
    const scope = new FakeScope(defaultSection())
    const api = fakeCredentials()
    const controller = new AggregatedCardController(scope as never, api)
    await settled()
    const face = controller.inject()
    face.addKey(1, 'tvly-a')
    face.addKey(1, ' tvly-b ')
    let state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.dirty).toBe(true)
    expect(state.entries[1]?.keys.staged).toBe(true)
    expect(state.entries[1]?.keys.tags).toHaveLength(2)

    face.save()
    await settled()
    // The tag order became the comma-joined value, addressed by the kind's
    // single fixed reference.
    expect(api.credentials.set).toHaveBeenCalledWith({ ref: 'TAVILY_API_KEY', value: 'tvly-a,tvly-b' })
    // And the queue landed in the user layer without any credential field on it.
    const user = scope.getSnapshot().user as Record<string, unknown> | undefined
    const providers = user?.providers as Array<{ kind: string }>
    expect(providers).toEqual([
      { kind: 'anysearch', enabled: true },
      { kind: 'tavily', enabled: true },
    ])
    state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.entries[1]?.keys.staged).toBe(false)
  })

  it('masks each staged tag as head 12 + … + tail 2', async () => {
    const scope = new FakeScope(defaultSection())
    const controller = new AggregatedCardController(scope as never, fakeCredentials())
    await settled()
    const face = controller.inject()
    const long = 'tvly-abcdefghijklmnop'
    const short = 'as-key'
    face.addKey(0, long)
    face.addKey(0, short)
    const tags = face.hooks.aggregatedCard.getSnapshot().entries[0]?.keys.tags
    expect(tags?.[0]).toBe(`${long.slice(0, 12)}…${long.slice(-2)}`)
    expect(tags?.[1]).toBe(`…${short.slice(-2)}`)
  })

  it('appends keys in add order, which is the saved order', async () => {
    const scope = new FakeScope(defaultSection())
    const api = fakeCredentials()
    const controller = new AggregatedCardController(scope as never, api)
    await settled()
    const face = controller.inject()
    face.addKey(1, 'k3')
    face.addKey(1, 'k1')
    face.addKey(1, 'k2')
    face.save()
    await settled()
    expect(api.credentials.set).toHaveBeenCalledWith({ ref: 'TAVILY_API_KEY', value: 'k3,k1,k2' })
  })

  it('splits a pasted comma-joined literal into several keys and drops duplicates', async () => {
    const scope = new FakeScope(defaultSection())
    const api = fakeCredentials()
    const controller = new AggregatedCardController(scope as never, api)
    await settled()
    const face = controller.inject()
    face.addKey(1, 'a, b ,a,,')
    face.save()
    await settled()
    expect(api.credentials.set).toHaveBeenCalledWith({ ref: 'TAVILY_API_KEY', value: 'a,b' })
  })

  it('removes one staged key by tag position; removing the last stages a clear', async () => {
    const scope = new FakeScope(defaultSection())
    const api = fakeCredentials()
    const controller = new AggregatedCardController(scope as never, api)
    await settled()
    const face = controller.inject()
    face.addKey(1, 'a')
    face.addKey(1, 'b')
    face.addKey(1, 'c')
    face.removeKey(1, 1)
    let state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.entries[1]?.keys.tags).toHaveLength(2)
    face.save()
    await settled()
    expect(api.credentials.set).toHaveBeenCalledWith({ ref: 'TAVILY_API_KEY', value: 'a,c' })

    face.removeKey(1, 0)
    face.removeKey(1, 0)
    face.save()
    await settled()
    // The successful save cleared the draft; stage one key again, close it,
    // and saving an empty tag list clears the credential.
    expect(api.credentials.unset).not.toHaveBeenCalled()
    face.addKey(1, 'x')
    face.removeKey(1, 0)
    const cleared = face.hooks.aggregatedCard.getSnapshot()
    expect(cleared.entries[1]?.keys.staged).toBe(true)
    expect(cleared.entries[1]?.keys.tags).toHaveLength(0)
    face.save()
    await settled()
    expect(api.credentials.unset).toHaveBeenCalledWith({ ref: 'TAVILY_API_KEY' })
  })

  it('stores a single key bare, with no separator', async () => {
    const scope = new FakeScope(defaultSection())
    const api = fakeCredentials()
    const controller = new AggregatedCardController(scope as never, api)
    await settled()
    const face = controller.inject()
    face.addKey(1, 'tvly-only')
    face.save()
    await settled()
    expect(api.credentials.set).toHaveBeenCalledWith({ ref: 'TAVILY_API_KEY', value: 'tvly-only' })
  })

  it('drops the staged key list without touching the credential on reset', async () => {
    const scope = new FakeScope(defaultSection())
    const api = fakeCredentials()
    const controller = new AggregatedCardController(scope as never, api)
    await settled()
    const face = controller.inject()
    face.addKey(0, 'as-1')
    face.addKey(0, 'as-2')
    expect(face.hooks.aggregatedCard.getSnapshot().dirty).toBe(true)
    face.resetKeys(0)
    const state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.entries[0]?.keys.staged).toBe(false)
    expect(state.entries[0]?.keys.tags).toHaveLength(0)
    expect(state.dirty).toBe(false)
  })

  it('refuses to queue a provider kind twice', async () => {
    const scope = new FakeScope(defaultSection())
    const api = fakeCredentials()
    const controller = new AggregatedCardController(scope as never, api)
    await settled()
    const face = controller.inject()
    face.addEntry('tavily')
    expect(face.hooks.aggregatedCard.getSnapshot().entries).toHaveLength(2)
    expect(face.hooks.aggregatedCard.getSnapshot().dirty).toBe(false)
    face.addEntry('tinyfish')
    expect(face.hooks.aggregatedCard.getSnapshot().entries.map(entry => entry.kind))
      .toEqual(['anysearch', 'tavily', 'tinyfish'])
    // Changing an entry to another entry's kind is refused too.
    face.setKind(2, 'tavily')
    expect(face.hooks.aggregatedCard.getSnapshot().entries[2]?.kind).toBe('tinyfish')
    // …but moving to a kind no other entry holds still works.
    face.removeEntry(0)
    face.setKind(1, 'anysearch')
    expect(face.hooks.aggregatedCard.getSnapshot().entries.map(entry => entry.kind))
      .toEqual(['tavily', 'anysearch'])
  })

  it('blocks saving on a hand-edited duplicate provider kind', async () => {
    const duped = new FakeScope({
      base: { providers: [{ kind: 'tavily', enabled: true }, { kind: 'tavily', enabled: false }], attemptTimeoutMs: 10000 },
    })
    const api = fakeCredentials()
    const controller = new AggregatedCardController(duped as never, api)
    await settled()
    const state = controller.inject().hooks.aggregatedCard.getSnapshot()
    expect(state.entries[0]?.invalidReason).toBeUndefined()
    expect(state.entries[1]?.invalidReason).toBe('duplicate-kind')
    expect(state.invalid).toBe(true)
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
    expect(state.timeout.text).toBe('10000')
    expect(state.timeout.overridden).toBe(true)
    face.save()
    await settled()
    expect((scope.getSnapshot().user ?? {}).attemptTimeoutMs).toBeUndefined()
  })

  it('stages a queue reset: seeds from the base layer and un-inherits on save', async () => {
    const userQueue = [{ kind: 'tinyfish' as const, enabled: true, baseURL: 'https://proxy.test' }]
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
    expect(state.entries[0]?.keys.configured).toBe(false)
    expect(state.entries[0]?.keys.ref).toBe('ANYSEARCH_API_KEY')
  })

  it('keeps drafts when a credentials write fails to land', async () => {
    const scope = new FakeScope(defaultSection())
    const api = fakeCredentials({ set: vi.fn(async () => { throw new Error('write refused') }) })
    const controller = new AggregatedCardController(scope as never, api)
    await settled()
    const face = controller.inject()
    face.addKey(1, 'tvly-a')
    face.save()
    await settled()
    const state = face.hooks.aggregatedCard.getSnapshot()
    expect(state.failed).toBe(true)
    expect(state.dirty).toBe(true)
    expect(state.entries[1]?.keys.staged).toBe(true)
  })

  it('keeps drafts when a section write fails to land', async () => {
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
