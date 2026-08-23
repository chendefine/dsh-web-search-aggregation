/**
 * Shared HTTP plumbing for the search adapters: one JSON request helper with
 * the error mapping every adapter shares (network failure, non-2xx with a
 * best-effort message, malformed JSON), so adapter modules own only their
 * endpoint contract and response mapping.
 *
 * @module dsh-web-search-aggregation/adapters/http
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** Attribution header sent on every upstream request. Bump with the package version. */
const USER_AGENT = 'dsh-web-search-aggregation/0.1.5'

/** Cap on an upstream error body kept for diagnostics. */
const MAX_ERROR_CHARS = 300

/** Backoff before the one transient-network retry (ms); short — blips are sub-second. */
const TRANSIENT_RETRY_DELAY_MS = 150

/**
 * `errno` codes whose fetch failure is plausibly transient (embedded-DNS
 * blips like `EAI_AGAIN`, connection resets, dial timeouts). Only these
 * earn the single in-budget retry; deterministic failures never do.
 */
const TRANSIENT_ERRNO: ReadonlySet<string> = new Set([
  'EAI_AGAIN',
  'EAI_FAIL',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
])

/**
 * Issue one JSON HTTP request and parse a JSON response body. A
 * network-level failure that looks transient (DNS blip, reset) is retried
 * once after a short backoff, inside the SAME attempt budget — the caller's
 * signal still bounds the whole loop, so worst-case timing is unchanged.
 *
 * @param kind - provider kind, used to prefix error messages.
 * @param url - the absolute request URL.
 * @param init - method, headers, body; the signal rides here.
 * @returns the parsed response body.
 * @throws WebError `WEB_ABORTED` when the caller's signal aborted the fetch,
 *   `WEB_PROVIDER_ERROR` for network failures, non-2xx statuses, and bodies
 *   that are not valid JSON.
 */
export async function jsonRequest(
  kind: string,
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal },
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchOnce(url, init, kind)
  } catch (error: unknown) {
    // One retry for a transient network-level failure (undici throws a
    // TypeError whose `cause` carries the errno); HTTP status errors and
    // malformed bodies are deterministic and never retried.
    if (isTransientNetworkError(error)) {
      await sleep(TRANSIENT_RETRY_DELAY_MS)
      try {
        response = await fetchOnce(url, init, kind)
      } catch (retryError: unknown) {
        throw requestFailure(kind, retryError)
      }
    } else {
      throw requestFailure(kind, error)
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error: unknown) {
    if (init.signal?.aborted === true) throw aborted(kind, error)
    if (!response.ok) {
      // A non-2xx with a malformed body (normal for gateway 5xx): the status
      // line is the whole diagnosis.
      throw new WebError(`${kind} API error (HTTP ${String(response.status)})`, 'WEB_PROVIDER_ERROR')
    }
    throw new WebError(`${kind} returned a non-JSON body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }

  if (!response.ok) {
    throw new WebError(
      `${kind} API error (HTTP ${String(response.status)}): ${errorDetail(body)}`,
      'WEB_PROVIDER_ERROR',
    )
  }
  return body
}

/** The bare fetch call with this helper's shared init projection. */
async function fetchOnce(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal },
  kind: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: init.method,
      redirect: 'error',
      headers: { 'user-agent': USER_AGENT, ...init.headers },
      ...init.body === undefined ? {} : { body: init.body },
      ...init.signal === undefined ? {} : { signal: init.signal },
    })
  } catch (error: unknown) {
    if (isAbortError(error)) throw aborted(kind, error)
    throw error
  }
}

/** Resolve after `ms`, ignoring an abort (the retried fetch reports it). */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** True for a fetch/`AbortSignal` abort, mapped to `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Whether one thrown fetch failure is a transient network-level problem
 * worth one retry: undici rejects with `TypeError: fetch failed` whose
 * `cause` carries the errno (DNS, reset, dial timeout) or an undici socket
 * error. Anything without a recognized transient cause stays final.
 *
 * @param error - the error `fetch` rejected with.
 */
function isTransientNetworkError(error: unknown): boolean {
  if (isAbortError(error)) return false
  const cause = (error as { cause?: unknown })?.cause
  for (const candidate of [cause, error]) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const code = (candidate as NodeJS.ErrnoException).code
    if (typeof code === 'string' && TRANSIENT_ERRNO.has(code)) return true
    const message = (candidate as { message?: unknown }).message
    if (typeof message === 'string' && (message.includes('socket hang up') || message.includes('other side closed'))) {
      return true
    }
  }
  return false
}

/** Wrap one thrown fetch/parse failure: aborts stay aborts, the rest become provider errors. */
function requestFailure(kind: string, error: unknown): WebError {
  if (isAbortError(error)) return aborted(kind, error)
  return new WebError(`${kind} request failed: ${describeNetworkError(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}

/**
 * Describe a fetch-layer failure for the failure record: the undici
 * `TypeError: fetch failed` head is useless on its own, so the underlying
 * `cause` (errno code + message: the DNS name that failed, the reset
 * socket, …) is unwrapped and appended, bounded to the diagnostic cap.
 *
 * @param error - the error `fetch` rejected with.
 * @returns the head plus the cause, e.g.
 *   `TypeError: fetch failed: getaddrinfo EAI_AGAIN api.search.brave.com [EAI_AGAIN]`.
 */
function describeNetworkError(error: unknown): string {
  const head = String(error)
  const cause = (error as { cause?: unknown })?.cause
  if (typeof cause !== 'object' || cause === null) return head
  const message = (cause as { message?: unknown }).message
  const code = (cause as NodeJS.ErrnoException).code
  const detail = [
    typeof message === 'string' && message.length > 0 ? message : undefined,
    typeof code === 'string' ? `[${code}]` : undefined,
  ].filter(part => part !== undefined).join(' ')
  if (detail.length === 0) return head
  const bounded = detail.length <= MAX_ERROR_CHARS ? detail : `${detail.slice(0, MAX_ERROR_CHARS - 1)}…`
  return `${head}: ${bounded}`
}

/** The `WEB_ABORTED` wrapper for one adapter operation. */
function aborted(kind: string, cause: unknown): WebError {
  return new WebError(`${kind} search aborted`, 'WEB_ABORTED', { cause })
}

/**
 * Extract a bounded human-readable detail from an upstream error body without
 * trusting it: `detail` / `message` / `error` string fields are used when
 * present; anything else degrades to a stable placeholder.
 *
 * @param body - the parsed error body, of unknown shape.
 * @returns a short safe detail string.
 */
function errorDetail(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'no detail'
  for (const field of ['detail', 'message', 'error'] as const) {
    const value = (body as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.trim().length > 0) {
      const bounded = value.length <= MAX_ERROR_CHARS ? value : `${value.slice(0, MAX_ERROR_CHARS - 1)}…`
      return bounded
    }
  }
  return 'no detail'
}

/**
 * Read one object field as a non-blank optional string — the adapters'
 * narrowing helper for optional upstream text fields.
 *
 * @param value - the parsed response object.
 * @param field - the field to read.
 * @returns the trimmed string, or `undefined` when absent or not a string.
 */
export function optionalText(value: Record<string, unknown>, field: string): string | undefined {
  const raw = value[field]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
