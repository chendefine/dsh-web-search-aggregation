/**
 * `AggregatedSearchProvider`: one `WebSearchProvider` whose backend is a
 * prioritized queue of upstream entries. Per request it walks enabled entries
 * in configured order; within an entry it walks the resolved keys starting at
 * a rotating cursor; the first attempt that returns wins and every failure is
 * recorded, so an all-failed call can report each attempt. Caller cancellation
 * stops the walk immediately; the per-attempt timeout bounds one hung upstream.
 *
 * @module dsh-web-search-aggregation/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { ADAPTERS } from './adapters/index.ts'
import type { AggregatedSearchConfig, AttemptFailure, QueueEntry } from './types.ts'

/** Stable id this provider registers under. */
export const AGGREGATED_PROVIDER_ID = 'aggregated'

/** One resolved key of an entry, addressed by its credential reference. */
interface ResolvedKey {
  /** Credential reference the value came from. */
  ref: string
  /** The secret literal; never logged and never put in an {@link AttemptFailure}. */
  value: string | undefined
}

/** The minimal logger face the provider needs (cordis loggers satisfy it). */
export interface ProviderLogger {
  /** Routine attempt outcomes. */
  info: (format: string, ...args: unknown[]) => void
  /** Failed attempts worth operator attention. */
  warn: (format: string, ...args: unknown[]) => void
}

/** Options the plugin's `apply` supplies; both thunks are read per request. */
export interface AggregatedSearchProviderOptions {
  /** The currently authoritative resolved config. */
  config: () => AggregatedSearchConfig
  /** Resolve one credential reference; `undefined` when no layer supplies it. */
  resolveKey: (ref: string) => Promise<string | undefined>
  /** Logger for attempt outcomes; secrets never reach it. */
  logger: ProviderLogger
}

/**
 * The queue-backed search provider registered as `ctx.web`'s `aggregated`
 * provider. Config is projected per request, so a committed settings change
 * reaches the next search with no re-registration.
 */
export class AggregatedSearchProvider implements WebSearchProvider {
  readonly id = AGGREGATED_PROVIDER_ID

  /**
   * Rotation cursors keyed by entry signature (kind + endpoint + refs): the
   * resolved-key index the next request for that entry starts at. A signature
   * change (edited refs, endpoint) intentionally resets the rotation.
   */
  private readonly cursors = new Map<string, number>()

  constructor(private readonly options: AggregatedSearchProviderOptions) {}

  /** Cheap local check: at least one enabled entry is configured. */
  available(): boolean {
    return this.options.config().providers.some(entry => entry.enabled)
  }

  /**
   * Run one search through the queue: entries in order, keys in rotation
   * order per entry, first success returned.
   *
   * @param request - the query and optional result limit.
   * @param signal - caller cancellation; aborts the walk immediately.
   * @returns the first successful attempt's normalized result.
   * @throws WebError `WEB_ABORTED` when the caller cancelled, `WEB_PROVIDER_UNAVAILABLE`
   *   when no enabled entry exists, `WEB_PROVIDER_ERROR` with the per-attempt
   *   summary when every attempt failed.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const { providers, attemptTimeoutMs } = this.options.config()
    const entries = providers.filter(entry => entry.enabled)
    if (entries.length === 0) {
      throw new WebError(
        'aggregated search queue is empty: enable or add a provider in Settings → Plugins → Plugin configuration',
        'WEB_PROVIDER_UNAVAILABLE',
      )
    }
    const failures: AttemptFailure[] = []
    for (let position = 0; position < entries.length; position++) {
      const entry = entries[position] as QueueEntry
      const adapter = ADAPTERS[entry.kind]
      const keys = await this.resolveKeys(entry, position, failures)
      const attempts = keys.length > 0
        ? keys
        // An entry that names no refs (or whose refs all failed to resolve —
        // `resolveKeys` already recorded those) still gets one anonymous
        // attempt when the upstream allows it, mirroring AnySearch semantics.
        : adapter.anonymousOk ? [{ ref: 'anonymous', value: undefined }] : []
      if (attempts.length === 0) {
        failures.push({
          position,
          kind: entry.kind,
          keyRef: 'none',
          reason: 'no usable API key (refs empty or unresolved, and the API requires a key)',
        })
        continue
      }
      const ordered = rotation(attempts, this.cursorOf(entry))
      for (const key of ordered) {
        if (signal?.aborted === true) throw callerAborted()
        const outcome = await this.attempt(entry, position, key, adapter, request, signal, attemptTimeoutMs)
        if (outcome === undefined) throw callerAborted()
        if (outcome.ok) {
          this.advanceCursor(entry, ordered.length)
          this.options.logger.info(
            'aggregated search: query served by %s via %s (position %d)',
            entry.kind, key.ref, position + 1,
          )
          return outcome.result
        }
        failures.push(outcome.failure)
      }
    }
    const summary = failures.map(failure => describeFailure(failure)).join('; ')
    throw new WebError(
      `aggregated search: all ${String(failures.length)} attempts failed — ${summary}`,
      'WEB_PROVIDER_ERROR',
    )
  }

  /**
   * Resolve an entry's key list, recording one failure per ref that resolves
   * to nothing (visibility for the all-failed summary; the entry may still
   * proceed anonymously when the adapter allows it).
   */
  private async resolveKeys(entry: QueueEntry, position: number, failures: AttemptFailure[]): Promise<ResolvedKey[]> {
    const keys: ResolvedKey[] = []
    for (const ref of entry.apiKeyRefs) {
      let value: string | undefined
      try {
        value = await this.options.resolveKey(ref)
      } catch (error: unknown) {
        failures.push({
          position,
          kind: entry.kind,
          keyRef: ref,
          reason: `credential resolution failed: ${String(error instanceof Error ? error.message : error)}`,
        })
        continue
      }
      if (value !== undefined && value.length > 0) {
        keys.push({ ref, value })
      } else {
        this.options.logger.info('aggregated search: credential %s resolved to nothing', ref)
        failures.push({
          position,
          kind: entry.kind,
          keyRef: ref,
          reason: 'credential resolved to nothing',
        })
      }
    }
    return keys
  }

