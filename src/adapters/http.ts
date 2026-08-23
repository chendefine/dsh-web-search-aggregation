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
const USER_AGENT = 'dsh-web-search-aggregation/0.1.0'

/** Cap on an upstream error body kept for diagnostics. */
const MAX_ERROR_CHARS = 300

/**
 * Issue one JSON HTTP request and parse a JSON response body.
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
    response = await fetch(url, {
      method: init.method,
      redirect: 'error',
      headers: { 'user-agent': USER_AGENT, ...init.headers },
      ...init.body === undefined ? {} : { body: init.body },
      ...init.signal === undefined ? {} : { signal: init.signal },
    })
  } catch (error: unknown) {
    throw requestFailure(kind, error)
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

/** True for a fetch/`AbortSignal` abort, mapped to `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Wrap one thrown fetch/parse failure: aborts stay aborts, the rest become provider errors. */
function requestFailure(kind: string, error: unknown): WebError {
  if (isAbortError(error)) return aborted(kind, error)
  return new WebError(`${kind} request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
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
