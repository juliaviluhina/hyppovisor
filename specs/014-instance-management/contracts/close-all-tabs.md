# Contract: Close all tabs (`chrome:close-all-tabs` / `TabManager.closeAll`)

User Story 2. Self-contained within one instance; no dependency on the constitution
amendment.

## `TabManager.closeAll(): void`

```
for each tab in this.tabs.values():
    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
this.tabs.clear()
this.activeId = null
this.layout()
this.events.onChange()          // exactly one event
```

- **No-op when empty**: if `this.tabs.size === 0`, return immediately without firing
  `onChange`.
- Untouched: `this.overlay` (the connection-panel hide state), the MCP server, the queue,
  `settings.json`, `recent-urls.json`, the interaction log, and every logged-in browser
  session cookie/store (those live in the shared Electron session, not per-tab).
- A tab mid-load / mid-interaction is closed like any other; `webContents.close()` aborts
  its in-flight load. An MCP call targeting a now-closed tab fails with the existing
  `TAB_NOT_FOUND` (`require()` in `TabManager`) — a clean error (spec US2 scenario 4 / edge
  case).

## `chrome:close-all-tabs`

| | |
|---|---|
| Args | none |
| Reply | `{ closed: number }` — how many tabs were open before the call |
| Handler | `const n = tabs.list().length; tabs.closeAll(); return { closed: n };` |
| Queue | not queued (matches the existing `chrome:close-tab`, which is also unqueued) |

`preload/chrome.cjs`: `closeAllTabs: () => ipcRenderer.invoke("chrome:close-all-tabs")`.

## End state (Research R5)

Zero content tabs — identical to a freshly launched instance (which has no tabs). The
`tabs:changed` push carries `[]`; `app.ts` renders an empty tab strip; MCP `list_open_tabs`
returns `[]`. No placeholder / blank / home tab is created — HyppoVisor has no such
concept, and "the same state as a freshly launched instance" (FR-013 / US2 clarification)
is the zero-tab state.

## Renderer — "Close all tabs" button

- A row in a new **Tabs** section of the connection panel (sibling of the "Recent URLs"
  section), styled like `#clear-recent-urls`.
- `disabled` while the live tab count (from the existing `onTabsChanged` feed) is `0`
  (FR-013 no-op).
- On click: `await hyppo.closeAllTabs()`; an inline `.notice` reads
  *"Closed N tab(s)."* / *"No open tabs."* The panel stays open.
