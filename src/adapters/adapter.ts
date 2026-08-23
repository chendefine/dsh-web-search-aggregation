/**
 * The adapter contract: one upstream search API behind the queue. Adapters
 * own endpoint defaults, request construction, and response normalization;
 * key resolution, ordering, rotation, timeouts, and fallback live in the
 * provider.
 *
 * @module dsh-web-search-aggregation/adapters/adapter
 */

import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import type { SearchProviderKind } from '../types.ts'

/** The contract every provider adapter implements. */
export interface SearchAdapter {
  /** Provider kind the adapter serves; also the registry key. */
  readonly kind: SearchProviderKind
  /** Endpoint base used when a queue entry carries no `baseURL`. */
  readonly defaultBaseURL: string
  /** Whether one attempt without a resolved key can succeed (AnySearch: yes). */
  readonly anonymousOk: boolean
  /**
   * Run one search attempt.
   *
   * @param query - the search query text.
   * @param maxResults - requested result count, when the request carries one.
   * @param apiKey - the resolved key for this attempt, or `undefined` when none.
   * @param baseURL - the entry's endpoint base (already defaulted).
   * @param signal - cancellation scoped to this attempt.
   * @returns the normalized search result.
   * @throws WebError `WEB_ABORTED` when `signal` aborted, `WEB_PROVIDER_ERROR`
   *   for every upstream failure; the provider records and falls through.
   */
  search(
    query: string,
    maxResults: number | undefined,
    apiKey: string | undefined,
    baseURL: string,
    signal: AbortSignal | undefined,
  ): Promise<WebSearchResult>
}
