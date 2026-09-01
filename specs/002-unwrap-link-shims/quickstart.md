# Quickstart / Acceptance: Unwrap Link-Shim URLs

SC references are from [spec.md](./spec.md#measurable-outcomes).

## Prerequisites

- `npm install`, a display for the e2e run.
- `npm run build`

## Automated checks

```sh
npm run lint
npm test                 # vitest unit
npm run test:e2e         # playwright _electron integration
```

### Unit — `tests/unit/unwrap-url.test.ts`

- **Every table entry (SC-006, SC-007):** for each of `linkedin-safety`,
  `google-redirect`, `facebook-linkshim`, `reddit-out`, `outlook-safelinks`, a wrapper URL
  whose param encodes `https://example.test/job/123` → `unwrapUrl` returns
  `{ url: "https://example.test/job/123", hops: 1 }`. Runs offline, no Electron.
- **Non-shim untouched (SC-002):** `https://example.com/search?q=https://evil.test` →
  `{ url: <input>, hops: 0 }`. Also a shim *host* with a non-matching path
  (`www.google.com/maps?q=…`) → `hops: 0`.
- **Param miss:** shim host + path but the param absent or empty → `{ url: <input>, hops: 0 }`.
- **Non-`http(s)` destination (SC-003):** LinkedIn wrapper with `url=javascript:alert(1)` /
  `data:…` / `mailto:…` / a non-absolute string → `{ url: <wrapper>, hops: 0 }`.
- **Nested:** an Outlook safelink whose `url=` encodes a LinkedIn `safety/go` whose `url=`
  encodes `https://example.test/x` → `{ url: "https://example.test/x", hops: 2 }`.
- **Depth cap (SC-004):** a hand-built `A?url=B?url=C?url=D` chain of shims →
  resolution stops at 3, returns the URL reached after 3 hops, never loops or throws.
- **`listShimRules()`** returns 5 rows, each with a non-empty `id` / `pathPrefix` / `param`.
- **Google variants (R3):** `www.google.co.uk/url?q=…` and `google.com/url?q=…` unwrap;
  `www.google.evil/url?q=…` does not.

### Integration — `tests/integration/open-url.spec.ts`

- **`open_url` on a shim (SC-001):** call `open` with
  `https://www.linkedin.com/safety/go/?url=<encoded ${base}/static.html>` → the returned
  `url` is `${base}/static.html`, `read_page` shows the fixture text, and no second call
  was needed. (The `linkedin.com` host is never contacted — resolution is offline; the tab
  only loads the local fixture.)
- **`navigate` on a shim:** open `${base}/static.html`, then `navigate` that tab with a
  Google `/url?q=<encoded ${base}/redirect.html>` wrapper → tab ends on the fixture.
- **Audit entry on a hop (SC-005):** after the `open_url` above, the interaction log's last
  line is `{ operation: "unwrap", url: <wrapper>, target: "${base}/static.html",
  outcome: "permitted", unwrap: { hops: 1 } }`.
- **No entry without a hop (SC-005, FR-011):** open `${base}/static.html` directly → the
  interaction log gains **no** line.
- **Verbatim non-shim (SC-002):** `open` with `${base}/static.html?q=https://evil.test` →
  returned `url` still carries `?q=…` unchanged.

## Manual smoke (optional)

In a running HyppoVisor, ask the agent to `open_url` a real LinkedIn "Apply" link
(`https://www.linkedin.com/safety/go/?url=…`) from a job posting → the tab lands on the ATS
page, not the "You're leaving LinkedIn" interstitial, with no Continue click.
