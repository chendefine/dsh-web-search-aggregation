import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { anySearchAdapter, mapAnySearchResponse, mapAnySearchRow } from '../src/adapters/anysearch.ts'
import { tinyFishAdapter, mapTinyFishResponse, mapTinyFishRow, tinyfishURL } from '../src/adapters/tinyfish.ts'
import { tavilyAdapter, mapTavilyResponse, mapTavilyRow } from '../src/adapters/tavily.ts'
import { braveAdapter, braveCount, braveURL, mapBraveResponse, mapBraveRow } from '../src/adapters/brave.ts'
import { exaAdapter, exaNumResults, mapExaResponse, mapExaRow } from '../src/adapters/exa.ts'
import { firecrawlAdapter, firecrawlLimit, mapFirecrawlResponse, mapFirecrawlRow } from '../src/adapters/firecrawl.ts'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

/** Capture the request a fetch stub received. */
interface Captured {
  url: string
  init: RequestInit
}

function stubFetch(body: unknown, responseInit: ResponseInit = {}): Captured[] {
  const captured: Captured[] = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} })
    return jsonResponse(body, responseInit)
  })
  return captured
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AnySearch adapter', () => {
  it('maps a full result row and drops rows without a usable URL', () => {
    expect(mapAnySearchRow({ title: ' A ', url: 'https://a.test', snippet: ' s ' }))
      .toEqual({ url: 'https://a.test', title: 'A', snippet: 's' })
    expect(mapAnySearchRow({ title: 'X', url: 'not a url' })).toBeUndefined()
    expect(mapAnySearchRow({ url: 'https://b.test' })).toEqual({ url: 'https://b.test' })
  })

  it('maps an envelope: code 0 + results; business error otherwise', () => {
    expect(mapAnySearchResponse({ code: 0, message: 'ok', data: { results: [{ title: 'A', url: 'https://a.test' }] } }))
      .toEqual({ sources: [{ url: 'https://a.test', title: 'A' }], truncated: false })
    expect(() => mapAnySearchResponse({ code: 1001, message: 'quota exceeded', data: {} }))
      .toThrowError(WebError)
    expect(() => mapAnySearchResponse({ code: 0, data: {} })).toThrowError(/no results array/)
  })

  it('POSTs /v1/search with max_results and an optional bearer', async () => {
    const captured = stubFetch({ code: 0, data: { results: [] } })
    await anySearchAdapter.search('hello', 3, 'as-key', 'https://api.anysearch.com', undefined)
    expect(captured).toHaveLength(1)
    const request = captured[0]!
    expect(request.url).toBe('https://api.anysearch.com/v1/search')
    expect(request.init.method).toBe('POST')
    expect((request.init.headers as Record<string, string>).authorization).toBe('Bearer as-key')
    expect(JSON.parse(request.init.body as string)).toEqual({ query: 'hello', max_results: 3 })
  })

  it('sends no authorization header and no max_results when absent', async () => {
    const captured = stubFetch({ code: 0, data: { results: [] } })
    await anySearchAdapter.search('hello', undefined, undefined, 'https://any.test/', undefined)
    const request = captured[0]!
    expect(request.url).toBe('https://any.test/v1/search')
    expect((request.init.headers as Record<string, string>).authorization).toBeUndefined()
    expect(JSON.parse(request.init.body as string)).toEqual({ query: 'hello' })
  })

  it('surfaces a non-2xx error with the upstream message', async () => {
    stubFetch({ message: 'rate limited' }, { status: 429 })
    await expect(anySearchAdapter.search('q', undefined, 'k', 'https://api.anysearch.com', undefined))
      .rejects.toThrowError(WebError)
    await expect(anySearchAdapter.search('q', undefined, 'k', 'https://api.anysearch.com', undefined))
      .rejects.toThrowError(/rate limited/)
  })
})

