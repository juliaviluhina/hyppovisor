# Phase 0 Research: Recent-URLs Dropdown

Five decisions, all settled (the spec's clarify session resolved the user-facing ones).
Format: **Decision / Rationale / Alternatives rejected**.

---

## R1 — Native `<datalist>` for the dropdown

**Decision**: bind a `<datalist id="recent-urls">` to `#address` via `list="recent-urls"`.
The renderer rebuilds its `<option value="…">` children whenever the history changes.

**Rationale**: the dropdown, type-ahead filtering, keyboard navigation, and "show on focus"
behaviour are all native. Zero popup-positioning code, zero custom widget, no change to the
Open button. Matches the spec's "use the platform's native input-suggestion behavior"
(FR-001).

**Alternatives rejected**: a custom absolutely-positioned list → hundreds of lines of
focus/blur/keyboard/scroll handling for a v1 convenience; a `<select>` → wrong interaction
model (can't type a new URL).

**Known trade-off**: native datalist "show on focus vs show after first keystroke" and row
styling are platform-dependent. FR-001 and the spec edge cases already accept this; not
worth fighting.

---

## R2 — `recent-urls.ts` mirrors `settings.ts`

**Decision**: a new `src/main/recent-urls.ts` exporting:

- `RECENT_URLS_FILENAME = "recent-urls.json"`
- `loadRecentUrls(userDataDir): string[]` — read + `JSON.parse` + validate (array of
  non-empty strings); any failure → `[]`, and the file is **not** rewritten on a failed read
  (mirrors `loadSettings`' `existed: false` path).
- `saveRecentUrls(userDataDir, urls: string[]): void` — write `urls` (already capped/ordered
  by the caller) to `"<file>.<pid>.tmp"` then `renameSync` over the target.
- `addRecentUrl(list: string[], url: string, cap: number): string[]` — **pure**: drop any
  existing exact-match, unshift `url`, slice to `cap`. Returns a new array.

**Rationale**: `settings.ts` already proves this pattern (atomic write, defaults on corrupt,
no Electron import so `tests/unit` drives it directly). Same review burden, reused. Keeping
`addRecentUrl` pure makes the dedupe/order/cap rules a one-file unit test.

**Alternatives rejected**: a generic "json file store" abstraction over both `settings.ts`
and this → premature; two call sites don't justify it.

---

## R3 — Hook point: `TabManager` `onPersonOpen(url)` after a successful load

**Decision**: add `onPersonOpen: (url: string) => void` to `TabEvents`. Fire it inside
`TabManager.open(rawUrl, openedBy)` **after** the initial `load()` resolves with
`loadState === "loaded"` **and** `openedBy === "person"`. The URL passed is the
`validateUrl(rawUrl)` result (what the person effectively asked for), not the post-redirect
`webContents.getURL()`.

**Rationale**:
- `openedBy` already distinguishes person from orchestrator (FR-003/FR-004). The
  `target="_blank"` / `window.open` path calls `this.open(url, "person")`, so
  person-initiated new-tab links are covered with no extra code.
- Firing after `load()` resolves (not on `did-finish-load` / not in the `catch`) gives
  exactly "reached the loaded state, not a failed load" (FR-003, decision 5).
- Recording the entered URL, not the redirect target, matches the spec edge case ("that is
  what they would retype").

**Alternatives rejected**:
- Recording in `src/main/index.ts`'s `chrome:open-url` handler → misses person-triggered
  `target="_blank"` tabs, which go through `TabManager` directly.
- Listening to `webContents` `did-navigate` → fires for every in-page navigation and for
  agent `navigate`; wrong scope.
- Recording before load completes → would keep 404s from typos (spec decision 5 excludes
  them).

---

## R4 — `index.ts` owns the in-memory list; two IPC handlers + one push

**Decision**: `src/main/index.ts` calls `loadRecentUrls(app.getPath("userData"))` at
startup into a `let recentUrls`. In the `TabManager` events object:
`onPersonOpen: (url) => { recentUrls = addRecentUrl(recentUrls, url, config.recentUrlsCap);
saveRecentUrls(dir, recentUrls); win.webContents.send("recent-urls:changed", recentUrls); }`.
Register, **before `win.loadFile`**:

- `ipcMain.handle("chrome:recent-urls", () => recentUrls)`
- `ipcMain.handle("chrome:clear-recent-urls", () => { recentUrls = []; saveRecentUrls(dir,
  []); win.webContents.send("recent-urls:changed", []); })`

**Rationale**: identical shape to feature 007's `chrome:get-connection` +
`connection:changed`. Registering before `loadFile` is the feature-007 race lesson (the
renderer must not `invoke` a handler that isn't there yet). The renderer never touches the
filesystem (it can't — `sandbox` + `contextIsolation`).

**Alternatives rejected**: a broadcast to all windows → there is one window; `win.webContents.send`
is enough.

---

## R5 — Renderer wiring + the panel clear button

**Decision**:
- `src/renderer/index.html`: add `<datalist id="recent-urls"></datalist>` and
  `list="recent-urls"` on `#address`.
- `src/renderer/app.ts`: on module load, `hyppo.recentUrls().then(fillDatalist)`; register
  `hyppo.onRecentUrlsChanged(fillDatalist)`. `fillDatalist(list)` replaces the datalist's
  children with one `<option value="…">` per entry, in order.
- `src/renderer/panel.ts`: add a row with a "Clear recent URLs" button in a small section;
  on click, `hyppo.clearRecentUrls()` (the `recent-urls:changed` push then empties the
  datalist). Disable/hide the button when the list is already empty (cosmetic).
- `src/preload/chrome.cjs`: `recentUrls: () => ipcRenderer.invoke("chrome:recent-urls")`,
  `clearRecentUrls: () => ipcRenderer.invoke("chrome:clear-recent-urls")`,
  `onRecentUrlsChanged: (cb) => ipcRenderer.on("recent-urls:changed", (_e, l) => cb(l))`.

**Rationale**: smallest renderer change; `fillDatalist` is one function used by both the
initial read and the live push, so "load" and "update" cannot drift. The panel already
owns app-level actions, so the clear button has a home without a new surface.

**Alternatives rejected**: a dedicated settings pane for the clear button → new UI surface
for one button; the connection panel is the established place.

---

## Config

| Key | Env | Default |
|---|---|---|
| `recentUrlsCap` | `HYPPO_RECENT_URLS_CAP` | `20` |

Reuses the existing `numFromEnv` helper in `src/main/config.ts`.
