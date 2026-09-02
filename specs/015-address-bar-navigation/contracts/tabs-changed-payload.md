# Contract — `tabs:changed` event payload (changed)

**Direction**: main → renderer (`webContents.send` / `ipcRenderer.on`)

**Changed by**: feature 015 — the payload gains the authoritative active tab id.

---

## Before

```ts
send("tabs:changed", tabs.list());        // TabSummary[]
onTabsChanged(cb) => cb(tabs);             // cb: (tabs: TabSummary[]) => void
```

The renderer inferred the active tab (`app.ts:155-160`: "if the tracked id is gone, use the
last tab"). That inference is wrong under rapid switching and under agent- / close-driven
activation changes.

## After

```ts
send("tabs:changed", { tabs: tabs.list(), activeTabId: tabs.activeTabId });
onTabsChanged(cb) => cb({ tabs, activeTabId });   // cb: (p: TabsChangedPayload) => void
```

```ts
interface TabsChangedPayload {
  tabs: TabSummary[];            // element shape unchanged
  activeTabId: string | null;   // null iff tabs is empty
}
```

## Producer requirements

- `TabManager` exposes `get activeTabId(): string | null` returning the current
  `this.activeId`.
- **Every** `send("tabs:changed", …)` call site in `src/main/index.ts` uses the new shape.
  Known sites: the `TabManager` `onChange` callback; the post-`loadFile` explicit send; the
  `HYPPO_E2E` branch's explicit send. (Grep `tabs:changed` before implementing to confirm
  the full set.)
- The event still fires on the same occasions as today (tab add/remove, activation,
  load-state change, redirect via `did-stop-loading`, `page-title-updated`) — no new
  emission points.

## Consumer requirements

- `src/preload/chrome.cjs` `onTabsChanged` forwards the object unchanged.
- `src/renderer/app.ts`:
  - sets `activeId = payload.activeTabId` on every event (no fallback heuristic);
  - passes `payload.tabs` to `render(...)`;
  - calls `syncAddress()` (reflect the active tab's URL unless `#address` is focused).

## Compatibility

Renderer-only IPC. The MCP surface (`list_open_tabs` → `TabSummary[]`) is **not** affected.
No persisted data. This is the single behavioural coupling to call out at review under
Constitution Principle III ("IPC channels beyond the MCP surface … MUST be called out at
review").