  /**
   * Run one attempt under its own timeout budget. A caller abort propagates
   * (the walk stops — `undefined`); every other failure is returned for
   * recording.
   */
  private async attempt(
    entry: QueueEntry,
    position: number,
    key: ResolvedKey,
    adapter: (typeof ADAPTERS)[QueueEntry['kind']],
    request: WebSearchRequest,
    signal: AbortSignal | undefined,
    attemptTimeoutMs: number,
  ): Promise<
    | { ok: true; result: WebSearchResult }
    | { ok: false; failure: AttemptFailure }
    | undefined
  > {
    const timeout = new AbortController()
    const timer = setTimeout(() => {
      timeout.abort(new DOMException('aggregated search attempt timed out', 'TimeoutError'))
    }, attemptTimeoutMs)
    const attemptSignal = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
    const baseURL = entry.baseURL ?? adapter.defaultBaseURL
    const startedAt = Date.now()
    try {
      const result = await adapter.search(request.query, request.maxResults, key.value, baseURL, attemptSignal)
      return { ok: true, result }
    } catch (error: unknown) {
      if (signal?.aborted === true) return undefined
      const reason = timeout.signal.aborted
        ? `attempt timed out after ${String(attemptTimeoutMs)} ms`
        : error instanceof WebError ? error.message : String(error)
      this.options.logger.warn(
        'aggregated search: %s attempt via %s failed in %d ms: %s',
        entry.kind, key.ref, Date.now() - startedAt, reason,
      )
      return {
        ok: false,
        failure: { position, kind: entry.kind, keyRef: key.ref, reason },
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** The rotation-start cursor stored for one entry signature. */
  private cursorOf(entry: QueueEntry): number {
    return this.cursors.get(signatureOf(entry)) ?? 0
  }

  /** Advance one entry's rotation cursor by one request. */
  private advanceCursor(entry: QueueEntry, length: number): void {
    if (length <= 1) return
    const signature = signatureOf(entry)
    this.cursors.set(signature, (((this.cursors.get(signature) ?? 0) + 1) % length))
  }
}

/**
 * Reorder one key list so it starts at `cursor` and wraps once — the
 * round-robin attempt order for one entry.
 *
 * @param keys - the resolved keys in configured order.
 * @param cursor - the rotation start index.
 * @returns the keys in attempt order.
 */
export function rotation<T>(items: readonly T[], cursor: number): T[] {
  if (items.length <= 1) return [...items]
  const start = ((cursor % items.length) + items.length) % items.length
  return [...items.slice(start), ...items.slice(0, start)]
}

/** The stable identity of one queue entry: kind, endpoint, and key refs. */
function signatureOf(entry: QueueEntry): string {
  return [entry.kind, entry.baseURL ?? '', entry.apiKeyRefs.join(',')].join('|')
}

/** One failure as the summary renders it. */
function describeFailure(failure: AttemptFailure): string {
  return `[${String(failure.position + 1)}] ${failure.kind}/${failure.keyRef}: ${failure.reason}`
}

/** The `WEB_ABORTED` error for caller cancellation. */
function callerAborted(): WebError {
  return new WebError('aggregated search aborted', 'WEB_ABORTED')
}
