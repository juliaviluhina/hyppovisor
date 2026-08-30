# Contract — Recent-URLs Dropdown (Feature 009)

## File: `<userData>/recent-urls.json`

- **Type**: JSON array of strings.
- **Semantics**: most-recent-first history of person-opened, successfully-loaded URLs;
  deduplicated by exact string; length ≤ `recentUrlsCap` (default 20).
- **Write discipline**: atomic — temp file `recent-urls.json.<pid>.tmp` then `renameSync`.
- **Read tolerance**: missing / unreadable / non-JSON / non-array / any non-string or empty
  element ⇒ empty history, file left untouched until the next update.
- **Location**: app user-data directory (beside `settings.json`, `interaction-log.jsonl`).
  NOT the shared data directory; no `provenance-log.md` entry.
- **User-editable**: yes — hand-editing to valid JSON is honoured on next read; deleting the
  file resets to empty.

## IPC (renderer ↔ main, `chrome:*` namespace)

| Channel | Kind | Request | Response / payload |
|---|---|---|---|
| `chrome:recent-urls` | `invoke` | — | `string[]` — the current history, most-recent-first |
| `chrome:clear-recent-urls` | `invoke` | — | resolves after the history is emptied, the file rewritten `[]`, and `recent-urls:changed` sent |
| `recent-urls:changed` | `send` (main→renderer) | — | `string[]` — the new history; fired after every add and after a clear |

All handlers registered **before** `win.loadFile` (feature-007 renderer/IPC race lesson).

## Preload bridge (`window.hyppo`)

```ts
recentUrls(): Promise<string[]>;
clearRecentUrls(): Promise<void>;
onRecentUrlsChanged(cb: (list: string[]) => void): void;
```

## Renderer

- `<datalist id="recent-urls">` bound to `#address` via `list="recent-urls"`.
- Datalist `<option>`s are rebuilt (in order) from `recentUrls()` on load and from every
  `onRecentUrlsChanged` payload.
- Connection panel: a "Clear recent URLs" control calling `clearRecentUrls()`.

## Recording rule (main)

`TabManager` fires `onPersonOpen(url)` when — and only when — a tab opened with
`openedBy === "person"` completes its initial load with `loadState === "loaded"`. `url` is
the `validateUrl`-normalized address the person entered, not the redirect landing URL.
`index.ts` folds it in with `addRecentUrl(list, url, recentUrlsCap)`, persists, and pushes.

## Out of scope / unchanged

- No change to `open_url`, `navigate`, any MCP tool, the blocklist, the interaction audit
  log, `settings.json`, or the Open button.
- No dedupe normalization (exact string only). No per-URL timestamps. No titles. No
  configurable cap UI.
