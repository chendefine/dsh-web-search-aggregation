/**
 * The single source of the per-kind constants BOTH halves of the package
 * read: the host adapters/config and the browser card. A client bundle must
 * not value-import `@deepseek-ai/*` packages (and the host modules pull them
 * in), so every constant the two halves share lives in THIS zero-import
 * module instead of being mirrored — the browser half bundles it directly.
 *
 * @module dsh-web-search-aggregation/defaults
 */

/** Provider kinds this package can drive, in the display order the card shows. */
export const PROVIDER_KINDS = ['anysearch', 'tinyfish', 'tavily', 'brave', 'exa', 'firecrawl', 'jina', 'serpapi'] as const

/** One provider kind. */
export type ProviderKind = typeof PROVIDER_KINDS[number]

/**
 * The single credential reference each kind reads: its value is the
 * provider's keys joined by `,` (a single key is stored bare).
 */
export const KIND_CREDENTIAL_REF: Readonly<Record<ProviderKind, string>> = {
  anysearch: 'ANYSEARCH_API_KEY',
  tinyfish: 'TINYFISH_API_KEY',
  tavily: 'TAVILY_API_KEY',
  brave: 'BRAVE_SEARCH_API_KEY',
  exa: 'EXA_API_KEY',
  firecrawl: 'FIRECRAWL_API_KEY',
  jina: 'JINA_API_KEY',
  serpapi: 'SERPAPI_API_KEY',
}

/**
 * Each provider's API-key format, shown as the add-key input's placeholder
 * (the providers' documented key prefixes).
 */
export const KIND_KEY_PLACEHOLDER: Readonly<Record<ProviderKind, string>> = {
  anysearch: 'as_sk_xxxx...',
  tinyfish: 'sk-tinyfish-xxxx...',
  tavily: 'tvly-xxxx...',
  brave: 'BSA_xxxx...',
  exa: 'xxxx...',
  firecrawl: 'fc-xxxx...',
  jina: 'jina_xxxx...',
  serpapi: 'xxxx...',
}

/**
 * Each provider's default endpoint base — the SAME constants the adapters
 * serve as `defaultBaseURL` and the card shows as the Base URL input's
 * placeholder when the entry carries no override.
 */
export const KIND_DEFAULT_BASE_URL: Readonly<Record<ProviderKind, string>> = {
  anysearch: 'https://api.anysearch.com',
  tinyfish: 'https://api.search.tinyfish.ai',
  tavily: 'https://api.tavily.com',
  brave: 'https://api.search.brave.com',
  exa: 'https://api.exa.ai',
  firecrawl: 'https://api.firecrawl.dev',
  jina: 'https://s.jina.ai',
  serpapi: 'https://serpapi.com',
}

/** Lower bound for one attempt's timeout: below this, fallback is meaningless. */
export const MIN_ATTEMPT_TIMEOUT_MS = 1000

/** Upper bound for one attempt's timeout: the tool-level budget is 60 s. */
export const MAX_ATTEMPT_TIMEOUT_MS = 60000

/** Default per-attempt timeout: leaves room for 5–6 fallbacks inside the tool budget. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 10000
