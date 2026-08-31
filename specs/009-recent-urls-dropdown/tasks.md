---

description: "Task list for feature 009 — recent-URLs dropdown"
---

# Tasks: Recent-URLs Dropdown

**Input**: Design documents in `specs/009-recent-urls-dropdown/` (`plan.md`, `spec.md`,
`research.md`, `data-model.md`, `contracts/recent-urls.md`, `quickstart.md`)

**Tests**: included — the repo ships `vitest` unit + Playwright `_electron` integration for
every feature; the spec defines an Independent Test per story.

**Organization**: by user story (spec priority): US1 reopen from dropdown (P1), US2 short /
current / ordered / persistent + clear (P2), US3 the person's own intentional history (P3).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: different file, no incomplete-task dependency
- **[Story]**: US1–US3; Setup / Foundational / Polish carry no label

## Path Conventions

Single project — `src/main/**`, `src/preload/**`, `src/renderer/**`, `tests/**` (existing
layout, per plan.md).

---

## Phase 1: Setup

- [x] T001 Add `recentUrlsCap` to `src/main/config.ts` — `numFromEnv("HYPPO_RECENT_URLS_CAP", 20)`.

---

## Phase 2: Foundational (blocking)

- [x] T002 Create `src/main/recent-urls.ts` mirroring `src/main/settings.ts`: export
  `RECENT_URLS_FILENAME = "recent-urls.json"`; `loadRecentUrls(userDataDir): string[]`
  (read + `JSON.parse` + validate array-of-non-empty-strings; any failure → `[]`, no
  rewrite); `saveRecentUrls(userDataDir, urls): void` (write `"<file>.<pid>.tmp"` then
  `renameSync`); and the pure `addRecentUrl(list, url, cap): string[]` (drop exact
  duplicate → `unshift` → `slice(0, cap)`). No Electron import.
- [x] T003 [P] Add `tests/unit/recent-urls.test.ts`: `addRecentUrl` (append, move-to-front,
  cap-evict oldest, idempotent-at-front, order preserved); `loadRecentUrls` (missing / `{}`
  / `["a", 3, ""]` → `[]` with no rewrite; valid array passes through); `saveRecentUrls`
  round-trips and leaves no `*.tmp`.

**Checkpoint**: the list rules + persistence exist and are unit-proven; stories can wire UI.

---

## Phase 3: User Story 1 — reopen a recent URL without retyping (Priority: P1) 🎯 MVP

**Goal**: a native `<datalist>` on `#address` shows person-opened URLs, newest first, live.

**Independent Test**: open two URLs from the address input → both appear in the datalist,
newest first, no re-focus needed; selecting one and pressing Open opens it.

### Tests for User Story 1

- [x] T004 [P] [US1] Add `tests/integration/recent-urls.spec.ts`: type `static.html`'s URL
  into `#address` and Open; once loaded, `<datalist id="recent-urls">` contains it without
  re-focusing; open a second URL → datalist shows both, newest first; selecting an entry +
  Open opens that URL; typing a substring narrows the native suggestions.

### Implementation for User Story 1

- [x] T005 [US1] `src/main/tabs/tab-manager.ts`: add `onPersonOpen(url: string)` to
  `TabEvents`; in `open(rawUrl, openedBy)`, after the initial `load()` resolves with
  `loadState === "loaded"` **and** `openedBy === "person"`, fire
  `this.events.onPersonOpen(validatedUrl)` (the `validateUrl` result, not the redirect
  landing URL).
- [x] T006 [US1] `src/main/index.ts`: `let recentUrls = loadRecentUrls(app.getPath("userData"))`
  at startup; in the `TabManager` events object add
  `onPersonOpen: (url) => { recentUrls = addRecentUrl(recentUrls, url, config.recentUrlsCap);
  saveRecentUrls(app.getPath("userData"), recentUrls); win.webContents.send("recent-urls:changed", recentUrls); }`.
- [x] T007 [US1] `src/main/index.ts`: register
  `ipcMain.handle("chrome:recent-urls", () => recentUrls)` **before** `win.loadFile`
  (alongside the other `chrome:*` handlers).
- [x] T008 [US1] `src/preload/chrome.cjs`: add
  `recentUrls: () => ipcRenderer.invoke("chrome:recent-urls")` and
  `onRecentUrlsChanged: (cb) => ipcRenderer.on("recent-urls:changed", (_e, l) => cb(l))`.
- [x] T009 [US1] `src/renderer/index.html`: add `<datalist id="recent-urls"></datalist>`
  and `list="recent-urls"` on `#address`.
- [x] T010 [US1] `src/renderer/app.ts`: add `fillDatalist(list: string[])` that replaces
  `#recent-urls` children with one `<option value>` per entry in order; call it on load via
  `hyppo.recentUrls()` and register `hyppo.onRecentUrlsChanged(fillDatalist)`.

**Checkpoint**: opening URLs from the address bar builds a working dropdown; US1 testable
alone.

---

## Phase 4: User Story 2 — short, current, ordered, persistent + clearable (Priority: P2)

**Goal**: cap 20, dedupe, move-to-front, restart persistence, corrupt-file tolerance, and a
connection-panel "Clear recent URLs" button.

**Independent Test**: exceed the cap → only the newest cap-many remain; re-open an entry →
front, once; quit + relaunch → identical; clear button → datalist empty, file `[]`.

### Tests for User Story 2

