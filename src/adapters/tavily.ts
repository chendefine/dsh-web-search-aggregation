/**
 * `TavilyAdapter`: `POST {base}/search` with a Bearer key (see
 * docs.tavily.com/documentation/api-reference/endpoint/search). Sends
 * `max_results` as the request-layer cost control and `include_answer` so the
 * optional generated answer rides `WebSearchResult.content`.
 *
 * @module dsh-web-search-aggregation/adapters/tavily
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchAdapter } from './adapter.ts'
import { KIND_DEFAULT_BASE_URL } from '../defaults.ts'
import { jsonRequest } from './http.ts'

/** Public Tavily API origin (single source: `defaults.ts`). */
export const TAVILY_DEFAULT_BASE_URL = KIND_DEFAULT_BASE_URL.tavily

/** Result count sent when the request carries no `maxResults` (Tavily's own default is 5). */
export const TAVILY_DEFAULT_MAX_RESULTS = 5

/** One result row of Tavily's `results[]`, as far as this adapter reads it. */
interface TavilyRow {
  title?: unknown
  url?: unknown
  content?: unknown
  published_date?: unknown
}

/**
 * Map one Tavily result row to a normalized source; rows without a usable URL
 * are dropped.
 *
 * @param row - one `results[]` row.
 * @returns the normalized source, or `undefined` to drop.
 */
export function mapTavilyRow(row: TavilyRow): WebSearchSource | undefined {
  if (typeof row.url !== 'string' || !URL.canParse(row.url)) return undefined
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const content = typeof row.content === 'string' ? row.content.trim() : ''
  const published = typeof row.published_date === 'string' ? row.published_date.trim() : ''
  return {
    url: row.url,
    ...title.length > 0 ? { title } : {},
    ...content.length > 0 ? { snippet: content } : {},
    ...published.length > 0 ? { publishedAt: published } : {},
  }
}

/** The Tavily search adapter; a key is mandatory. */
export const tavilyAdapter: SearchAdapter = {
  kind: 'tavily',
  defaultBaseURL: TAVILY_DEFAULT_BASE_URL,
  anonymousOk: false,
  async search(query, maxResults, apiKey, baseURL, signal) {
    if (apiKey === undefined) {
      throw new WebError('Tavily requires an API key and none resolved', 'WEB_PROVIDER_ERROR')
    }
    const body = await jsonRequest('Tavily', `${baseURL.replace(/\/+$/u, '')}/search`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults ?? TAVILY_DEFAULT_MAX_RESULTS,
        search_depth: 'basic',
        include_answer: true,
        include_raw_content: false,
        include_images: false,
      }),
      ...signal === undefined ? {} : { signal },
    })
    return mapTavilyResponse(body)
  },
}

/**
 * Map a Tavily search response to the normalized result; `answer`, when a
 * non-blank string, becomes `content`.
 *
 * @param body - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when the body carries no results array.
 */
export function mapTavilyResponse(body: unknown): WebSearchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new WebError('Tavily returned a non-object response body', 'WEB_PROVIDER_ERROR')
  }
  const rows = (body as Record<string, unknown>).results
  if (!Array.isArray(rows)) {
    throw new WebError('Tavily response carries no results array', 'WEB_PROVIDER_ERROR')
  }
  const sources = rows
    .map(row => (typeof row === 'object' && row !== null && !Array.isArray(row)
      ? mapTavilyRow(row as Record<string, unknown> as TavilyRow)
      : undefined))
    .filter((source): source is WebSearchSource => source !== undefined)
  const answer = (body as Record<string, unknown>).answer
  const content = typeof answer === 'string' && answer.trim().length > 0 ? answer.trim() : undefined
  return {
    sources,
    truncated: false,
    ...content === undefined ? {} : { content },
  }
}
