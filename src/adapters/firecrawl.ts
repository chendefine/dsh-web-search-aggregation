/**
 * `FirecrawlAdapter`: `POST {base}/v2/search` with a Bearer key (see
 * docs.firecrawl.dev/api-reference/endpoint/search). Sends `limit`
 * (1–100, clamped) and deliberately NO `scrapeOptions`: the plain search
 * costs 2 credits per 10 results and returns `data.web[]` rows of
 * url/title/description — enough for the seam, with no per-page scraping
 * cost or latency.
 *
 * @module dsh-web-search-aggregation/adapters/firecrawl
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchAdapter } from './adapter.ts'
import { KIND_DEFAULT_BASE_URL } from '../defaults.ts'
import { jsonRequest, optionalText } from './http.ts'

/** Public Firecrawl API origin (single source: `defaults.ts`). */
export const FIRECRAWL_DEFAULT_BASE_URL = KIND_DEFAULT_BASE_URL.firecrawl

/** Firecrawl's documented maximum for `limit` (1–100). */
export const FIRECRAWL_MAX_LIMIT = 100

/** Result count sent when the request carries no `maxResults` (the docs' default limit is 10). */
export const FIRECRAWL_DEFAULT_LIMIT = 10

/**
 * Clamp one requested result count into Firecrawl's 1–100 `limit` window.
 *
 * @param count - the raw requested count.
 * @returns the clamped count.
 */
export function firecrawlLimit(count: number): number {
  return Math.min(Math.max(Math.trunc(count), 1), FIRECRAWL_MAX_LIMIT)
}

/** One result row of Firecrawl's `data.web[]`, as far as this adapter reads it. */
interface FirecrawlRow {
  title?: unknown
  url?: unknown
  description?: unknown
}

/**
 * Map one Firecrawl result row to a normalized source; rows without a usable
 * URL are dropped.
 *
 * @param row - one `data.web[]` row.
 * @returns the normalized source, or `undefined` to drop.
 */
export function mapFirecrawlRow(row: FirecrawlRow): WebSearchSource | undefined {
  if (typeof row.url !== 'string' || !URL.canParse(row.url)) return undefined
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const description = typeof row.description === 'string' ? row.description.trim() : ''
  return {
    url: row.url,
    ...title.length > 0 ? { title } : {},
    ...description.length > 0 ? { snippet: description } : {},
  }
}

/** The Firecrawl search adapter; a key is mandatory. */
export const firecrawlAdapter: SearchAdapter = {
  kind: 'firecrawl',
  defaultBaseURL: FIRECRAWL_DEFAULT_BASE_URL,
  anonymousOk: false,
  async search(query, maxResults, apiKey, baseURL, signal) {
    if (apiKey === undefined) {
      throw new WebError('Firecrawl requires an API key and none resolved', 'WEB_PROVIDER_ERROR')
    }
    const body = await jsonRequest('Firecrawl', `${baseURL.replace(/\/+$/u, '')}/v2/search`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        limit: firecrawlLimit(maxResults ?? FIRECRAWL_DEFAULT_LIMIT),
      }),
      ...signal === undefined ? {} : { signal },
    })
    return mapFirecrawlResponse(body)
  },
}

/**
 * Map a Firecrawl search response to the normalized result.
 *
 * @param body - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when the body reports failure
 *   (`success === false`) or carries no `data.web` array.
 */
export function mapFirecrawlResponse(body: unknown): WebSearchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WebError('Firecrawl returned a non-object response body', 'WEB_PROVIDER_ERROR')
  }
  const envelope = body as Record<string, unknown>
  if (envelope.success === false) {
    const warning = optionalText(envelope, 'warning')
    throw new WebError(`Firecrawl reported a failed search${warning === undefined ? '' : `: ${warning}`}`, 'WEB_PROVIDER_ERROR')
  }
  const data = envelope.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new WebError('Firecrawl response carries no data object', 'WEB_PROVIDER_ERROR')
  }
  const rows = (data as Record<string, unknown>).web
  if (!Array.isArray(rows)) {
    throw new WebError('Firecrawl response carries no web results array', 'WEB_PROVIDER_ERROR')
  }
  const sources = rows
    .map(row => (typeof row === 'object' && row !== null && !Array.isArray(row)
      ? mapFirecrawlRow(row as Record<string, unknown> as FirecrawlRow)
      : undefined))
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}
