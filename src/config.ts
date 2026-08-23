/**
 * Config schema, defaults, and normalization for the aggregated search
 * plugin. The schema resolves both the composition entry and the
 * `web-search-aggregation` settings section, so a queue a user writes by
 * hand into `settings.yaml` is validated at the same boundary.
 *
 * @module dsh-web-search-aggregation/config
 */

import z from '@deepseek-ai/schemastery'
import type { AggregatedSearchConfig, QueueEntry, SearchProviderKind } from './types.ts'

/** Lower bound for one attempt's timeout: below this, fallback is meaningless. */
export const MIN_ATTEMPT_TIMEOUT_MS = 1000

/** Upper bound for one attempt's timeout: the tool-level budget is 60 s. */
export const MAX_ATTEMPT_TIMEOUT_MS = 60000

/** Default per-attempt timeout: leaves room for 3–4 fallbacks inside the tool budget. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 15000

/** Default credential reference per kind — the conventional environment name. */
export const DEFAULT_KEY_REF: Readonly<Record<SearchProviderKind, string>> = {
  anysearch: 'ANYSEARCH_API_KEY',
  tinyfish: 'TINYFISH_API_KEY',
  tavily: 'TAVILY_API_KEY',
}

/** The shipped default queue: AnySearch (anonymous-capable) first, then the key-required kinds. */
export const DEFAULT_QUEUE: readonly QueueEntry[] = [
  { kind: 'anysearch', enabled: true, apiKeyRefs: ['ANYSEARCH_API_KEY'] },
  { kind: 'tavily', enabled: true, apiKeyRefs: ['TAVILY_API_KEY'] },
  { kind: 'tinyfish', enabled: true, apiKeyRefs: ['TINYFISH_API_KEY'] },
]

/** Plugin config (all optional — the schema fills constant defaults). */
export type ConfigInput = Partial<AggregatedSearchConfig>

/** The schemastery schema shared by the composition entry and the settings section. */
export const Config: z<AggregatedSearchConfig> = z.object({
  providers: z.array(z.object({
    kind: z.union(['anysearch', 'tinyfish', 'tavily'] as const),
    enabled: z.boolean().default(true),
    apiKeyRefs: z.array(z.string().role('credential-ref')).default([]),
    baseURL: z.string(),
  })).default(DEFAULT_QUEUE.map(entry => ({ ...entry, apiKeyRefs: [...entry.apiKeyRefs], baseURL: '' }))),
  attemptTimeoutMs: z.number().step(1).min(MIN_ATTEMPT_TIMEOUT_MS).max(MAX_ATTEMPT_TIMEOUT_MS)
    .default(DEFAULT_ATTEMPT_TIMEOUT_MS),
})

/**
 * Normalize one queue entry: trim strings, drop empty refs and an empty
 * `baseURL`, and drop duplicate refs (rotation treats the first occurrence
 * as the only one — a duplicate would double-count one key).
 *
 * @param entry - the schema-validated entry.
 * @returns the normalized entry.
 */
export function normalizeEntry(entry: QueueEntry): QueueEntry {
  const seen = new Set<string>()
  const apiKeyRefs: string[] = []
  for (const raw of entry.apiKeyRefs) {
    const ref = raw.trim()
    if (ref.length === 0 || seen.has(ref)) continue
    seen.add(ref)
    apiKeyRefs.push(ref)
  }
  const baseURL = entry.baseURL?.trim()
  return {
    kind: entry.kind,
    enabled: entry.enabled,
    apiKeyRefs,
    ...baseURL !== undefined && baseURL.length > 0 ? { baseURL } : {},
  }
}

/**
 * Resolve any accepted config input into the fully-defaulted, normalized
 * form the provider consumes per request.
 *
 * @param config - composition entry or settings-section value.
 * @returns the resolved config.
 */
export function resolveConfig(config: ConfigInput): AggregatedSearchConfig {
  // The input face is Partial by design (composition entries omit fields); the
  // schema's call signature expects the resolved shape, which defaults supply.
  const resolved = Config(config as AggregatedSearchConfig)
  return {
    providers: resolved.providers.map(normalizeEntry),
    attemptTimeoutMs: resolved.attemptTimeoutMs,
  }
}

/**
 * Suggest the next free credential reference for one kind against the refs
 * already in use anywhere in the queue: the conventional name, then `_2`,
 * `_3`, … — used by the settings card's add-key control.
 *
 * @param kind - the provider kind the key belongs to.
 * @param taken - every ref the queue already names.
 * @returns a reference name not present in `taken`.
 */
export function suggestKeyRef(kind: SearchProviderKind, taken: ReadonlySet<string>): string {
  const base = DEFAULT_KEY_REF[kind]
  if (!taken.has(base)) return base
  for (let index = 2; ; index++) {
    const candidate = `${base}_${String(index)}`
    if (!taken.has(candidate)) return candidate
  }
}
