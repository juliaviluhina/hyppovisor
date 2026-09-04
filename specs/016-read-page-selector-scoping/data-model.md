# Phase 1 Data Model: Read Page Selector Scoping

No persisted entities — `read_page` results are never written to disk (Principle V,
unchanged by this feature). The only shape change is one additive field on the existing
in-memory result type.

## `PageReadResult` (`src/shared/types.ts`)

```ts
export interface PageReadResult {
  tabId: string;
  url: string;
  title: string;
  text: string;
  dom?: string;
  observedAt: string;
  truncated: { text: boolean; dom: boolean };
  queueDepth: number;
  scopedTo?: string;   // NEW — the selector used to scope this read; absent when unscoped
}
```

| Field | Change | Notes |
|---|---|---|
| `scopedTo` | **new**, optional | Present only when the caller supplied `selector`. Value is the selector string as supplied (not normalized), per FR-006/FR-007. |
| `text` | unchanged type, narrower value when scoped | The matched element's `innerText` instead of `document.body.innerText` (FR-001). |
| `dom` | unchanged type, narrower value when scoped | The matched element's `outerHTML` instead of `document.documentElement.outerHTML`, only when `includeDom` is also requested (FR-010, research.md R4). |
| `truncated` | unchanged shape | Same two-flag shape; now describes truncation of the (possibly narrower) `text` / `dom` strings (FR-008). |
| all other fields | unchanged | `tabId`, `url`, `title`, `observedAt`, `queueDepth` are unaffected by scoping (FR-009). |

## Request shape addition (not persisted — MCP tool input only)

`read_page`'s existing input gains one optional field:

| Field | Type | Default | Notes |
|---|---|---|---|
| `selector` | `string`, optional | omitted (no scoping) | A CSS selector. Invalid CSS → `INVALID_SELECTOR`. Valid but no match → `TARGET_NOT_FOUND`. Matches more than one element → first match used (research.md R3). |

No state transitions, no identity/uniqueness rules, no data volume concerns — this is a
per-call, in-memory narrowing of an existing read, not a new entity.
