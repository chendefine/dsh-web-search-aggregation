/**
 * `SerperAdapter`: `POST {base}/search` with the key in the `X-API-KEY`
 * header (see serper.dev — the API playground documents the endpoint; a
 * faithful OpenAPI mirror lives at openapisearch.com/openapi/serper). The
 * body carries the query as `{"q": …}` plus `num` — documented as "Amount
 * of results 10-100 (default 10)" — ONLY when the request carries a result
 * count, clamped into that 10–100 window; an unspecified count inherits the
 * API default and the parameter is not sent at all. Clamping UP to 10 never
 * over-delivers: the web seam truncates `sources[]` to the request's
 * `maxResults` after the provider returns. `organic[]` maps `link` → url,
 * `title` → title, `snippet` → snippet, and `date` (Google's displayed date
 * string, not normalized ISO) → `publishedAt`. Failures — including non-2xx
 * bodies of the API's `{"message": …, "statusCode": …}` shape (e.g. HTTP
 * 403 `Unauthorized. Sign up for a free account.`) — map to
 * `WEB_PROVIDER_ERROR` so the queue falls through.
 *
 * @module dsh-web-search-aggregation/adapters/serper
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchAdapter } from './adapter.ts'
import { KIND_DEFAULT_BASE_URL } from '../defaults.ts'
import { jsonRequest } from './http.ts'

/** Public Serper API origin (single source: `defaults.ts`). */
export const SERPER_DEFAULT_BASE_URL = KIND_DEFAULT_BASE_URL.serper

/** Serper's documented minimum for `num` ("Amount of results 10-100"). */
export const SERPER_MIN_NUM = 10

/** Serper's documented maximum for `num` ("Amount of results 10-100"). */
export const SERPER_MAX_NUM = 100

/**
 * Clamp one requested result count into Serper's 10–100 `num` window. Only
 * used when the request actually carries a count; otherwise `num` is omitted
 * so the API default (10) applies. A count below 10 clamps UP to the window
 * floor — safe, because the seam truncates the returned sources to the
 * request's `maxResults`.
 *
 * @param count - the raw requested count.
 * @returns the clamped count.
 */
export function serperNum(count: number): number {
  return Math.min(Math.max(Math.trunc(count), SERPER_MIN_NUM), SERPER_MAX_NUM)
}

/** One result row of Serper's `organic[]`, as far as this adapter reads it. */
interface SerperRow {
  title?: unknown
  link?: unknown
  snippet?: unknown
  /** Google's displayed date ("Mar 10, 2022", "2 days ago"); mapped as-is. */
  date?: unknown
  /** Result rank on the page; present on the row, deliberately not mapped. */
  position?: unknown
}

/**
 * Map one Serper result row to a normalized source; rows without a usable
 * link are dropped.
 *
 * @param row - one `organic[]` row.
 * @returns the normalized source, or `undefined` to drop.
 */
export function mapSerperRow(row: SerperRow): WebSearchSource | undefined {
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

/** The Serper search adapter; a key is mandatory. */
export const serperAdapter: SearchAdapter = {
  kind: 'serper',
  defaultBaseURL: SERPER_DEFAULT_BASE_URL,
  anonymousOk: false,
  async search(query, maxResults, apiKey, baseURL, signal) {
    if (apiKey === undefined) {
      throw new WebError('Serper requires an API key and none resolved', 'WEB_PROVIDER_ERROR')
    }
    // The API path is appended to the base like every adapter does (Tavily
    // `/search`, Firecrawl `/v2/search`): the base is the origin — or a
    // proxy prefix — and the path lives in exactly one place.
    const body = await jsonRequest('Serper', `${baseURL.replace(/\/+$/u, '')}/search`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        q: query,
        ...maxResults === undefined ? {} : { num: serperNum(maxResults) },
      }),
      ...signal === undefined ? {} : { signal },
    })
    return mapSerperResponse(body)
  },
}

/**
 * Map a Serper search response to the normalized result. A body without an
 * `organic` array is a failure (the API's degenerate bodies are covered by
 * the non-2xx path, which throws earlier), so it throws and the queue falls
 * through.
 *
 * @param body - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when the body is not an object or
 *   carries no `organic` array.
 */
export function mapSerperResponse(body: unknown): WebSearchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WebError('Serper returned a non-object response body', 'WEB_PROVIDER_ERROR')
  }
  const rows = (body as Record<string, unknown>).organic
  if (!Array.isArray(rows)) {
    throw new WebError('Serper response carries no results array', 'WEB_PROVIDER_ERROR')
  }
  const sources = rows
    .map(row => (typeof row === 'object' && row !== null && !Array.isArray(row)
      ? mapSerperRow(row as Record<string, unknown> as SerperRow)
      : undefined))
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}