describe('TinyFish adapter', () => {
  it('maps rows with date→publishedAt and drops unusable URLs', () => {
    expect(mapTinyFishRow({ title: 'A', url: 'https://a.test', snippet: 's', date: '2026-01-02' }))
      .toEqual({ url: 'https://a.test', title: 'A', snippet: 's', publishedAt: '2026-01-02' })
    expect(mapTinyFishRow({ url: '::bad::' })).toBeUndefined()
  })

  it('builds the query URL off the base', () => {
    expect(tinyfishURL('https://api.search.tinyfish.ai', 'a b&c'))
      .toBe('https://api.search.tinyfish.ai/?query=a+b%26c')
    expect(() => tinyfishURL('::not a url::', 'q')).toThrowError(WebError)
  })

  it('maps a response and requires a results array', () => {
    expect(mapTinyFishResponse({ query: 'q', results: [{ url: 'https://a.test', title: 'A' }], total_results: 1 }))
      .toEqual({ sources: [{ url: 'https://a.test', title: 'A' }], truncated: false })
    expect(() => mapTinyFishResponse({ query: 'q' })).toThrowError(/no results array/)
  })

  it('GETs with the x-api-key header and rejects a keyless attempt', async () => {
    const captured = stubFetch({ results: [] })
    await tinyFishAdapter.search('q', 8, 'tf-key', 'https://api.search.tinyfish.ai', undefined)
    const request = captured[0]!
    expect(request.init.method).toBe('GET')
    expect(request.url).toBe('https://api.search.tinyfish.ai/?query=q')
    expect((request.init.headers as Record<string, string>)['x-api-key']).toBe('tf-key')
    // The API exposes no count control; maxResults must not appear anywhere.
    expect(request.url).not.toContain('nb')
    await expect(tinyFishAdapter.search('q', undefined, undefined, 'https://api.search.tinyfish.ai', undefined))
      .rejects.toThrowError(/requires an API key/)
  })
})

describe('Tavily adapter', () => {
  it('maps rows (content→snippet, published_date→publishedAt) and keeps answer as content', () => {
    expect(mapTavilyRow({ title: 'A', url: 'https://a.test', content: 'c', published_date: '2026-01-01' }))
      .toEqual({ url: 'https://a.test', title: 'A', snippet: 'c', publishedAt: '2026-01-01' })
    const mapped = mapTavilyResponse({
      answer: 'Generated answer',
      results: [{ url: 'https://a.test', content: 'c' }],
    })
    expect(mapped).toEqual({
      sources: [{ url: 'https://a.test', snippet: 'c' }],
      truncated: false,
      content: 'Generated answer',
    })
    expect(mapTavilyResponse({ results: [], answer: '  ' }).content).toBeUndefined()
    expect(() => mapTavilyResponse({})).toThrowError(/no results array/)
  })

  it('POSTs /search with bearer, max_results, and include_answer', async () => {
    const captured = stubFetch({ results: [], answer: null })
    await tavilyAdapter.search('hello', 7, 'tvly-key', 'https://api.tavily.com', undefined)
    const request = captured[0]!
    expect(request.url).toBe('https://api.tavily.com/search')
    expect(request.init.method).toBe('POST')
    expect((request.init.headers as Record<string, string>).authorization).toBe('Bearer tvly-key')
    expect(JSON.parse(request.init.body as string)).toEqual({
      query: 'hello',
      max_results: 7,
      search_depth: 'basic',
      include_answer: true,
      include_raw_content: false,
      include_images: false,
    })
  })

  it('uses its own default count when the request carries none', async () => {
    const captured = stubFetch({ results: [] })
    await tavilyAdapter.search('q', undefined, 'k', 'https://api.tavily.com', undefined)
    expect(JSON.parse(captured[0]!.init.body as string).max_results).toBe(5)
  })

  it('surfaces network failures as WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('connection refused') })
    await expect(tavilyAdapter.search('q', undefined, 'k', 'https://api.tavily.com', undefined))
      .rejects.toThrowError(/request failed/)
  })
})

