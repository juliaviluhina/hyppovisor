# Phase 1 Data Model — Address Bar Reflects and Navigates the Active Tab

This feature introduces **no persisted entities** and **no new files**. It changes one
in-memory IPC event payload and adds transient renderer-only UI state. Feature 009's
`recent-urls.json` is fed by a new trigger but its schema and writer are unchanged.

---

## 1. `TabsChangedPayload` (IPC event shape — changed)

**Where**: `src/shared/types.ts`, carried by the `tabs:changed` main→renderer event.

**Before**: the event carried a bare `TabSummary[]`.

**After**:

| Field | Type | Notes |
|---|---|---|
| `tabs` | `TabSummary[]` | Unchanged element shape (`tabId`, `url`, `title`, `loadState`). Order = insertion order, as today. |
| `activeTabId` | `string \| null` | The id of the tab `TabManager` currently has active. `null` iff `tabs` is empty. Authoritative — the renderer no longer infers it. |

```ts
export interface TabsChangedPayload {
  tabs: TabSummary[];
  activeTabId: string | null;
}
```

**Producer**: `TabManager.activeTabId` (new getter over the existing private `activeId`),
read at each `send("tabs:changed", …)` call site in `src/main/index.ts`.

**Consumers**: `src/preload/chrome.cjs` `onTabsChanged` (forwards the object verbatim);
`src/renderer/app.ts` (destructures `{ tabs, activeTabId }`).

**Not touched**: `TabSummary` itself — it remains the MCP `list_open_tabs` return shape and
gains no field (FR-012 scope guard).

---

## 2. `NavigateActiveResult` (IPC response — new)

**Where**: return of `ipcMain.handle("chrome:navigate-active", …)` in `src/main/index.ts`.

Same shape the `chrome:open-url` handler returns: a `TabSummary` spread with the queue
depth.

| Field | Type | Notes |
|---|---|---|
| `tabId` | `string` | The active tab that was navigated (unchanged identity — no new tab). |
| `url` | `string` | The tab's URL after the load settled (post-redirect). |
| `title` | `string` | Post-load title. |
| `loadState` | `"loading" \| "loaded" \| "failed"` | `"loaded"` on success; a `"failed"` outcome is delivered as a **rejection** (`HyppoError("LOAD_FAILED")`), matching `open`. |
| `queueDepth` | `number` | From `ActionQueue`, as `chrome:open-url`. |

**Rejections** (Promise rejects, renderer shows an error notice — identical to `open`):

| Code | When |
|---|---|
| `INVALID_URL` | entered string is not an absolute URL |
| `SCHEME_NOT_ALLOWED` | scheme is not http/https |
| `LOAD_FAILED` | URL was valid and reachable-looking but the load failed |
| `NO_ACTIVE_TAB` | no tab active at the moment the handler ran (race; renderer normally prevents this — see research R7) |

---

## 3. Transient renderer state (`src/renderer/app.ts`)

| Name | Type | Lifetime | Purpose |
|---|---|---|---|
| `activeId` | `string \| null` | module | Now assigned **only** from `payload.activeTabId`. The "guess the last tab" fallback (`app.ts:155-160`) is removed. Drives `.tab.active` / `#tabselect` selection (unchanged) and which URL `syncAddress()` reflects (new). |

No dirty flag is stored — the edit-preservation rule keys on
`document.activeElement === address` (research R5), not on tracked state.

---

## 4. State transitions — what the address input shows

`syncAddress()` runs on every `tabs:changed` and on `#address` `blur`.

| Condition | `#address.value` becomes |
|---|---|
| `#address` is focused | *unchanged* (edit in progress — FR-003, US1 scenario 4) |
| not focused, `activeTabId` non-null | the active tab's current `url` (FR-001, FR-004 — post-redirect) |
| not focused, `activeTabId` null (no tabs) | `""` (placeholder shows — FR-002) |
| active tab's `title` changed but `url` did not | the same string → no visible change (edge case: no flicker) |

Submit behaviour:

| Trigger | `activeId` | Effect |
|---|---|---|
| Enter in `#address`, or `#go` click | non-null | `hyppo.navigateActive(url)` — active tab loads `url` in place, stays active, no new tab (FR-005) |
| Enter in `#address`, or `#go` click | null | `hyppo.openUrl(url)` — new tab (FR-007) |
| `#newtab` ("+") click | any | `hyppo.openUrl(url)` — new tab, active tab untouched (FR-006) |
| Enter / `#go` / "+" with empty input | any | no-op (edge case) |

---

## 5. Recent-URLs history (feature 009 — unchanged schema, new trigger)

`<userData>/recent-urls.json` — JSON array of URL strings, newest-first, capped. **No
change** to the file, `recent-urls.ts`, or the `onPersonOpen` handler.

New trigger: `TabManager.navigateActive` fires `onPersonOpen(enteredUrl)` when its load
reaches `"loaded"`. Same event, same rules as a person-initiated new-tab open (feature
009): person-initiated only, successful load only, the `validateUrl`-normalised **entered**
URL (not the redirect landing URL). Agent `navigate` (MCP tool → `TabManager.navigate`)
still never fires it.
