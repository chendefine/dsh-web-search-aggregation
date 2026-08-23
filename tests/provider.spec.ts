import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { WebError } from '@deepseek-ai/dsh-web'
import type { AggregatedSearchConfig, QueueEntry } from '../src/types.ts'
import { AggregatedSearchProvider } from '../src/provider.ts'

/** A config owner the tests mutate between requests. */
class TestHarness {
  private config: AggregatedSearchConfig
  readonly keys = new Map<string, string>()
  readonly log: { level: 'info' | 'warn', message: string }[] = []
  readonly provider: AggregatedSearchProvider

  constructor(config: AggregatedSearchConfig) {
    this.config = config
    this.provider = new AggregatedSearchProvider({
      config: () => this.config,
      resolveKey: async ref => this.keys.get(ref),
      logger: {
        info: (format, ...args) => { this.log.push({ level: 'info', message: formatMessage(format, args) }) },
        warn: (format, ...args) => { this.log.push({ level: 'warn', message: formatMessage(format, args) }) },
      },
    })
  }

  set(config: AggregatedSearchConfig): void {
    this.config = config
  }

  entry(index: number): QueueEntry {
    const entry = this.config.providers[index]
    if (entry === undefined) throw new Error(`no entry ${String(index)}`)
    return entry
  }
}

/** Format a cordis-style `%s`/`%d` log line with its arguments. */
function formatMessage(format: string, args: unknown[]): string {
  let index = 0
  return format.replace(/%[sd]/g, () => String(args[index++] ?? ''))
}

function queue(...providers: QueueEntry[]): AggregatedSearchConfig {
  return { providers, attemptTimeoutMs: 15000 }
}

/** One fetch route decision: match by URL prefix. */
type Route = { match: RegExp, respond: () => Promise<Response> | Response }

/** Install a fetch stub with ordered routes; unmatched URLs throw (visible failure). */
function routeFetch(routes: Route[]): string[] {
  const seen: string[] = []
  const remaining = [...routes]
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    seen.push(href)
    const index = remaining.findIndex(candidate => candidate.match.test(href))
    if (index === -1) throw new Error(`no route for ${href}`)
    const [route] = remaining.splice(index, 1)
    void init
    return route!.respond()
  })
  return seen
}

