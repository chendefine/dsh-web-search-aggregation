/**
 * The single-kv key-pool vocabulary: one provider kind stores all its API
 * keys in ONE credential (`TAVILY_API_KEY`, …) whose value is the keys
 * joined by `,` — a single key is stored bare, with no separator. These
 * helpers convert between that wire/storage format and the key list the
 * provider rotates over. Pure functions, zero imports (host-side use).
 *
 * Assumption: an API-key literal never contains `,` (no known provider
 * issues keys with commas).
 *
 * @module dsh-web-search-aggregation/keys
 */

/**
 * Split one credential value into its key list: split on `,`, trim each
 * part, drop empty parts. A value that is empty, blank, or only separators
 * parses to `[]` (the credential counts as unresolved).
 *
 * @param value - the raw credential value (comma-joined keys).
 * @returns the non-empty key literals in stored order.
 */
export function parseApiKeys(value: string): string[] {
  return value.split(',').map(part => part.trim()).filter(part => part.length > 0)
}

/**
 * Join key literals into one credential value: trim each key, drop empty
 * ones, join with `,`. A single key produces the bare literal with no
 * separator; an empty list produces `''`.
 *
 * @param keys - the key literals to store.
 * @returns the comma-joined credential value.
 */
export function formatApiKeys(keys: readonly string[]): string {
  return keys.map(key => key.trim()).filter(key => key.length > 0).join(',')
}

/**
 * The display identity of one key inside a provider's pool, used in logs
 * and failure records (never the literal itself): the plain reference when
 * the pool holds one key, `REF#N` (1-based) when it holds several.
 *
 * @param ref - the provider's fixed credential reference.
 * @param index - the key's 0-based position in the parsed pool.
 * @param total - how many keys the pool holds.
 * @returns the per-key display reference.
 */
export function keyRefLabel(ref: string, index: number, total: number): string {
  return total <= 1 ? ref : `${ref}#${String(index + 1)}`
}

/** How many leading characters a masked tag shows. */
export const KEY_HEAD_CHARS = 12

/** How many trailing characters a masked tag shows. */
export const KEY_TAIL_CHARS = 2

/**
 * Mask one key literal for on-screen tags: head 12 + `…` + tail 2. Keys too
 * short to hide a middle (≤ 14 chars) degrade to the tail window only, so a
 * short key is never revealed in full.
 *
 * @param key - the key literal to mask.
 * @returns the masked display string.
 */
export function maskApiKey(key: string): string {
  if (key.length > KEY_HEAD_CHARS + KEY_TAIL_CHARS) {
    return `${key.slice(0, KEY_HEAD_CHARS)}…${key.slice(-KEY_TAIL_CHARS)}`
  }
  return key.length > KEY_TAIL_CHARS ? `…${key.slice(-KEY_TAIL_CHARS)}` : '…'
}
