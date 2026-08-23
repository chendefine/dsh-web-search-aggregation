import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { anySearchAdapter, mapAnySearchResponse, mapAnySearchRow } from '../src/adapters/anysearch.ts'
import { tinyFishAdapter, mapTinyFishResponse, mapTinyFishRow, tinyfishURL } from '../src/adapters/tinyfish.ts'
import { tavilyAdapter, mapTavilyResponse, mapTavilyRow } from '../src/adapters/tavily.ts'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

/** Capture the request a fetch stub received. */
interface Captured {
  url: string
  init: RequestInit
}

function stubFetch(body: unknown, init: ResponseInit = {}): Captured[] {
  const captured: Captured[] = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} })
    return jsonResponse(body, init)
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
