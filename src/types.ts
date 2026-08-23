/**
 * Vocabulary for the aggregated web-search plugin: the queue-entry settings
 * shape, the plugin config that carries it, and the per-attempt failure
 * record the provider aggregates when every attempt fails.
 *
 * @module dsh-web-search-aggregation/types
 */

/** Provider kinds this plugin can drive. One adapter each; see `adapters/`. */
export type SearchProviderKind = 'anysearch' | 'tinyfish' | 'tavily'

/**
 * One entry of the priority queue. Order inside `Config.providers` IS the
 * priority: index 0 serves first, later entries are fallbacks.
 */
export interface QueueEntry {
  /** Which upstream search API this entry drives. */
  kind: SearchProviderKind
  /** False parks the entry without deleting it; it is skipped entirely. */
  enabled: boolean
  /**
   * Credential references (env-var-style names) tried in rotation for this
   * entry. `[]` means: anonymous access for `anysearch`, unusable for the
   * key-required kinds (the entry fails its attempts and the queue moves on).
   */
  apiKeyRefs: string[]
  /** Endpoint base overriding the adapter's default; empty/absent = default. */
  baseURL?: string
}

/** Plugin configuration — also the `web-search-aggregation` settings section. */
export interface AggregatedSearchConfig {
  /** The prioritized queue; empty means the provider is unavailable. */
  providers: QueueEntry[]
  /** Per-attempt budget (ms); a hung upstream cannot eat the whole call. */
  attemptTimeoutMs: number
}

/** Input the schema accepts: every field defaults when absent. */
export type ConfigInput = Partial<AggregatedSearchConfig>

/** Why one attempt (one entry × one key) failed; never carries a key literal. */
export interface AttemptFailure {
  /** Queue position of the entry (0-based, over enabled entries). */
  position: number
  /** Provider kind of the entry. */
  kind: SearchProviderKind
  /** Credential reference used, or `'anonymous'` when none. */
  keyRef: string
  /** Human-readable failure reason, already free of secret material. */
  reason: string
}
