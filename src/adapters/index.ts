/**
 * The adapter registry: every provider kind this build knows, keyed by kind.
 * Adding a fourth upstream is one adapter module plus one row here.
 *
 * @module dsh-web-search-aggregation/adapters
 */

import type { SearchProviderKind } from '../types.ts'
import type { SearchAdapter } from './adapter.ts'
import { anySearchAdapter } from './anysearch.ts'
import { tinyFishAdapter } from './tinyfish.ts'
import { tavilyAdapter } from './tavily.ts'

export type { SearchAdapter } from './adapter.ts'
export {
  ANYSEARCH_DEFAULT_BASE_URL,
  mapAnySearchResponse,
  mapAnySearchRow,
} from './anysearch.ts'
export {
  TINYFISH_DEFAULT_BASE_URL,
  mapTinyFishResponse,
  mapTinyFishRow,
  tinyfishURL,
} from './tinyfish.ts'
export {
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_MAX_RESULTS,
  mapTavilyResponse,
  mapTavilyRow,
} from './tavily.ts'

/** Every adapter this build carries, keyed by its provider kind. */
export const ADAPTERS: Readonly<Record<SearchProviderKind, SearchAdapter>> = {
  anysearch: anySearchAdapter,
  tinyfish: tinyFishAdapter,
  tavily: tavilyAdapter,
}
