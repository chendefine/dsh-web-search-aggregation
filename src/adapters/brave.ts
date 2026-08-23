/**
 * `BraveAdapter`: `GET {base}/res/v1/web/search?q=…&count=…` with the
 * `X-Subscription-Token` header (see
 * api-dashboard.search.brave.com/api-reference/web/search/get). `count` is
 * clamped to the API's 1–20 window (Brave rejects more with a 422), and
 * `text_decorations=false` keeps snippets free of the default
 * bold-marker decorations. `page_age` (an ISO datetime string) becomes
 * `publishedAt`; the human-readable `age` ("2 days ago") is not a date
 * and stays out.
 *
 * @module dsh-web-search-aggregation/adapters/brave
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchAdapter } from './adapter.ts'
import { KIND_DEFAULT_BASE_URL } from '../defaults.ts'
import { jsonRequest } from './http.ts'

/** Public Brave Search API origin (single source: `defaults.ts`). */
export const BRAVE_DEFAULT_BASE_URL = KIND_DEFAULT_BASE_URL.brave

/** Brave's documented maximum for `count` (1–20). */
export const BRAVE_MAX_COUNT = 20

/** Result count sent when the request carries no `maxResults` (Brave's own default is 20). */
export const BRAVE_DEFAULT_COUNT = 20

/**
 * Clamp one requested result count into Brave's 1–20 `count` window.
 *
 * @param count - the raw requested count.
 * @returns the clamped count.
 */
export function braveCount(count: number): number {
  return Math.min(Math.max(Math.trunc(count), 1), BRAVE_MAX_COUNT)
}

/**
 * Build the Brave request URL for one query.
 *
 * @param baseURL - the endpoint base (already defaulted).
 * @param query - the search query text.
 * @param count - the clamped result count.
 * @returns the absolute request URL.
 * @throws WebError `WEB_PROVIDER_ERROR` when the base is not an absolute URL.
 */
export function braveURL(baseURL: string, query: string, count: number): string {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch (error: unknown) {
    throw new WebError(`Brave base URL is invalid: ${baseURL}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  // The API path is appended to the base like every adapter does (Tavily
  // `/search`, Firecrawl `/v2/search`): the base is the origin — or a proxy
  // prefix — and the path lives in exactly one place. Brave's apex answers
  // 301 to its dashboard site, which a path-less request would hit.
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/res/v1/web/search`
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(count))
  url.searchParams.set('text_decorations', 'false')
  return url.href
}

/** One result row of Brave's `web.results[]`, as far as this adapter reads it. */
interface BraveRow {
  title?: unknown
  url?: unknown
  description?: unknown
  page_age?: unknown
  /** Human-readable age ("2 days ago"); present on the row, deliberately not mapped. */
  age?: unknown
}

/**
 * Map one Brave result row to a normalized source; rows without a usable URL
 * are dropped.
 *
 * @param row - one `web.results[]` row.
 * @returns the normalized source, or `undefined` to drop.
 */
export function mapBraveRow(row: BraveRow): WebSearchSource | undefined {
  if (typeof row.url !== 'string' || !URL.canParse(row.url)) return undefined
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const description = typeof row.description === 'string' ? row.description.trim() : ''
  const pageAge = typeof row.page_age === 'string' ? row.page_age.trim() : ''
  return {
    url: row.url,
    ...title.length > 0 ? { title } : {},
    ...description.length > 0 ? { snippet: description } : {},
    ...pageAge.length > 0 ? { publishedAt: pageAge } : {},
  }
}

/** The Brave search adapter; a key (subscription token) is mandatory. */
export const braveAdapter: SearchAdapter = {
  kind: 'brave',
  defaultBaseURL: BRAVE_DEFAULT_BASE_URL,
  anonymousOk: false,
  async search(query, maxResults, apiKey, baseURL, signal) {
    if (apiKey === undefined) {
      throw new WebError('Brave requires an API key and none resolved', 'WEB_PROVIDER_ERROR')
    }
    const count = braveCount(maxResults ?? BRAVE_DEFAULT_COUNT)
    const body = await jsonRequest('Brave', braveURL(baseURL, query, count), {
      method: 'GET',
      headers: { accept: 'application/json', 'x-subscription-token': apiKey },
      ...signal === undefined ? {} : { signal },
    })
    return mapBraveResponse(body)
  },
}

/**
 * Map a Brave search response to the normalized result.
 *
 * @param body - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when the body carries no `web.results`
 *   array.
 */
export function mapBraveResponse(body: unknown): WebSearchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WebError('Brave returned a non-object response body', 'WEB_PROVIDER_ERROR')
  }
  const web = (body as Record<string, unknown>).web
  if (typeof web !== 'object' || web === null || Array.isArray(web)) {
    throw new WebError('Brave response carries no web results object', 'WEB_PROVIDER_ERROR')
  }
  const rows = (web as Record<string, unknown>).results
  if (!Array.isArray(rows)) {
    throw new WebError('Brave response carries no results array', 'WEB_PROVIDER_ERROR')
  }
  const sources = rows
    .map(row => (typeof row === 'object' && row !== null && !Array.isArray(row)
      ? mapBraveRow(row as Record<string, unknown> as BraveRow)
      : undefined))
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}
