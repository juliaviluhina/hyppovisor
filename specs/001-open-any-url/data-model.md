# Phase 1 Data Model: Open Any URL

**Feature**: 001-open-any-url | **Date**: 2026-08-29

All state here is in-memory except the interaction log. No page content is persisted anywhere
(FR-019, constitution Principle V).

---

## Tab

One embedded browser view for one page. Lives only while the app runs.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable for the tab's life (FR-008). Opaque, e.g. `tab-1` |
| `url` | string | Current **final** URL after redirects (FR-005 edge case) |
| `title` | string | Current page title; empty before first load |
| `loadState` | `loading` \| `loaded` \| `failed` | `failed` carries `error` (FR-005) |
| `error` | string \| null | Load failure description when `loadState === "failed"` |
| `openedBy` | `person` \| `orchestrator` | Provenance of the open request (FR-003) |

**Lifecycle**: `created → loading → (loaded | failed) → closed`. Reaching `closed` (person closes
the tab) immediately invalidates the id — subsequent tool calls return `TAB_NOT_FOUND` (FR-015).
Re-navigating a loaded tab returns it to `loading` without changing its id.

**Validation**: a tab is only created for a URL passing `url-policy` (`http`/`https` only, FR-004).

---

## PageRead

A point-in-time observation returned to the caller. **Never persisted** — the returned payload is
the only copy (FR-019, US2 scenario 4).

| Field | Type | Notes |
|---|---|---|
| `tabId` | string | |
| `url` | string | Final URL at observation time |
| `title` | string | |
| `text` | string | Verbatim visible text, unmodified (FR-010b) |
| `dom` | string \| undefined | Present only when the caller requested it (FR-010a) |
| `observedAt` | string | ISO 8601 |
| `truncated` | `{ text: boolean, dom: boolean }` | Per-part flags (FR-021) |
| `queueDepth` | number | Requests waiting when this one ran (FR-013a) |

**Validation**: `text` truncated at the configured limit (default 100 KB); `dom` at its own
separate limit. Truncation sets the corresponding flag — it is never silent.

---

## InteractionRequest

One orchestrator-requested action against a tab.

| Field | Type | Notes |
|---|---|---|
| `tabId` | string | |
| `operation` | `click` \| `fill` \| `scroll` \| `wait_for_selector` \| `navigate` | |
| `selector` | string \| undefined | Required for `click`, `fill`, `wait_for_selector` |
| `value` | string \| undefined | `fill` only |
| `url` | string \| undefined | `navigate` only; must pass `url-policy` |
| `timeoutMs` | number \| undefined | `wait_for_selector`; default 10000 |

**State transitions**: `queued → evaluating → (permitted → executing → done | refused)`. Every
terminal state produces exactly one InteractionLogEntry.

---

## BlocklistRule

The enumerable definition of what is refused (FR-012a). Static, defined in one module.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `submit-control`, `in-form`, `consent-toggle`, `external-act-label`, `credential-field` |
| `description` | string | Human-readable, shown in the refusal |
| `appliesTo` | `click` \| `fill` \| `both` | |

**Invariant**: the full rule set is enumerable at runtime, so tests can assert per-rule coverage
and a refusal can always name the matched rule.

---

## InteractionLogEntry

Append-only JSONL at `userData/interaction-log.jsonl`. The only file the app writes. Operational
data about the app's behavior — **not** page content, and not in the shared data directory.

| Field | Type | Notes |
|---|---|---|
| `at` | string | ISO 8601 |
| `tabId` | string | |
| `url` | string | Page URL at the time of the request |
| `operation` | string | As in InteractionRequest |
| `target` | string \| null | Selector, or null for non-targeted operations |
| `outcome` | `permitted` \| `refused` \| `error` | |
| `ruleId` | string \| null | Matched BlocklistRule when `refused` |
| `error` | string \| null | Error code when `error` |

**Invariant**: exactly one entry per interaction request, permitted or refused (FR-024a, SC-005).
Never contains page text — only the target's selector.

---

## Error codes

Every failure returns a distinct code (FR-014). No silent failures, no generic catch-all.

| Code | Raised when |
|---|---|
| `INVALID_URL` | Malformed URL |
| `SCHEME_NOT_ALLOWED` | Scheme is not `http`/`https` (FR-004) |
| `LOAD_FAILED` | DNS failure, connection refused, HTTP error (FR-005) |
| `TAB_NOT_FOUND` | Unknown or closed tab id (FR-015) |
| `TARGET_NOT_FOUND` | Selector matched no element |
| `WAIT_TIMEOUT` | `wait_for_selector` timed out |
| `REFUSED_EXTERNAL_ACT` | Blocklist match; response names `ruleId` (FR-012) |
