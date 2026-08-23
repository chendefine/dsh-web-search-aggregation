# Security Policy

## Security stance

This plugin sends two kinds of data off the machine: the search query text (toward the endpoint configured for each queue entry — the three providers' official APIs by default) and the API key of the attempt currently being made (as that provider's authentication credential). Nothing else leaves the host; fetch/rendering is not this plugin's concern.

API keys are stored in the DSH credentials domain (`@deepseek-ai/dsh-credentials`), never in the settings file. The settings card reads presence facts only — the credentials API is value-free on read, so stored literals are never echoed back to the browser. Logs and failure records cite masked references (`TAVILY_API_KEY#2`), never literals.

Endpoint base URLs are configurable per queue entry with no allowlist: an operator can point an entry at any origin, including a private one. That is deliberate (self-hosted mirrors, proxies), so treat access to the settings card as trust to direct outbound traffic. Deploy in trusted environments and do not expose the settings page to untrusted networks.

## Reporting a vulnerability

If you believe you have found a security issue in this plugin, please open a private advisory on GitHub:

https://github.com/chendefine/dsh-web-search-aggregation/security/advisories/new

Please include:

- the affected version;
- a minimal reproduction (configuration, expected vs actual behavior);
- whether you consider it a security boundary violation or a misconfiguration footgun.

Repair policy: confirmed issues get a fix, a version bump, a `CHANGELOG.md` entry, and a GitHub Security Advisory; fixes are published to npm and tagged.

## Threat model

| Asset | Threat | Mitigation |
| --- | --- | --- |
| API keys | Leakage via logs, failure records, or the settings card | Keys live only in the credentials domain; logs/records cite masked `REF`/`REF#N` labels; card shows masked tags and presence facts, never values; a save replaces the whole pool without reading it back |
| Search queries | Sent to a third-party upstream | By design — queries go only to the endpoints the operator configures; document provider choice and endpoint overrides to your users |
| Outbound traffic | A malicious queue entry pointed at an attacker origin | Settings page is operator-only trust; no endpoint allowlist by design (self-hosted mirrors) |
| Upstream responses | Malicious rows injected into model context | Adapter mapping keeps only title/url/snippet (+date/content when the API provides them); rows without a usable URL are dropped; output is treated as untrusted data, same as any `web_search` result |

## Supported versions

The latest published npm release is the only supported version. Users on older releases should upgrade to the newest `dsh-web-search-aggregation` on npm.