describe('Brave adapter', () => {
  it('maps rows (description→snippet, page_age→publishedAt) and drops unusable URLs', () => {
    expect(mapBraveRow({ title: 'A', url: 'https://a.test', description: 'd', page_age: '2026-01-02T03:04:05' }))
      .toEqual({ url: 'https://a.test', title: 'A', snippet: 'd', publishedAt: '2026-01-02T03:04:05' })
    expect(mapBraveRow({ url: '::bad::' })).toBeUndefined()
    expect(mapBraveRow({ url: 'https://b.test', age: '2 days ago' })).toEqual({ url: 'https://b.test' })
  })

  it('builds the query URL: base gets the /res/v1/web/search path appended', () => {
    expect(braveURL('https://api.search.brave.com', 'a b&c', 5))
      .toBe('https://api.search.brave.com/res/v1/web/search?q=a+b%26c&count=5&text_decorations=false')
    // A base carrying a proxy prefix keeps it (same join rule as the POST adapters).
    expect(braveURL('https://proxy.test/brave/', 'q', 3))
      .toBe('https://proxy.test/brave/res/v1/web/search?q=q&count=3&text_decorations=false')
    expect(() => braveURL('::not a url::', 'q', 5)).toThrowError(WebError)
  })

  it('clamps count into the 1–20 window', () => {
    expect(braveCount(50)).toBe(20)
    expect(braveCount(7)).toBe(7)
    expect(braveCount(0)).toBe(1)
    expect(braveCount(3.9)).toBe(3)
  })

  it('maps a response and requires a web.results array', () => {
    expect(mapBraveResponse({ web: { results: [{ url: 'https://a.test', title: 'A' }] } }))
      .toEqual({ sources: [{ url: 'https://a.test', title: 'A' }], truncated: false })
    expect(() => mapBraveResponse({ query: { original: 'q' } })).toThrowError(/no web results object/)
    expect(() => mapBraveResponse({ web: { type: 'search' } })).toThrowError(/no results array/)
  })

  it('GETs /res/v1/web/search with the subscription token and a clamped count', async () => {
    const captured = stubFetch({ web: { results: [] } })
    await braveAdapter.search('hello', 50, 'brave-token', 'https://api.search.brave.com', undefined)
    const request = captured[0]!
    expect(request.init.method).toBe('GET')
    expect(request.url).toBe('https://api.search.brave.com/res/v1/web/search?q=hello&count=20&text_decorations=false')
    expect((request.init.headers as Record<string, string>)['x-subscription-token']).toBe('brave-token')
    expect((request.init.headers as Record<string, string>).accept).toBe('application/json')
  })

  it('uses its own default count when the request carries none and rejects a keyless attempt', async () => {
    const captured = stubFetch({ web: { results: [] } })
    await braveAdapter.search('q', undefined, 'k', 'https://api.search.brave.com', undefined)
    expect(new URL(captured[0]!.url).searchParams.get('count')).toBe('20')
    await expect(braveAdapter.search('q', undefined, undefined, 'https://api.search.brave.com', undefined))
      .rejects.toThrowError(/requires an API key/)
  })
})

