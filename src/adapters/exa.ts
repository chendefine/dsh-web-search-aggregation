/**
 * `ExaAdapter`: `POST {base}/search` with a Bearer key (see
 * exa.ai/docs/reference/search — current docs authenticate via
 * `Authorization: Bearer`). Sends `numResults` (1–100, clamped) and
 * `contents: { highlights: true }` — Exa's documented agent-workflow mode,
 * which attaches the token-efficient `highlights[]` excerpts each result
 * row carries as its snippet. Content parameters MUST nest under
 * `contents` on `/search`; the deprecated top-level spellings are not used.
 *
 * @module dsh-web-search-aggregation/adapters/exa
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchAdapter } from './adapter.ts'
import { KIND_DEFAULT_BASE_URL } from '../defaults.ts'
import { jsonRequest } from './http.ts'

/** Public Exa API origin (single source: `defaults.ts`). */
export const EXA_DEFAULT_BASE_URL = KIND_DEFAULT_BASE_URL.exa

/** Exa's documented maximum for `numResults` (1–100). */
export const EXA_MAX_NUM_RESULTS = 100

/** Result count sent when the request carries no `maxResults` (Exa's own default is 10). */
export const EXA_DEFAULT_NUM_RESULTS = 10

/**
 * Clamp one requested result count into Exa's 1–100 `numResults` window.
 *
 * @param count - the raw requested count.
 * @returns the clamped count.
 */
export function exaNumResults(count: number): number {
  return Math.min(Math.max(Math.trunc(count), 1), EXA_MAX_NUM_RESULTS)
}

/** One result row of Exa's `results[]`, as far as this adapter reads it. */
interface ExaRow {
  title?: unknown
  url?: unknown
  publishedDate?: unknown
  highlights?: unknown
}

/**
 * Map one Exa result row to a normalized source; rows without a usable URL
 * are dropped. The first non-blank highlight becomes the snippet (rows
 * requested without `contents.highlights` simply carry none).
 *
 * @param row - one `results[]` row.
 * @returns the normalized source, or `undefined` to drop.
 */
export function mapExaRow(row: ExaRow): WebSearchSource | undefined {
  if (typeof row.url !== 'string' || !URL.canParse(row.url)) return undefined
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const published = typeof row.publishedDate === 'string' ? row.publishedDate.trim() : ''
  const highlight = Array.isArray(row.highlights)
    ? row.highlights.find((part): part is string => typeof part === 'string' && part.trim().length > 0)
    : undefined
  const snippet = highlight?.trim() ?? ''
  return {
    url: row.url,
    ...title.length > 0 ? { title } : {},
    ...snippet.length > 0 ? { snippet } : {},
    ...published.length > 0 ? { publishedAt: published } : {},
  }
}

/** The Exa search adapter; a key is mandatory. */
export const exaAdapter: SearchAdapter = {
  kind: 'exa',
  defaultBaseURL: EXA_DEFAULT_BASE_URL,
  anonymousOk: false,
  async search(query, maxResults, apiKey, baseURL, signal) {
    if (apiKey === undefined) {
      throw new WebError('Exa requires an API key and none resolved', 'WEB_PROVIDER_ERROR')
    }
    const body = await jsonRequest('Exa', `${baseURL.replace(/\/+$/u, '')}/search`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        numResults: exaNumResults(maxResults ?? EXA_DEFAULT_NUM_RESULTS),
        contents: { highlights: true },
      }),
      ...signal === undefined ? {} : { signal },
    })
    return mapExaResponse(body)
  },
}

/**
 * Map an Exa search response to the normalized result.
 *
 * @param body - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when the body carries no results array.
 */
export function mapExaResponse(body: unknown): WebSearchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WebError('Exa returned a non-object response body', 'WEB_PROVIDER_ERROR')
  }
  const rows = (body as Record<string, unknown>).results
  if (!Array.isArray(rows)) {
    throw new WebError('Exa response carries no results array', 'WEB_PROVIDER_ERROR')
  }
  const sources = rows
    .map(row => (typeof row === 'object' && row !== null && !Array.isArray(row)
      ? mapExaRow(row as Record<string, unknown> as ExaRow)
      : undefined))
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}
