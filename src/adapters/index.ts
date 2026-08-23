/**
 * The adapter registry: every provider kind this build knows, keyed by kind.
 * Adding another upstream is one adapter module plus one row here.
 *
 * @module dsh-web-search-aggregation/adapters
 */

import type { SearchProviderKind } from '../types.ts'
import type { SearchAdapter } from './adapter.ts'
import { anySearchAdapter } from './anysearch.ts'
import { tinyFishAdapter } from './tinyfish.ts'
import { tavilyAdapter } from './tavily.ts'
import { braveAdapter } from './brave.ts'
import { exaAdapter } from './exa.ts'
import { firecrawlAdapter } from './firecrawl.ts'

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
export {
  BRAVE_DEFAULT_BASE_URL,
  BRAVE_DEFAULT_COUNT,
  BRAVE_MAX_COUNT,
  braveCount,
  braveURL,
  mapBraveResponse,
  mapBraveRow,
} from './brave.ts'
export {
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_NUM_RESULTS,
  EXA_MAX_NUM_RESULTS,
  exaNumResults,
  mapExaResponse,
  mapExaRow,
} from './exa.ts'
export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_LIMIT,
  FIRECRAWL_MAX_LIMIT,
  firecrawlLimit,
  mapFirecrawlResponse,
  mapFirecrawlRow,
} from './firecrawl.ts'

/** Every adapter this build carries, keyed by its provider kind. */
export const ADAPTERS: Readonly<Record<SearchProviderKind, SearchAdapter>> = {
  anysearch: anySearchAdapter,
  tinyfish: tinyFishAdapter,
  tavily: tavilyAdapter,
  brave: braveAdapter,
  exa: exaAdapter,
  firecrawl: firecrawlAdapter,
}
