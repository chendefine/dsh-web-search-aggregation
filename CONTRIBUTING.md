# Contributing

Thanks for taking an interest in `dsh-web-search-aggregation`! This document covers how to work on the plugin, how to verify a change, and how a release goes out.

## Project layout

```
src/
├── index.ts               # host entry: registers provider + settings section
├── config.ts              # schemastery schema, defaults, queue normalization
├── provider.ts            # AggregatedSearchProvider: queue walk, rotation, deadlines
├── keys.ts                # ','-joined key-pool vocabulary (parse/format/mask)
├── types.ts               # queue entry, config, per-attempt failure records
├── adapters/              # AnySearch / Tavily / TinyFish adapters + shared HTTP
└── client/                # browser half: settings card, form model, locales
tests/                     # config, keys/adapters, provider, client-controller
```

The host half is a [Cordis](https://github.com/shigma/cordis) function plugin registering into the web seam's search registry; the browser half is a self-contained client bundle registered with `window.__ModuleLoader__.load`.

## Development

Requirements: Node.js ≥ 20, pnpm ≥ 10.

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run; pure unit tests, no network or credentials needed
pnpm build       # tsc declarations + tsdown (host ESM + client module-registration bundle)
```

The test suite deliberately needs no network: adapters are exercised against mapped response fixtures, and the provider against fake adapters.

## Verifying a change

- `pnpm typecheck` and `pnpm test` must pass.
- Any behavior change to the queue walk (ordering, rotation, deadlines, fallback, error taxonomy) needs a test: a unit case in `tests/provider.spec.ts` with a fake adapter.
- Browser-half changes (settings card, form model, locales) need no browser, but keep the client bundle self-contained: `tsdown.config.ts` enforces that at build time — no Node builtins, no `@deepseek-ai/*` value imports.
- Bump the version for every user-visible change; update `CHANGELOG.md` in the same commit.

## Commit conventions

Small, focused commits that describe the change in the imperative mood (`fix: …`, `test: …`, `docs: …`). Squash before merging if a branch has accumulated fix-up commits.

## Releasing

1. Bump `version` in `package.json` (and `dsh.plugin.json`) and add a `CHANGELOG.md` entry.
2. Push to `main`; CI (typecheck, test, build, pack verification) must be green.
3. `pnpm publish` — `prepublishOnly` builds the shipped `lib/`; the npm package is the prebuilt distribution, so `dsh plugin add dsh-web-search-aggregation` needs no build permission.
4. Tag and release: `git tag -a v<version> -m "Release …" && git push origin v<version>`, then a GitHub Release pointing at the same commit.
5. Registry indexes (npm `latest`, marketplace topic scans) update on their own schedules; no manual step.

## License

By contributing you agree that your contributions are licensed under the [MIT License](./LICENSE).
