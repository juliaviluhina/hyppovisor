# Phase 1 Data Model: Unwrap Link-Shim URLs

Deltas and new shapes only. Everything else is unchanged.

---

## `ShimRule` (new — `src/main/tabs/unwrap-url.ts`)

One recognized redirect interstitial.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Stable, kebab-case: `linkedin-safety`, `google-redirect`, `facebook-linkshim`, `reddit-out`, `outlook-safelinks`. |
| `hostMatch` | `(host: string) => boolean` | `host` is `URL.host` lowercased (no port). Exact compare for LinkedIn / Reddit; a curated set for Google (R3); `l.`/`lm.` for Facebook; `endsWith(".safelinks.protection.outlook.com")` for Outlook. |
| `pathPrefix` | `string` | `/safety/go/`, `/url`, `/l.php`, `/` (Reddit, Outlook). Match = `pathname === prefix \|\| pathname.startsWith(prefix)`; `"/"` matches any path. |
| `param` | `"url" \| "q" \| "u"` | Query parameter carrying the destination. First occurrence wins (`URLSearchParams.get`). |

`SHIM_RULES: readonly ShimRule[]` — the whole table, in one module.

### `listShimRules()`

Returns `Array<{ id: string; pathPrefix: string; param: string }>` — the serialisable view,
mirroring `listBlocklistRules()`. The `hostMatch` predicate is omitted (not serialisable);
each rule's host behaviour is pinned by a unit test.

---

## `UnwrapResult` (new — `src/main/tabs/unwrap-url.ts`)

The outcome of `unwrapUrl(raw: string)`.

| Field | Type | Notes |
|---|---|---|
| `url` | `string` | The URL to actually open. Equals the input when no unwrap occurred. **Not** run through `validateUrl` here — the caller does that next. |
| `hops` | `number` | `0` when the input was opened verbatim; `1`–`3` for a resolved chain. |
| `wrapper` | `string \| undefined` | The original input, set only when `hops > 0` (so the caller can log it without re-plumbing). |

**Rules:**
- `unwrapUrl` never throws. A non-parseable input, a non-`http(s)` candidate destination,
  an unparseable candidate, a host/path/param miss → `{ url: raw, hops: 0 }`.
- A candidate destination is accepted only if `new URL(candidate)` succeeds **and**
  `protocol` is `http:` or `https:` (FR-006).
- Loop stops at 3 iterations or the first iteration that does not produce a new accepted
  `http(s)` URL, whichever comes first (FR-007, SC-004). `hops` counts iterations that
  changed the URL.

---

## `InteractionLogEntry` (delta — `src/shared/types.ts`)

One optional field added, parallel to `batch`:

```ts
/** Set only on an `operation: "unwrap"` entry (feature 002). */
unwrap?: { hops: number };
```

An unwrap entry is:

```jsonc
{
  "at": "2026-09-01T…Z",
  "tabId": "tab-3",
  "url": "https://www.linkedin.com/safety/go/?url=https%3A%2F%2F…",  // wrapper
  "operation": "unwrap",
  "target": "https://job-boards.greenhouse.io/acme/jobs/123",        // destination
  "outcome": "permitted",
  "ruleId": null,
  "error": null,
  "unwrap": { "hops": 1 }
}
```

Written by `TabManager` only when `hops > 0`. No entry for `hops === 0` (FR-011).

---

## `TabManager` constructor (delta — `src/main/tabs/tab-manager.ts`)

```ts
constructor(
  private readonly win: BrowserWindow,
  private readonly events: TabEvents,
  private readonly log: InteractionLog,   // NEW
) { … }
```

`src/main/index.ts` passes the `log` created at startup. No other caller of `new
TabManager` exists in `src/`; test doubles updated in the same change.

---

## No change

- `ShimRule` set is closed to the 5 families for v1; more are table edits (spec Assumptions).
- `validateUrl` / `url-policy.ts` — unchanged; still runs on `UnwrapResult.url`.
- No new `ErrorCode`. A resolved destination that fails `validateUrl` produces the existing
  `INVALID_URL` / `SCHEME_NOT_ALLOWED` from the current path.
- The MCP tool set, params, and the blocklist — unchanged.