- [x] T011 [P] [US2] Extend `tests/integration/recent-urls.spec.ts`: with a lowered
  `HYPPO_RECENT_URLS_CAP`, opening more distinct URLs evicts the oldest; re-opening an
  existing entry moves it to the front with no duplicate; quit + relaunch (same
  `HYPPO_USER_DATA_DIR`) shows the identical datalist on load; a pre-written malformed
  `recent-urls.json` → app starts, datalist empty, file untouched until the next
  person-open; clicking "Clear recent URLs" in the connection panel empties the datalist
  immediately and rewrites the file as `[]`.

### Implementation for User Story 2

- [x] T012 [US2] `src/main/index.ts`: register
  `ipcMain.handle("chrome:clear-recent-urls", () => { recentUrls = []; saveRecentUrls(app.getPath("userData"), []); win.webContents.send("recent-urls:changed", []); })`
  **before** `win.loadFile`.
- [x] T013 [US2] `src/preload/chrome.cjs`: add
  `clearRecentUrls: () => ipcRenderer.invoke("chrome:clear-recent-urls")`.
- [x] T014 [US2] `src/renderer/panel.ts`: add a small section/row with a "Clear recent URLs"
  button wired to `hyppo.clearRecentUrls()`; reflect the empty state (disabled/hidden when
  the list is already empty — cosmetic, may read the list via `hyppo.recentUrls()` /
  `onRecentUrlsChanged`).
- [x] T015 [US2] Confirm cap, dedupe, and ordering are produced entirely by `addRecentUrl`
  (T002) — no equivalent logic duplicated in `index.ts` or the renderer.

**Checkpoint**: US1 + US2 both independently functional; the list stays small and survives
restarts.

---

## Phase 5: User Story 3 — the person's own intentional history (Priority: P3)

**Goal**: only person-initiated, successfully-loaded opens enter the history.

**Independent Test**: agent `open_url` and a failed load do not appear; a person-clicked
`target="_blank"` tab does; a redirect records the entered URL.

### Tests for User Story 3

- [x] T016 [P] [US3] Extend `tests/integration/recent-urls.spec.ts`: an MCP `open_url` for
  an otherwise-unvisited URL does **not** enter the datalist; typing a non-resolving URL and
  Open (load fails) does **not**; a person-clicked link that opens as a new tab **does**
  once it loads; opening `redirect.html` records the entered URL, not the 302 landing URL.

### Implementation for User Story 3

- [x] T017 [US3] Verify/tighten the `onPersonOpen` guard added in T005: it fires only for
  `openedBy === "person"` and only after `load()` resolved (never in the `catch`); the
  `target="_blank"` path already calls `open(url, "person")` so it is covered. Add a
  non-resolving-URL helper (or reuse an existing offline-failing fixture) for the
  failed-load case.

**Checkpoint**: all three stories independently functional.

---

## Phase 6: Polish

- [x] T018 [P] `README.md`: add `recent-urls.json` to the "what the app writes to the
  user-data area" inventory (beside `settings.json` / `interaction-log.jsonl`); add one line
  on the address-bar dropdown and the connection-panel "Clear recent URLs" action.
- [x] T019 Run `specs/009-recent-urls-dropdown/quickstart.md` §1–§4 against a built app; fix
  any doc/behaviour drift.
- [x] T020 Full gate: `npm run build && npm run lint && npm test && npm run test:e2e`
  (local port 7357 free); confirm `settings.json` is unaffected by any recent-URL operation.

---

## Dependencies & Execution Order

### Phase order

- **Setup (T001)** → **Foundational (T002–T003)** → stories.
- **US1 (T004–T010)**: needs Foundational. T005 (tab-manager) → T006 (index wiring) →
  T007 (IPC) are sequential (same/adjacent files, real dependency). T008/T009/T010 follow;
  T009 ‖ T008.
- **US2 (T011–T015)**: needs US1's IPC + preload + panel scaffolding. T012 → T013 → T014
  sequential-ish (index → preload → panel).
- **US3 (T016–T017)**: needs US1's `onPersonOpen` hook; T017 is verification + a test
  fixture.
- **Polish (T018–T020)**: after all desired stories.

### Story independence

- US1 delivers the dropdown; US2 and US3 refine list behaviour and provenance. Each has its
  own integration assertions and a checkpoint.
- US1's `onPersonOpen` hook is already scoped to person + loaded, so US3 is mostly the tests
  that prove it; US3 remains independently demonstrable.

### Parallel opportunities

- T003 runs while T002 stabilises (write test then implementation, or in parallel).
- Within a story the `[P]` test task runs first / alongside.
- T008 ‖ T009 in US1. T018 ‖ the rest of Polish.

---

## Implementation Strategy

### MVP (US1 only)

Setup → Foundational → US1 → validate the dropdown fills and reopens. Ship.

### Incremental delivery

US1 (dropdown works) → US2 (bounded, persistent, clearable) → US3 (person-only, loaded-only)
→ Polish (README inventory + gate). Each checkpoint is shippable and regresses nothing.

---

## Notes

- `[P]` = different file, no incomplete-task dependency.
- The history file is app user-data, **not** the shared data directory — no
  `provenance-log.md` entry (plan Constitution Check).
- All IPC handlers registered before `win.loadFile` (feature-007 race lesson).
- Keep every list rule in `addRecentUrl`; `index.ts` only calls it.
