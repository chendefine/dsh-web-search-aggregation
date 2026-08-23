/**
 * `TinyFishAdapter`: `GET {base}?query=…` with the `X-API-Key` header (the
 * Search API at `api.search.tinyfish.ai` requires a key; see
 * docs.tinyfish.ai/search-api). The API exposes no result-count control, so
 * the seam's `maxResults` truncation is the only bound.
 *
 * @module dsh-web-search-aggregation/adapters/tinyfish
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchAdapter } from './adapter.ts'
import { KIND_DEFAULT_BASE_URL } from '../defaults.ts'
import { jsonRequest } from './http.ts'

/** Public TinyFish Search API origin (single source: `defaults.ts`). */
export const TINYFISH_DEFAULT_BASE_URL = KIND_DEFAULT_BASE_URL.tinyfish

/** One result row of TinyFish's `results[]`, as far as this adapter reads it. */
interface TinyFishRow {
  title?: unknown
  url?: unknown
  snippet?: unknown
  date?: unknown
}

/**
 * Build the TinyFish request URL for one query.
 *
 * @param baseURL - the endpoint base (already defaulted).
 * @param query - the search query text.
 * @returns the absolute request URL.
 * @throws WebError `WEB_PROVIDER_ERROR` when the base is not an absolute URL.
 */
export function tinyfishURL(baseURL: string, query: string): string {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch (error: unknown) {
    throw new WebError(`TinyFish base URL is invalid: ${baseURL}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  url.searchParams.set('query', query)
  return url.href
}

/**
 * Map one TinyFish result row to a normalized source; rows without a usable
 * URL are dropped.
 *
 * @param row - one `results[]` row.
 * @returns the normalized source, or `undefined` to drop.
 */
export function mapTinyFishRow(row: TinyFishRow): WebSearchSource | undefined {
  if (typeof row.url !== 'string' || !URL.canParse(row.url)) return undefined
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const snippet = typeof row.snippet === 'string' ? row.snippet.trim() : ''
  const date = typeof row.date === 'string' ? row.date.trim() : ''
  return {
    url: row.url,
    ...title.length > 0 ? { title } : {},
    ...snippet.length > 0 ? { snippet } : {},
    ...date.length > 0 ? { publishedAt: date } : {},
  }
}

/** The TinyFish search adapter; a key is mandatory. */
export const tinyFishAdapter: SearchAdapter = {
  kind: 'tinyfish',
  defaultBaseURL: TINYFISH_DEFAULT_BASE_URL,
  anonymousOk: false,
  async search(query, _maxResults, apiKey, baseURL, signal) {
    if (apiKey === undefined) {
      throw new WebError('TinyFish requires an API key and none resolved', 'WEB_PROVIDER_ERROR')
    }
    const body = await jsonRequest('TinyFish', tinyfishURL(baseURL, query), {
      method: 'GET',
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      ...signal === undefined ? {} : { signal },
    })
    return mapTinyFishResponse(body)
  },
}

/**
 * Map a TinyFish search response to the normalized result.
 *
 * @param body - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when the body carries no results array.
 */
export function mapTinyFishResponse(body: unknown): WebSearchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WebError('TinyFish returned a non-object response body', 'WEB_PROVIDER_ERROR')
  }
  const rows = (body as Record<string, unknown>).results
  if (!Array.isArray(rows)) {
    throw new WebError('TinyFish response carries no results array', 'WEB_PROVIDER_ERROR')
  }
  const sources = rows
    .map(row => (typeof row === 'object' && row !== null && !Array.isArray(row)
      ? mapTinyFishRow(row as Record<string, unknown> as TinyFishRow)
      : undefined))
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}
