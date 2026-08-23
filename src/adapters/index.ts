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
import { jinaAdapter } from './jina.ts'
import { serpApiAdapter } from './serpapi.ts'
import { serperAdapter } from './serper.ts'

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
export {
  JINA_DEFAULT_BASE_URL,
  JINA_MAX_NUM,
  jinaNum,
  mapJinaResponse,
  mapJinaRow,
} from './jina.ts'
export {
  SERPAPI_DEFAULT_BASE_URL,
  SERPAPI_MAX_NUM,
  mapSerpApiResponse,
  mapSerpApiRow,
  serpapiNum,
  serpapiURL,
} from './serpapi.ts'
export {
  SERPER_DEFAULT_BASE_URL,
  SERPER_MAX_NUM,
  SERPER_MIN_NUM,
  mapSerperResponse,
  mapSerperRow,
  serperNum,
} from './serper.ts'

/** Every adapter this build carries, keyed by its provider kind. */
export const ADAPTERS: Readonly<Record<SearchProviderKind, SearchAdapter>> = {
  anysearch: anySearchAdapter,
  tinyfish: tinyFishAdapter,
  tavily: tavilyAdapter,
  brave: braveAdapter,
  exa: exaAdapter,
  firecrawl: firecrawlAdapter,
  jina: jinaAdapter,
  serpapi: serpApiAdapter,
  serper: serperAdapter,
}
