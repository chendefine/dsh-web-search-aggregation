/**
 * `SerpApiAdapter`: `GET {base}/search.json?engine=google&q=…&api_key=…`
 * (see serpapi.com/search-api and serpapi.com/organic-results). The API key
 * MUST ride the URL as the `api_key` query parameter — SerpApi's docs state
 * it "should not be in HTTP headers, form data, or anywhere else" — so no
 * Authorization header is sent. The documented `num` (default 10, up to 100)
 * is sent ONLY when the request carries a result count: SerpApi notes calls
 * with `num` are historically more CAPTCHA-prone, so an unspecified count
 * inherits the API default instead of forcing one. Failures — including
 * HTTP 200 bodies whose only payload is a top-level `error` string (e.g.
 * Google returning nothing) — map to `WEB_PROVIDER_ERROR` so the queue
 * falls through. `link` → url, `title` → title, `snippet` → snippet, and
 * `date` (Google's displayed date string, not normalized ISO) →
 * `publishedAt`.
 *
 * @module dsh-web-search-aggregation/adapters/serpapi
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchAdapter } from './adapter.ts'
import { KIND_DEFAULT_BASE_URL } from '../defaults.ts'
import { jsonRequest } from './http.ts'

/** Public SerpApi API origin (single source: `defaults.ts`). */
export const SERPAPI_DEFAULT_BASE_URL = KIND_DEFAULT_BASE_URL.serpapi

/** SerpApi's documented maximum for `num` (default 10, up to 100). */
export const SERPAPI_MAX_NUM = 100

/**
 * Clamp one requested result count into SerpApi's 1–100 `num` window. Only
 * used when the request actually carries a count; otherwise `num` is omitted
 * so the API default (10) applies.
 *
 * @param count - the raw requested count.
 * @returns the clamped count.
 */
export function serpapiNum(count: number): number {
  return Math.min(Math.max(Math.trunc(count), 1), SERPAPI_MAX_NUM)
}

/**
 * Build the SerpApi request URL for one query.
 *
 * @param baseURL - the endpoint base (already defaulted).
 * @param query - the search query text.
 * @param apiKey - the SerpApi key literal; it rides the URL because the API
 *   rejects keys placed in headers or bodies.
 * @param num - the clamped result count, or `undefined` to inherit the API
 *   default (then the parameter is not sent at all).
 * @returns the absolute request URL.
 * @throws WebError `WEB_PROVIDER_ERROR` when the base is not an absolute URL.
 */
export function serpapiURL(baseURL: string, query: string, apiKey: string, num: number | undefined): string {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch (error: unknown) {
    throw new WebError(`SerpApi base URL is invalid: ${baseURL}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  // The API path is appended to the base like every adapter does (Tavily
  // `/search`, Firecrawl `/v2/search`): the base is the origin — or a proxy
  // prefix — and the path lives in exactly one place. `/search.json` is the
  // canonical documented spelling (the one SerpApi's own pagination links
  // use); `/search` is its synonym.
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/search.json`
  url.searchParams.set('engine', 'google')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', apiKey)
  if (num !== undefined) url.searchParams.set('num', String(num))
  return url.href
}

/** One result row of SerpApi's `organic_results[]`, as far as this adapter reads it. */
interface SerpApiRow {
  title?: unknown
  link?: unknown
  snippet?: unknown
  /** Google's displayed date ("Sep 20, 2018", "5 days ago"); mapped as-is. */
  date?: unknown
  /** Result rank on the page; present on the row, deliberately not mapped. */
  position?: unknown
}

/**
 * Map one SerpApi result row to a normalized source; rows without a usable
 * link are dropped.
 *
 * @param row - one `organic_results[]` row.
 * @returns the normalized source, or `undefined` to drop.
 */
export function mapSerpApiRow(row: SerpApiRow): WebSearchSource | undefined {
  if (typeof row.link !== 'string' || !URL.canParse(row.link)) return undefined
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const snippet = typeof row.snippet === 'string' ? row.snippet.trim() : ''
  const date = typeof row.date === 'string' ? row.date.trim() : ''
  return {
    url: row.link,
    ...title.length > 0 ? { title } : {},
    ...snippet.length > 0 ? { snippet } : {},
    ...date.length > 0 ? { publishedAt: date } : {},
  }
}

/** The SerpApi search adapter; a key is mandatory. */
export const serpApiAdapter: SearchAdapter = {
  kind: 'serpapi',
  defaultBaseURL: SERPAPI_DEFAULT_BASE_URL,
  anonymousOk: false,
  async search(query, maxResults, apiKey, baseURL, signal) {
    if (apiKey === undefined) {
      throw new WebError('SerpApi requires an API key and none resolved', 'WEB_PROVIDER_ERROR')
    }
    const body = await jsonRequest('SerpApi', serpapiURL(baseURL, query, apiKey, maxResults === undefined ? undefined : serpapiNum(maxResults)), {
      method: 'GET',
      headers: { accept: 'application/json' },
      ...signal === undefined ? {} : { signal },
    })
    return mapSerpApiResponse(body)
  },
}

/**
 * Map a SerpApi search response to the normalized result. A body whose only
 * payload is a non-blank top-level `error` string is a failure — SerpApi
 * reports errors that way even with HTTP 200 (e.g. `status: "Success"` plus
 * `"Google hasn't returned any results for this query."` when Google found
 * nothing) — so it throws and the queue falls through.
 *
 * @param body - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when the body carries an `error`
 *   string or no `organic_results` array.
 */
export function mapSerpApiResponse(body: unknown): WebSearchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WebError('SerpApi returned a non-object response body', 'WEB_PROVIDER_ERROR')
  }
  const envelope = body as Record<string, unknown>
  if (typeof envelope.error === 'string' && envelope.error.trim().length > 0) {
    throw new WebError(`SerpApi search failed: ${envelope.error.trim()}`, 'WEB_PROVIDER_ERROR')
  }
  const rows = envelope.organic_results
  if (!Array.isArray(rows)) {
    throw new WebError('SerpApi response carries no results array', 'WEB_PROVIDER_ERROR')
  }
  const sources = rows
    .map(row => (typeof row === 'object' && row !== null && !Array.isArray(row)
      ? mapSerpApiRow(row as Record<string, unknown> as SerpApiRow)
      : undefined))
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}
