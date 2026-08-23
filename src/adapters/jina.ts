/**
 * `JinaAdapter`: `POST {base}/` with a Bearer key (see docs.jina.ai — Search
 * Foundation / Search API, and the live spec at s.jina.ai/openapi.json). The
 * current contract takes the query as a JSON body (`{"q": …}`); a key is
 * MANDATORY (anonymous calls answer 401 AuthenticationRequiredError). Sends
 * `X-Respond-With: no-content` — the documented SERP-only mode, which skips
 * visiting every result page: each row then carries the SERP entry itself
 * (title / url / description / publishedTime) with no per-page fetch latency
 * or token cost. `X-Retain-Images: none` keeps page content image-free. The
 * documented `num` (0–20) is sent ONLY when the request carries a result
 * count — Jina's own docs warn it can add latency, so an unspecified count
 * inherits the API default instead of forcing one. The EU-residency mirror
 * (`https://eu.s.jina.ai`) or a proxy base overrides through `baseURL`.
 *
 * @module dsh-web-search-aggregation/adapters/jina
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchAdapter } from './adapter.ts'
import { KIND_DEFAULT_BASE_URL } from '../defaults.ts'
import { jsonRequest } from './http.ts'

/** Public Jina Search API origin (single source: `defaults.ts`). */
export const JINA_DEFAULT_BASE_URL = KIND_DEFAULT_BASE_URL.jina

/** Jina's documented maximum for `num` (validated 0–20 upstream). */
export const JINA_MAX_NUM = 20

/**
 * Clamp one requested result count into Jina's 1–20 `num` window. Only used
 * when the request actually carries a count; otherwise `num` is omitted so
 * the API default applies.
 *
 * @param count - the raw requested count.
 * @returns the clamped count.
 */
export function jinaNum(count: number): number {
  return Math.min(Math.max(Math.trunc(count), 1), JINA_MAX_NUM)
}

/**
 * One result row of Jina's search response (`data[]`, a FormattedPage as the
 * reader codebase shapes it), as far as this adapter reads it.
 */
interface JinaRow {
  title?: unknown
  url?: unknown
  description?: unknown
  publishedTime?: unknown
}

/**
 * Map one Jina result row to a normalized source; rows without a usable URL
 * are dropped. The SERP snippet rides `description` (with
 * `X-Respond-With: no-content` the rows carry no page `content`).
 *
 * @param row - one `data[]` row.
 * @returns the normalized source, or `undefined` to drop.
 */
export function mapJinaRow(row: JinaRow): WebSearchSource | undefined {
  if (typeof row.url !== 'string' || !URL.canParse(row.url)) return undefined
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const description = typeof row.description === 'string' ? row.description.trim() : ''
  const published = typeof row.publishedTime === 'string' ? row.publishedTime.trim() : ''
  return {
    url: row.url,
    ...title.length > 0 ? { title } : {},
    ...description.length > 0 ? { snippet: description } : {},
    ...published.length > 0 ? { publishedAt: published } : {},
  }
}

/** The Jina search adapter; a key is mandatory. */
export const jinaAdapter: SearchAdapter = {
  kind: 'jina',
  defaultBaseURL: JINA_DEFAULT_BASE_URL,
  anonymousOk: false,
  async search(query, maxResults, apiKey, baseURL, signal) {
    if (apiKey === undefined) {
      throw new WebError('Jina requires an API key and none resolved', 'WEB_PROVIDER_ERROR')
    }
    const body = await jsonRequest('Jina', `${baseURL.replace(/\/+$/u, '')}/`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
        'x-respond-with': 'no-content',
        'x-retain-images': 'none',
      },
      body: JSON.stringify({
        q: query,
        ...maxResults === undefined ? {} : { num: jinaNum(maxResults) },
      }),
      ...signal === undefined ? {} : { signal },
    })
    return mapJinaResponse(body)
  },
}

/**
 * Map a Jina search response to the normalized result: the JSON envelope
 * (`Accept: application/json`) is `{code, status, data: […]}` with one
 * FormattedPage row per result; a bare array is accepted too, so an envelope
 * drift does not break the adapter.
 *
 * @param body - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when neither shape carries a results
 *   array.
 */
export function mapJinaResponse(body: unknown): WebSearchResult {
  if (typeof body !== 'object' || body === null) {
    throw new WebError('Jina returned a non-object response body', 'WEB_PROVIDER_ERROR')
  }
  const rows = Array.isArray(body)
    ? body
    : (body as Record<string, unknown>).data
  if (!Array.isArray(rows)) {
    throw new WebError('Jina response carries no results array', 'WEB_PROVIDER_ERROR')
  }
  const sources = rows
    .map(row => (typeof row === 'object' && row !== null && !Array.isArray(row)
      ? mapJinaRow(row as Record<string, unknown> as JinaRow)
      : undefined))
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}
