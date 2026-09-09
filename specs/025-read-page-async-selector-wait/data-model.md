# Phase 1 Data Model: Async Selector Readiness for Page Reads

No persisted entities are introduced. Request and result data remain per-call in-memory MCP data;
page content is not written to the shared data directory.

## `ReadPageRequest`

| Field | Type | Default | Validation |
|---|---|---|---|
| `selector` | string | omitted | Existing CSS validation; invalid CSS returns `INVALID_SELECTOR`. |
| `waitForSelector` | boolean | false | Requires `selector`; otherwise reject clearly. |
| `timeoutMs` | positive integer | `config.defaultWaitMs` | Valid for readiness waits; zero/negative values reject. |

Existing fields retain their current meanings and validation. Readiness observes DOM presence only.

## `PageReadResult`

The existing shape is unchanged. A successful waited read uses the same `scopedTo`/`scope`, text,
optional DOM, reduction, truncation, URL, title, timestamp, and queue-depth behavior as an
immediate scoped read.

## Failure states

| State | Condition | Result |
|---|---|---|
| Invalid selector | CSS cannot be parsed | Existing `INVALID_SELECTOR`; no wait or read. |
| Immediate target missing | Wait omitted and selector has no match | Existing `TARGET_NOT_FOUND`. |
| Readiness timeout | Wait enabled and selector remains absent | Distinct timeout naming selector and timeout; no payload or fallback. |
| Invalid timeout | Non-positive/non-integer timeout | Clear input error before browser work. |
