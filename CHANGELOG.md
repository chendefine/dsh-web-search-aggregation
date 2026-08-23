# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-08-24

### Added

- Three new queue providers, each behind its own adapter and single fixed credential (same `,`-joined key-pool format): **Brave Search** (`brave`, `BRAVE_SEARCH_API_KEY` — `GET api.search.brave.com/res/v1/web/search` with `X-Subscription-Token`, count clamped to the API's 1–20 window, `text_decorations=false` for clean snippets, `page_age` → `publishedAt`), **Exa** (`exa`, `EXA_API_KEY` — `POST api.exa.ai/search` with Bearer per current docs, `numResults` clamped to 1–100, `contents: {highlights: true}` so each row's first highlight rides the snippet), and **Firecrawl** (`firecrawl`, `FIRECRAWL_API_KEY` — `POST api.firecrawl.dev/v2/search` with Bearer, `limit` clamped to 1–100, no `scrapeOptions` so a search costs no per-page scrape credits; `success: false` envelopes map to `WEB_PROVIDER_ERROR`).
- The shipped default queue (config `DEFAULT_QUEUE` and the `cordis.patch.yml` base layer) now enables all six kinds. The queue's order is the user's to arrange in the card, so the defaults state membership — one enabled entry per kind — and not priority; the key-required entries fall through until their credential is set.
- The settings card names the three new kinds (Brave Search / Exa / Firecrawl, en + zh), shows their key-format placeholders (`xxxx…` / `fc-xxxx…`) and default endpoint bases, and queues them through the same `+` row.

### Changed

- Version bumped to 0.1.4; the upstream attribution `User-Agent` follows (`dsh-web-search-aggregation/0.1.4`).

### Fixed

- The adapter test helper's fetch stub passed the *request* init as the *response* init, so a stubbed non-2xx status was silently ignored (the AnySearch 429 test passed via the business-error path instead); the stub now applies the intended response status, and the Exa 401 test exercises the real HTTP path.
- Network-level fetch failures are now diagnosable: undici's opaque `TypeError: fetch failed` is unwrapped and the underlying cause (errno code + message, e.g. `getaddrinfo EAI_AGAIN api.search.brave.com [EAI_AGAIN]`) rides the failure record instead of being dropped.
- A transient network failure (embedded-DNS blip like `EAI_AGAIN`/`ENOTFOUND`, connection reset, dial timeout) no longer kills the attempt outright: `jsonRequest` retries once after a 150 ms backoff, inside the same attempt budget (the caller's signal still bounds the loop, so worst-case timing is unchanged). Deterministic failures — HTTP status errors, malformed bodies, aborts — are never retried.
- **Brave requests hit the wrong URL** — `braveURL` set the query parameters but never appended the `/res/v1/web/search` path, so a default-base request went to the apex `https://api.search.brave.com/?q=…`, which answers `301` to the dashboard site; with `redirect: 'error'` that surfaced as `TypeError: fetch failed: unexpected redirect`. The path is now appended to the base exactly like the POST adapters append theirs, so a proxy-prefixed base keeps its prefix.

## [0.1.3] - 2026-08-23

### Changed

- Configuration-card copy slimmed down: the card description is one line (按优先级队列依次调用 AnySearch / TinyFish / Tavily 完成网页搜索); the enable/disable hint now sits inline after the checkbox instead of on its own row; the API-keys hint and the Base URL hint are gone (the inputs are self-explanatory).
- The API-keys input's placeholder now follows the entry's provider key format (`as_sk_xxxx…` / `sk-tinyfish-xxxx…` / `tvly-xxxx…`), and the Base URL input's placeholder is the provider's actual default endpoint — both swap live when the entry's provider changes.
- `src/defaults.ts` is now the single source for the per-kind constants (provider kinds, credential refs, key-format placeholders, default base URLs) and the attempt-timeout bounds; the host adapters/config and the browser card both import them, replacing the hand-mirrored client copies.

### Fixed

- The upstream attribution `User-Agent` (`dsh-web-search-aggregation/0.1.0`) is bumped with the package version; it was stale since 0.1.0.

## [0.1.2] - 2026-08-23

### Fixed

- Queue-entry layout spacing in the configuration card.
- CI installs with pnpm 11.

## [0.1.1] - 2026-08-23

### Fixed

- Source installs (`dsh plugin add github:…` and CI) no longer fail during the `prepare` build: `unrun` is now a devDependency. tsdown's `auto` config loader needs it to read `tsdown.config.ts` on runtimes without native TypeScript support; registry installs were unaffected (they ship prebuilt `lib/`).
- `engines.node` now states DSH's own floor (`^22.19.0 || >=24.0.0`) instead of a not-actually-supported `>=20` — tsdown's build needs Node ≥ 22, and DSH hosts always run ≥ 22.19. The CI matrix (Node 22 / 24) mirrors it.

## [0.1.0] - 2026-08-23

### Added

- `AggregatedSearchProvider` (id `aggregated`): one `WebSearchProvider` over a prioritized queue of AnySearch / TinyFish / Tavily entries. Per request it walks enabled entries in configured order; within an entry it walks the keys parsed from the kind's single credential (a `,`-joined pool) starting at a rotating cursor; the first attempt that returns wins and every failure is recorded so an all-failed call can report each attempt.
- Adapters for the three shipped upstreams: AnySearch (`POST /v1/search`, Bearer optional — anonymous access allowed), Tavily (`POST /search`, Bearer, `max_results` + generated answer), TinyFish (`GET ?query=…`, `X-API-Key`).
- Per-attempt deadline (`attemptTimeoutMs`, default 15000 ms, range 1000–60000): one hung upstream cannot eat the tool-level budget.
- Key-pool vocabulary (`parseApiKeys` / `formatApiKeys` / `keyRefLabel` / `maskApiKey`): one credential per provider kind holds all its keys joined by `,`; logs and failure records cite masked `REF` / `REF#N` labels only.
- Browser-half configuration card (设置 → 插件 → 插件配置 → *Aggregated web search*): live queue editing (reorder, enable/disable, add/remove entries, per-entry endpoint override), masked key tags with presence facts only (a save replaces the whole pool; stored values are never echoed back), the attempt timeout, and a queue-level reset — committed changes reach the next search without a restart.
- `cordis.patch.yml` bundle layer: pins the web seam's `searchProvider` to `aggregated` and inserts the plugin row carrying the shipped default queue (`anysearch → tavily → tinyfish`) as the settings section's base layer. The patch states only `searchProvider` — deployments combining other provider plugins pin their full selection in the profile's own `cordis.patch.yml` (documented in the README).
- Unit tests (61): config schema and normalization, key-pool helpers, adapter request/response mapping, provider queue walk (rotation, fallback, deadlines, cancellation, failure summaries), and the client controller's staged edits.
