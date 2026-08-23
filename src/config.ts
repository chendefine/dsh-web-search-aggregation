/**
 * Config schema, defaults, and normalization for the aggregated search
 * plugin. The schema resolves both the composition entry and the
 * `web-search-aggregation` settings section, so a queue a user writes by
 * hand into `settings.yaml` is validated at the same boundary.
 *
 * One provider kind appears at most once in the queue (normalization keeps
 * the first entry per kind), and each kind reads exactly one fixed
 * credential — `DEFAULT_KEY_REF[kind]` — whose value holds all its API keys
 * joined by `,` (a single key is stored bare; see `keys.ts`).
 *
 * @module dsh-web-search-aggregation/config
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  KIND_CREDENTIAL_REF,
  MAX_ATTEMPT_TIMEOUT_MS,
  MIN_ATTEMPT_TIMEOUT_MS,
  PROVIDER_KINDS,
} from './defaults.ts'
import type { AggregatedSearchConfig, QueueEntry, SearchProviderKind } from './types.ts'

// Public-API names for the shared constants (single source: `defaults.ts`).
export {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  MAX_ATTEMPT_TIMEOUT_MS,
  MIN_ATTEMPT_TIMEOUT_MS,
}
/**
 * The single credential reference each kind reads — the conventional
 * environment name. Its value is the provider's keys joined by `,`
 * (single source `KIND_CREDENTIAL_REF` in `defaults.ts`).
 */
export { KIND_CREDENTIAL_REF as DEFAULT_KEY_REF }

/**
 * The shipped default queue: one enabled entry per kind — AnySearch sits
 * first only so the queue serves with no keys configured; beyond that the
 * order carries no meaning and is the user's to arrange in the card.
 */
export const DEFAULT_QUEUE: readonly QueueEntry[] = [
  { kind: 'anysearch', enabled: true },
  { kind: 'tavily', enabled: true },
  { kind: 'tinyfish', enabled: true },
  { kind: 'brave', enabled: true },
  { kind: 'exa', enabled: true },
  { kind: 'firecrawl', enabled: true },
  { kind: 'jina', enabled: true },
  { kind: 'serpapi', enabled: true },
  { kind: 'serper', enabled: true },
]

/** Plugin config (all optional — the schema fills constant defaults). */
export type ConfigInput = Partial<AggregatedSearchConfig>

/** The schemastery schema shared by the composition entry and the settings section. */
export const Config: z<AggregatedSearchConfig> = z.object({
  providers: z.array(z.object({
    kind: z.union(PROVIDER_KINDS),
    enabled: z.boolean().default(true),
    baseURL: z.string(),
  })).default(DEFAULT_QUEUE.map(entry => ({ ...entry, baseURL: '' }))),
  attemptTimeoutMs: z.number().step(1).min(MIN_ATTEMPT_TIMEOUT_MS).max(MAX_ATTEMPT_TIMEOUT_MS)
    .default(DEFAULT_ATTEMPT_TIMEOUT_MS),
})

/**
 * Normalize one queue entry: trim the endpoint override and drop it when
 * empty. (API keys are not part of the entry — the kind's fixed credential
 * carries them; hand-written `apiKeyRefs` rows are simply ignored.)
 *
 * @param entry - the schema-validated entry.
 * @returns the normalized entry.
 */
export function normalizeEntry(entry: QueueEntry): QueueEntry {
  const baseURL = entry.baseURL?.trim()
  return {
    kind: entry.kind,
    enabled: entry.enabled,
    ...baseURL !== undefined && baseURL.length > 0 ? { baseURL } : {},
  }
}

/**
 * Resolve any accepted config input into the fully-defaulted, normalized
 * form the provider consumes per request. Later entries whose kind already
 * appeared are dropped (one provider can be queued once).
 *
 * @param config - composition entry or settings-section value.
 * @returns the resolved config.
 */
export function resolveConfig(config: ConfigInput): AggregatedSearchConfig {
  // The input face is Partial by design (composition entries omit fields); the
  // schema's call signature expects the resolved shape, which defaults supply.
  const resolved = Config(config as AggregatedSearchConfig)
  const seen = new Set<SearchProviderKind>()
  const providers: QueueEntry[] = []
  for (const raw of resolved.providers) {
    if (seen.has(raw.kind)) continue
    seen.add(raw.kind)
    providers.push(normalizeEntry(raw))
  }
  return {
    providers,
    attemptTimeoutMs: resolved.attemptTimeoutMs,
  }
}
