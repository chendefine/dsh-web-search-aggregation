# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
