/**
 * `AnySearchAdapter`: `POST {base}/v1/search` with an optional Bearer key
 * (AnySearch allows anonymous access). Response shape and envelope semantics
 * follow the official `anysearch-dsh` integration: `{code: 0, message,
 * data: {results: [{title, url, snippet?}]}}`.
 *
 * @module dsh-web-search-aggregation/adapters/anysearch
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchAdapter } from './adapter.ts'
import { KIND_DEFAULT_BASE_URL } from '../defaults.ts'
import { jsonRequest, optionalText } from './http.ts'

/** Public AnySearch API origin (single source: `defaults.ts`). */
export const ANYSEARCH_DEFAULT_BASE_URL = KIND_DEFAULT_BASE_URL.anysearch

/** One result row of AnySearch's `data.results[]`, as far as this adapter reads it. */
interface AnySearchRow {
  title?: unknown
  url?: unknown
  snippet?: unknown
}

/**
 * Map one AnySearch result row to a normalized source; rows without a usable
 * URL are dropped (the seam requires a citeable URL and inventing one would lie).
 *
 * @param row - one `data.results[]` row.
 * @returns the normalized source, or `undefined` to drop.
 */
export function mapAnySearchRow(row: AnySearchRow): WebSearchSource | undefined {
  if (typeof row.url !== 'string' || !URL.canParse(row.url)) return undefined
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const snippet = typeof row.snippet === 'string' ? row.snippet.trim() : ''
  return {
    url: row.url,
    ...title.length > 0 ? { title } : {},
    ...snippet.length > 0 ? { snippet } : {},
  }
}

/** The AnySearch search adapter. */
export const anySearchAdapter: SearchAdapter = {
  kind: 'anysearch',
  defaultBaseURL: ANYSEARCH_DEFAULT_BASE_URL,
  anonymousOk: true,
  async search(query, maxResults, apiKey, baseURL, signal) {
    const body = await jsonRequest('AnySearch', `${baseURL.replace(/\/+$/u, '')}/v1/search`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        ...apiKey !== undefined ? { authorization: `Bearer ${apiKey}` } : {},
      },
      body: JSON.stringify({
        query,
        ...maxResults === undefined ? {} : { max_results: maxResults },
      }),
      ...signal === undefined ? {} : { signal },
    })
    return mapAnySearchResponse(body)
  },
}

/**
 * Map an AnySearch response envelope to the normalized result.
 *
 * @param body - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when the envelope reports a business
 *   error (`code !== 0`) or carries no results array.
 */
export function mapAnySearchResponse(body: unknown): WebSearchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WebError('AnySearch returned a non-object response body', 'WEB_PROVIDER_ERROR')
  }
  const envelope = body as Record<string, unknown>
  const code = envelope.code
  if (code !== 0) {
    const message = optionalText(envelope, 'message') ?? `business code ${String(code)}`
    throw new WebError(`AnySearch API error: ${message}`, 'WEB_PROVIDER_ERROR')
  }
  const data = envelope.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new WebError('AnySearch response carries no data object', 'WEB_PROVIDER_ERROR')
  }
  const rows = (data as Record<string, unknown>).results
  if (!Array.isArray(rows)) {
    throw new WebError('AnySearch response carries no results array', 'WEB_PROVIDER_ERROR')
  }
  const sources = rows
    .map(row => (typeof row === 'object' && row !== null && !Array.isArray(row)
      ? mapAnySearchRow(row as Record<string, unknown> as AnySearchRow)
      : undefined))
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}
