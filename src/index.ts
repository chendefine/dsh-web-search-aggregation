/**
 * `dsh-web-search-aggregation`: registers the queue-backed
 * {@link AggregatedSearchProvider} with `ctx.web` and exposes its settings
 * section ('web-search-aggregation') so the web client's plugin-configuration
 * card can edit the queue live — a committed change reaches the next search
 * without a restart.
 *
 * A function plugin (NOT a default-export service): like the shipped search
 * providers, it registers INTO the web seam's search registry.
 *
 * @module dsh-web-search-aggregation
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-web'
import { Config, resolveConfig } from './config.ts'
import type { ConfigInput } from './config.ts'
import type { AggregatedSearchConfig } from './types.ts'
import { AggregatedSearchProvider, AGGREGATED_PROVIDER_ID } from './provider.ts'

export { Config, DEFAULT_QUEUE, resolveConfig } from './config.ts'
export {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_KEY_REF,
  MAX_ATTEMPT_TIMEOUT_MS,
  MIN_ATTEMPT_TIMEOUT_MS,
} from './config.ts'
export { formatApiKeys, keyRefLabel, maskApiKey, parseApiKeys } from './keys.ts'
export type {
  AggregatedSearchConfig,
  AttemptFailure,
  QueueEntry,
  SearchProviderKind,
} from './types.ts'
export type { ConfigInput } from './config.ts'
export {
  ADAPTERS,
  ANYSEARCH_DEFAULT_BASE_URL,
  BRAVE_DEFAULT_BASE_URL,
  BRAVE_DEFAULT_COUNT,
  BRAVE_MAX_COUNT,
  EXA_DEFAULT_BASE_URL,
  EXA_DEFAULT_NUM_RESULTS,
  EXA_MAX_NUM_RESULTS,
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_LIMIT,
  FIRECRAWL_MAX_LIMIT,
  JINA_DEFAULT_BASE_URL,
  JINA_MAX_NUM,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_MAX_RESULTS,
  TINYFISH_DEFAULT_BASE_URL,
  braveCount,
  braveURL,
  exaNumResults,
  firecrawlLimit,
  jinaNum,
  mapBraveResponse,
  mapBraveRow,
  mapExaResponse,
  mapExaRow,
  mapFirecrawlResponse,
  mapFirecrawlRow,
  mapJinaResponse,
  mapJinaRow,
} from './adapters/index.ts'
export { AggregatedSearchProvider, AGGREGATED_PROVIDER_ID } from './provider.ts'
export type {
  AggregatedSearchProviderOptions,
  ProviderLogger,
} from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-web-search-aggregation'

/** The capability seams this plugin registers into. */
export const inject = ['web', 'credentials']

/** Settings namespace carrying this provider's configuration card. */
export const WEB_SEARCH_AGGREGATION_SETTINGS_NAMESPACE = settingsNamespace('web-search-aggregation')

/**
 * Register the aggregated search provider with `ctx.web`.
 *
 * @param ctx - plugin context supplying the web seam and the credentials domain.
 * @param config - the composition entry config; also the settings section's base layer.
 */
export function apply(ctx: Context, config: ConfigInput = {}): void {
  // `current` is REASSIGNED by setSource when the settings scope attaches
  // (possibly after this function returns), so the provider receives an
  // indirection that re-resolves AND re-normalizes per call — the same wrapper
  // idiom the shipped providers use.
  let current: () => ConfigInput = () => config
  installSettingsSection(ctx, WEB_SEARCH_AGGREGATION_SETTINGS_NAMESPACE, Config, config as AggregatedSearchConfig, {
    setSource: (source) => {
      current = source as () => ConfigInput
    },
    // The provider projects the section per search, so a committed change
    // needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new AggregatedSearchProvider({
    config: () => resolveConfig(current()),
    resolveKey: async (ref) => {
      if (!isCredentialRefName(ref)) return undefined
      return (await ctx.credentials.resolve(credentialRef(ref)))?.value
    },
    logger: ctx.logger,
  }))
}