/** One success body readable by every adapter: the plain `results` dialect (Tavily/TinyFish) and the AnySearch envelope. */
function okResults(urls: string[]): Response {
  const rows = urls.map(url => ({ url, title: url }))
  return new Response(JSON.stringify({ results: rows, code: 0, message: 'ok', data: { results: rows } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function searchHit(results: unknown): Promise<Response> | Response {
  return okResults(results as string[])
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('queue ordering and fallback', () => {
  it('serves from the first entry and never calls later ones', async () => {
    const seen = routeFetch([
      { match: /tavily\.com/, respond: () => searchHit(['https://tavily.test/a']) },
      { match: /tinyfish\.ai/, respond: () => { throw new Error('tinyfish must not be called') } },
    ])
    const harness = new TestHarness(queue(
      { kind: 'tavily', enabled: true },
      { kind: 'tinyfish', enabled: true },
    ))
    harness.keys.set('TAVILY_API_KEY', 'k')
    harness.keys.set('TINYFISH_API_KEY', 'k')
    const result = await harness.provider.search({ query: 'q' })
    expect(result.sources).toEqual([{ url: 'https://tavily.test/a', title: 'https://tavily.test/a' }])
    expect(seen.filter(url => url.includes('tavily'))).toHaveLength(1)
    expect(seen.some(url => url.includes('tinyfish'))).toBe(false)
  })

  it('falls through an HTTP failure to the next entry and returns its result', async () => {
    routeFetch([
      { match: /tavily\.com/, respond: () => new Response('{"detail":"invalid key"}', { status: 401 }) },
      { match: /tinyfish\.ai/, respond: () => searchHit(['https://tinyfish.test/b']) },
    ])
    const harness = new TestHarness(queue(
      { kind: 'tavily', enabled: true },
      { kind: 'tinyfish', enabled: true },
    ))
    harness.keys.set('TAVILY_API_KEY', 'bad')
    harness.keys.set('TINYFISH_API_KEY', 'good')
    const result = await harness.provider.search({ query: 'q' })
    expect(result.sources[0]?.url).toBe('https://tinyfish.test/b')
    expect(harness.log.some(entry => entry.level === 'warn')).toBe(true)
  })

  it('skips a disabled entry without touching its endpoint', async () => {
    const seen = routeFetch([
      { match: /tinyfish\.ai/, respond: () => searchHit(['https://tinyfish.test/c']) },
    ])
    const harness = new TestHarness(queue(
      { kind: 'tavily', enabled: false },
      { kind: 'tinyfish', enabled: true },
    ))
    harness.keys.set('TINYFISH_API_KEY', 'k')
    const result = await harness.provider.search({ query: 'q' })
    expect(result.sources[0]?.url).toBe('https://tinyfish.test/c')
    expect(seen.every(url => !url.includes('tavily'))).toBe(true)
  })

  it('aggregates every failure into the WEB_PROVIDER_ERROR message, without key literals', async () => {
    routeFetch([
      { match: /tavily\.com/, respond: () => new Response('{}', { status: 401 }) },
      { match: /tinyfish\.ai/, respond: () => new Response('not json at all', { status: 200, headers: { 'content-type': 'text/plain' } }) },
    ])
    const harness = new TestHarness(queue(
      { kind: 'tavily', enabled: true },
      { kind: 'tinyfish', enabled: true },
    ))
    harness.keys.set('TAVILY_API_KEY', 'secret-tavily-literal')
    harness.keys.set('TINYFISH_API_KEY', 'secret-tinyfish-literal')
    const caught: unknown = await harness.provider.search({ query: 'q' }).then(value => value, reason => reason)
    expect(caught).toBeInstanceOf(WebError)
    const error = caught as WebError
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toContain('all 2 attempts failed')
    expect(error.message).toContain('[1] tavily/TAVILY_API_KEY')
    expect(error.message).toContain('[2] tinyfish/TINYFISH_API_KEY')
    expect(error.message).not.toContain('secret-tavily-literal')
    expect(error.message).not.toContain('secret-tinyfish-literal')
  })

  it('reports WEB_PROVIDER_UNAVAILABLE when no entry is enabled', async () => {
    const harness = new TestHarness(queue({ kind: 'tavily', enabled: false }))
    const caught: unknown = await harness.provider.search({ query: 'q' }).then(value => value, reason => reason)
    expect((caught as WebError).code).toBe('WEB_PROVIDER_UNAVAILABLE')
  })

  it('reports WEB_PROVIDER_UNAVAILABLE on an empty queue', async () => {
    const harness = new TestHarness(queue())
    expect(harness.provider.available()).toBe(false)
    const caught: unknown = await harness.provider.search({ query: 'q' }).then(value => value, reason => reason)
    expect((caught as WebError).code).toBe('WEB_PROVIDER_UNAVAILABLE')
  })

  it('treats a zero-result success as success (no fallback on thin results)', async () => {
    const seen = routeFetch([
      { match: /tavily\.com/, respond: () => okResults([]) },
      { match: /tinyfish\.ai/, respond: () => { throw new Error('must not be called') } },
    ])
    const harness = new TestHarness(queue(
      { kind: 'tavily', enabled: true },
      { kind: 'tinyfish', enabled: true },
    ))
    harness.keys.set('TAVILY_API_KEY', 'k')
    const result = await harness.provider.search({ query: 'q' })
    expect(result.sources).toEqual([])
    expect(seen).toHaveLength(1)
  })
})

describe('key handling', () => {
  it('splits the single credential into a key pool and falls through a failed key to the next', async () => {
    const seen = routeFetch([
      { match: /tavily\.com/, respond: () => new Response('{"detail":"quota"}', { status: 429 }) },
      { match: /tavily\.com/, respond: () => searchHit(['https://tavily.test/key2']) },
    ])
    const harness = new TestHarness(queue({ kind: 'tavily', enabled: true }))
    harness.keys.set('TAVILY_API_KEY', 'first,second')
    const result = await harness.provider.search({ query: 'q' })
    expect(result.sources[0]?.url).toBe('https://tavily.test/key2')
    expect(seen).toHaveLength(2)
  })

  it('parses a pool with whitespace around the separators', async () => {
    const seen = routeFetch([
      { match: /tavily\.com/, respond: () => new Response('{"detail":"quota"}', { status: 429 }) },
      { match: /tavily\.com/, respond: () => searchHit(['https://tavily.test/trimmed']) },
    ])
    const harness = new TestHarness(queue({ kind: 'tavily', enabled: true }))
    harness.keys.set('TAVILY_API_KEY', ' first , second ')
    const result = await harness.provider.search({ query: 'q' })
    expect(result.sources[0]?.url).toBe('https://tavily.test/trimmed')
    expect(seen).toHaveLength(2)
  })

  it('names the failing pool key REF#N in the summary when the pool holds several keys', async () => {
    routeFetch([
      { match: /tavily\.com/, respond: () => new Response('{}', { status: 401 }) },
      { match: /tavily\.com/, respond: () => new Response('{}', { status: 401 }) },
    ])
    const harness = new TestHarness(queue({ kind: 'tavily', enabled: true }))
    harness.keys.set('TAVILY_API_KEY', 'secret-one,secret-two')
    const caught: unknown = await harness.provider.search({ query: 'q' }).then(value => value, reason => reason)
    const error = caught as WebError
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toContain('[1] tavily/TAVILY_API_KEY#1')
    expect(error.message).toContain('[1] tavily/TAVILY_API_KEY#2')
    expect(error.message).not.toContain('secret-one')
    expect(error.message).not.toContain('secret-two')
  })

  it('treats an unset or comma-only credential as unresolved and moves down the queue', async () => {
    const seen = routeFetch([{ match: /anysearch\.com/, respond: () => searchHit(['https://any.test/ok']) }])
    const harness = new TestHarness(queue(
      { kind: 'tavily', enabled: true },
      { kind: 'tinyfish', enabled: true },
      { kind: 'anysearch', enabled: true },
    ))
    harness.keys.set('TINYFISH_API_KEY', ',')
    const result = await harness.provider.search({ query: 'q' })
    expect(result.sources[0]?.url).toBe('https://any.test/ok')
    expect(seen).toHaveLength(1)
    expect(harness.log.some(entry => entry.message.includes('resolved to nothing'))).toBe(true)
  })

  it('attempts anysearch anonymously when its credential is unset', async () => {
    const seen = routeFetch([{ match: /anysearch\.com/, respond: () => searchHit(['https://any.test/anon']) }])
    const harness = new TestHarness(queue({ kind: 'anysearch', enabled: true }))
    const result = await harness.provider.search({ query: 'q' })
    expect(result.sources[0]?.url).toBe('https://any.test/anon')
    expect(seen).toHaveLength(1)
  })

  it('rotates the start key per served request (round-robin over the pool)', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL) => {
      seen.push(String(url))
      return okResults(['https://tavily.test/x'])
    })
    const harness = new TestHarness(queue({ kind: 'tavily', enabled: true }))
    harness.keys.set('TAVILY_API_KEY', 'first,second')
    await harness.provider.search({ query: 'a' })
    await harness.provider.search({ query: 'b' })
    await harness.provider.search({ query: 'c' })
    expect(seen).toHaveLength(3)
    // Rotation is asserted through the log's per-key ref: #1, #2, #1.
    const refs = harness.log.filter(entry => entry.level === 'info').map(entry => entry.message)
    expect(refs[0]).toContain('TAVILY_API_KEY#1')
    expect(refs[1]).toContain('TAVILY_API_KEY#2')
    expect(refs[2]).toContain('TAVILY_API_KEY#1')
  })
})

describe('timeouts and cancellation', () => {
  it('cuts one attempt off at attemptTimeoutMs and falls through', async () => {
    vi.useRealTimers()
    vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.includes('tinyfish')) {
        return Promise.resolve(okResults(['https://tinyfish.test/late']))
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    const harness = new TestHarness({
      providers: [
        { kind: 'tavily', enabled: true },
        { kind: 'tinyfish', enabled: true },
      ],
      attemptTimeoutMs: 50,
    })
    harness.keys.set('TAVILY_API_KEY', 'k')
    harness.keys.set('TINYFISH_API_KEY', 't')
    const result = await harness.provider.search({ query: 'q' })
    expect(result.sources[0]?.url).toBe('https://tinyfish.test/late')
  })

  it('aborts the walk immediately when the caller signal is already aborted', async () => {
    const seen = routeFetch([{ match: /tavily\.com/, respond: () => searchHit(['https://t.test/a']) }])
    const harness = new TestHarness(queue({ kind: 'tavily', enabled: true }))
    harness.keys.set('TAVILY_API_KEY', 'k')
    const controller = new AbortController()
    controller.abort()
    const caught: unknown = await harness.provider
      .search({ query: 'q' }, controller.signal)
      .then(value => value, reason => reason)
    expect((caught as WebError).code).toBe('WEB_ABORTED')
    expect(seen).toHaveLength(0)
  })

  it('propagates WEB_ABORTED when the caller aborts mid-walk', async () => {
    vi.useRealTimers()
    const controller = new AbortController()
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      setTimeout(() => controller.abort(), 10)
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    const harness = new TestHarness(queue(
      { kind: 'tavily', enabled: true },
      { kind: 'tinyfish', enabled: true },
    ))
    harness.keys.set('TAVILY_API_KEY', 'k')
    harness.keys.set('TINYFISH_API_KEY', 't')
    const caught: unknown = await harness.provider.search({ query: 'q' }, controller.signal)
      .then(value => value, reason => reason)
    expect((caught as WebError).code).toBe('WEB_ABORTED')
  })
})

describe('seam integration', () => {
  it('registers and serves through a real WebRuntime with maxResults truncation', async () => {
    vi.useRealTimers()
    routeFetch([{ match: /tavily\.com/, respond: () => searchHit(['https://t.test/1', 'https://t.test/2', 'https://t.test/3']) }])
    const ctx = new Context()
    const runtime = new WebRuntime(ctx)
    const harness = new TestHarness(queue({ kind: 'tavily', enabled: true }))
    harness.keys.set('TAVILY_API_KEY', 'k')
    runtime.registerSearchProvider(harness.provider)
    const result = await runtime.search({ query: 'q', maxResults: 2 })
    expect(result.sources).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})