describe('Exa adapter', () => {
  it('maps rows (first highlight→snippet, publishedDate→publishedAt) and drops unusable URLs', () => {
    expect(mapExaRow({
      title: 'A',
      url: 'https://a.test',
      publishedDate: '2026-01-02',
      highlights: [' first ', '', 'second'],
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'first', publishedAt: '2026-01-02' })
    expect(mapExaRow({ url: 'not a url', highlights: ['x'] })).toBeUndefined()
    expect(mapExaRow({ url: 'https://b.test' })).toEqual({ url: 'https://b.test' })
  })

  it('clamps numResults into the 1–100 window', () => {
    expect(exaNumResults(500)).toBe(100)
    expect(exaNumResults(8)).toBe(8)
    expect(exaNumResults(0)).toBe(1)
  })

  it('maps a response and requires a results array', () => {
    expect(mapExaResponse({ requestId: 'r', results: [{ url: 'https://a.test', title: 'A' }] }))
      .toEqual({ sources: [{ url: 'https://a.test', title: 'A' }], truncated: false })
    expect(() => mapExaResponse({ requestId: 'r' })).toThrowError(/no results array/)
  })

  it('POSTs /search with bearer, numResults, and nested contents.highlights', async () => {
    const captured = stubFetch({ results: [] })
    await exaAdapter.search('hello', 7, 'exa-key', 'https://api.exa.ai', undefined)
    const request = captured[0]!
    expect(request.url).toBe('https://api.exa.ai/search')
    expect(request.init.method).toBe('POST')
    expect((request.init.headers as Record<string, string>).authorization).toBe('Bearer exa-key')
    expect(JSON.parse(request.init.body as string)).toEqual({
      query: 'hello',
      numResults: 7,
      contents: { highlights: true },
    })
  })

  it('uses its own default count when the request carries none and rejects a keyless attempt', async () => {
    const captured = stubFetch({ results: [] })
    await exaAdapter.search('q', undefined, 'k', 'https://api.exa.ai', undefined)
    expect(JSON.parse(captured[0]!.init.body as string).numResults).toBe(10)
    await expect(exaAdapter.search('q', undefined, undefined, 'https://api.exa.ai', undefined))
      .rejects.toThrowError(/requires an API key/)
  })

  it('surfaces a non-2xx error with the upstream message', async () => {
    stubFetch({ message: 'Invalid API key' }, { status: 401 })
    await expect(exaAdapter.search('q', undefined, 'k', 'https://api.exa.ai', undefined))
      .rejects.toThrowError(/Invalid API key/)
  })
})

describe('Firecrawl adapter', () => {
  it('maps rows (description→snippet) and drops unusable URLs', () => {
    expect(mapFirecrawlRow({ title: 'A', url: 'https://a.test', description: 'd' }))
      .toEqual({ url: 'https://a.test', title: 'A', snippet: 'd' })
    expect(mapFirecrawlRow({ url: '::bad::' })).toBeUndefined()
    expect(mapFirecrawlRow({ url: 'https://b.test' })).toEqual({ url: 'https://b.test' })
  })

  it('clamps limit into the 1–100 window', () => {
    expect(firecrawlLimit(500)).toBe(100)
    expect(firecrawlLimit(6)).toBe(6)
    expect(firecrawlLimit(0)).toBe(1)
  })

  it('maps a response and rejects failure envelopes and missing web arrays', () => {
    expect(mapFirecrawlResponse({ success: true, data: { web: [{ url: 'https://a.test', title: 'A' }] } }))
      .toEqual({ sources: [{ url: 'https://a.test', title: 'A' }], truncated: false })
    expect(() => mapFirecrawlResponse({ success: false, warning: 'upstream degraded' }))
      .toThrowError(/failed search: upstream degraded/)
    expect(() => mapFirecrawlResponse({ success: true })).toThrowError(/no data object/)
    expect(() => mapFirecrawlResponse({ success: true, data: {} })).toThrowError(/no web results array/)
  })

  it('POSTs /v2/search with bearer and limit', async () => {
    const captured = stubFetch({ success: true, data: { web: [] } })
    await firecrawlAdapter.search('hello', 5, 'fc-key', 'https://api.firecrawl.dev', undefined)
    const request = captured[0]!
    expect(request.url).toBe('https://api.firecrawl.dev/v2/search')
    expect(request.init.method).toBe('POST')
    expect((request.init.headers as Record<string, string>).authorization).toBe('Bearer fc-key')
    expect(JSON.parse(request.init.body as string)).toEqual({ query: 'hello', limit: 5 })
  })

  it('uses its own default limit when the request carries none and rejects a keyless attempt', async () => {
    const captured = stubFetch({ success: true, data: { web: [] } })
    await firecrawlAdapter.search('q', undefined, 'k', 'https://api.firecrawl.dev', undefined)
    expect(JSON.parse(captured[0]!.init.body as string).limit).toBe(10)
    await expect(firecrawlAdapter.search('q', undefined, undefined, 'https://api.firecrawl.dev', undefined))
      .rejects.toThrowError(/requires an API key/)
  })
})

describe('shared HTTP plumbing: network failures', () => {
  /** One undici-style `TypeError: fetch failed` wrapping an errno cause. */
  function fetchFailed(message: string, code: string): TypeError {
    const error = new TypeError('fetch failed')
    ;(error as { cause?: unknown }).cause = Object.assign(new Error(message), { code })
    return error
  }

  it('unwraps the undici cause so DNS/socket failures are diagnosable', async () => {
    vi.stubGlobal('fetch', async () => { throw fetchFailed('getaddrinfo EAI_AGAIN api.search.brave.com', 'EAI_AGAIN') })
    await expect(braveAdapter.search('q', undefined, 'k', 'https://api.search.brave.com', undefined))
      .rejects.toThrowError(/getaddrinfo EAI_AGAIN api\.search\.brave\.com \[EAI_AGAIN\]/)
  })

  it('retries a transient network failure once and succeeds', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      if (calls === 1) throw fetchFailed('read ECONNRESET', 'ECONNRESET')
      return jsonResponse({ web: { results: [{ url: 'https://a.test', title: 'A' }] } })
    })
    const result = await braveAdapter.search('q', undefined, 'k', 'https://api.search.brave.com', undefined)
    expect(calls).toBe(2)
    expect(result.sources[0]?.url).toBe('https://a.test')
  })

  it('gives up after the single retry when the failure persists', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      throw fetchFailed('connect ETIMEDOUT 15.197.138.111:443', 'ETIMEDOUT')
    })
    await expect(exaAdapter.search('q', undefined, 'k', 'https://api.exa.ai', undefined))
      .rejects.toThrowError(/ETIMEDOUT/)
    expect(calls).toBe(2)
  })

  it('does not retry non-network failures or HTTP status errors', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return jsonResponse({ message: 'invalid key' }, { status: 401 })
    })
    await expect(braveAdapter.search('q', undefined, 'k', 'https://api.search.brave.com', undefined))
      .rejects.toThrowError(/HTTP 401/)
    expect(calls).toBe(1)
    calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      throw new TypeError('fetch failed') // no recognized transient cause → final
    })
    await expect(braveAdapter.search('q', undefined, 'k', 'https://api.search.brave.com', undefined))
      .rejects.toThrowError(/request failed/)
    expect(calls).toBe(1)
  })
})
