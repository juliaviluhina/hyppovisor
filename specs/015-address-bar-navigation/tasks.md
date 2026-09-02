---
description: "Task list for feature 015 — Address Bar Reflects and Navigates the Active Tab"
---

# Tasks: Address Bar Reflects and Navigates the Active Tab

**Input**: Design documents from `/specs/015-address-bar-navigation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUDED. The repo gates every PR on the five constitution principles and on
`npm run test` + `npm run test:e2e` (quickstart.md names the specs that must pass). Test
tasks are therefore first-class here.

**Organization**: by user story. Note the real coupling — US1 (reflect) and US2 (navigate)
both sit on the Phase 2 active-tab-id plumbing; US3 (the "+" button) is independent of it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different file, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 — omitted for Setup, Foundational, Polish

## Path Conventions

Single-project Electron app: `src/{shared,main,preload,renderer}/`, `tests/{unit,integration}/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: nothing to scaffold — the feature edits existing files in an established
project. This phase only confirms a clean baseline.

- [X] T001 Confirm a clean build and green baseline: `npm run build && npm run lint && npm run test` all pass on `015-address-bar-navigation` before any change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: make the renderer learn the authoritative active tab id. Both US1 and US2
depend on every task here. See `contracts/tabs-changed-payload.md` and research R1.

**⚠️ CRITICAL**: no user-story work starts until Phase 2 is complete.

- [X] T002 Add `TabsChangedPayload` interface (`{ tabs: TabSummary[]; activeTabId: string | null }`) to `src/shared/types.ts`, next to `TabSummary`. Do NOT add any field to `TabSummary` itself (FR-012 scope guard — it is the MCP `list_open_tabs` shape).
- [X] T003 Add `get activeTabId(): string | null` to `TabManager` in `src/main/tabs/tab-manager.ts`, returning `this.activeId`.
- [X] T004 In `src/main/index.ts`, change every `send("tabs:changed", tabs.list())` call site to `send("tabs:changed", { tabs: tabs.list(), activeTabId: tabs.activeTabId })`. Grep `tabs:changed` first to get the full set (the `TabManager` `onChange` wiring, the post-`loadFile` explicit send, and the `HYPPO_E2E` branch's explicit send).
- [X] T005 In `src/preload/chrome.cjs`, update `onTabsChanged` to forward the payload object unchanged: `ipcRenderer.on("tabs:changed", (_e, payload) => cb(payload))`.
- [X] T006 In `src/renderer/app.ts`: update the `HyppoApi.onTabsChanged` type to `(cb: (p: { tabs: TabSummary[]; activeTabId: string | null }) => void) => void`; in the `hyppo.onTabsChanged(...)` handler destructure `{ tabs, activeTabId }`, set `activeId = activeTabId`, pass `tabs` to `render(...)`, and DELETE the "if activeId is unknown, use the last tab" fallback (current `app.ts:155-160`).
- [X] T007 Run `npm run test:e2e` for the tab-touching specs (`open-url`, `close-all-tabs`, `instance-management`, `multi-instance`, `background-window`, `recent-urls`) and confirm the payload shape change broke nothing (no spec subscribes to the raw event — they read `hyppo.listTabs()` / `__hyppo.list()` — so this is a verification task, fix only if red).

**Checkpoint**: the renderer now has an authoritative `activeId` on every `tabs:changed`.

---

## Phase 3: User Story 1 — The address bar shows the active tab's URL (Priority: P1) 🎯 MVP

**Goal**: `#address` always shows the active tab's current (post-redirect) URL — tracking
activation, redirect, in-page nav, agent `navigate` — and is empty with its placeholder
when no tab is open, without ever clobbering an in-progress edit.

**Independent Test**: open two tabs on different fixture URLs; switch via the strip and the
`#tabselect` dropdown and confirm `#address` shows the active tab's URL each time; trigger
`/redirect` in the active tab and confirm `#address` updates; close all tabs and confirm
`#address` clears.

### Tests for User Story 1

- [X] T008 [P] [US1] Add `tests/integration/address-bar-navigation.spec.ts` with the **US1** cases (style: `launchAppFull`, `--no-background`, fixture server, like `recent-urls.spec.ts`): (a) open two tabs, switch via `.tab` click and via `#tabselect`, assert `#address` value each time; (b) navigate the active tab to `/redirect`, assert `#address` becomes the landing URL within a generous timeout; (c) close all tabs (`#close-all-tabs`), assert `#address` has value `""`; (d) FR-003 — focus `#address`, type a partial URL, drive `__hyppo.navigate(activeTabId, otherFixtureUrl)` in the background, assert `#address` still holds the typed text; then click the other tab, assert `#address` now shows that tab's URL. Expect this file to FAIL until T009–T010 land.

### Implementation for User Story 1

- [X] T009 [US1] In `src/renderer/app.ts` add `syncAddress()`: if `document.activeElement === address` return (edit in progress — FR-003 / US1 scenario 4); else if a tab is active set `address.value` to that tab's `url` from the last `tabs` payload; else set `address.value = ""` (FR-002). Setting the same string must be a no-op (edge case: no flicker on title-only change).
- [X] T010 [US1] Wire `syncAddress()` in: call it at the end of the `hyppo.onTabsChanged` handler (after `render`), and add an `address` `blur` listener that calls it once (so an abandoned edit snaps back — edge case). Keep a module-level reference to the latest `tabs` array + `activeId` for `syncAddress()` to read.
- [X] T011 [US1] Run `tests/integration/address-bar-navigation.spec.ts` US1 cases green; run `npm run lint`.

**Checkpoint**: US1 is fully functional and independently testable. This is a shippable MVP
(display-only, the safe half).

---

## Phase 4: User Story 2 — Enter navigates the active tab in place (Priority: P1)

**Goal**: with a tab active, Enter or → re-points that tab (no new tab, still active),
under the same URL policy / link-shim unwrapping / failure messaging as opening a new tab,
and a successful navigation feeds recent-URLs. With no tab active, Enter / → open a new tab.

**Independent Test**: one tab open — edit `#address`, press Enter; assert tab count
unchanged, active tab now on the new URL, still active. Repeat via `#go`. Enter a non-http
URL → refusal notice, tab unchanged. Enter a dead-port URL → failed-load state + notice,
still one tab, no new tab. Confirm the successful entered URL lands in `#recent-urls`.

### Tests for User Story 2

- [X] T012 [P] [US2] Add the **US2** cases to `tests/integration/address-bar-navigation.spec.ts`: (a) one tab open, `#address` fill + Enter → `hyppo.listTabs()` count unchanged, active tab URL changed, still active; (b) same via `#go` click; (c) non-http URL → `#notice` shows an error, active tab URL unchanged; (d) dead-port URL → `#notice` error + still exactly one tab (no silent new tab — FR-009); (e) after a successful in-place navigation the entered URL appears in `#recent-urls option`; a refused/failed one does not; (f) with NO tab open, `#address` fill + Enter opens a new tab (FR-007); (g) with a tab active, fill `#address` with a link-shim / interstitial-wrapped URL (the feature-002 wrapper form used in `open-url.spec.ts` / the unwrap fixtures) + Enter → the active tab lands on the **unwrapped** target URL, in place, no new tab (FR-008). Expect FAIL until T013–T017.
- [X] T013 [P] [US2] Add `tests/unit/tab-manager-navigate-active.test.ts` **only if** `TabManager` is unit-reachable without a real window in this repo (check for an existing Electron mock/stub harness — research R4). Assert: `navigateActive` rejects `NO_ACTIVE_TAB` when none active; the URL handed to `onPersonOpen` is the `validateUrl`-normalised entered URL, not a redirect landing URL; `onPersonOpen` does not fire on a failed load. If no such harness exists, skip this task and note it — integration (T012) covers the behaviour.
  - **SKIPPED as a unit file** — `TabManager` imports `electron` directly and the repo has no Electron mock harness for it (integration-tested only, per research R4). All three assertions are instead covered as e2e in `address-bar-navigation.spec.ts`: (1) `NO_ACTIVE_TAB` — dedicated test calls `hyppo.navigateActive()` with zero tabs, expects the rejection and no fallback tab; (2) entered-vs-landing URL — dedicated test navigates in place through `/redirect` and asserts recent-URLs records the entered URL, not the landing URL; (3) no record on a failed load — the FR-010 dead-port case.

### Implementation for User Story 2

- [X] T014 [US2] Add `async navigateActive(rawUrl: string): Promise<TabSummary>` to `TabManager` in `src/main/tabs/tab-manager.ts`: throw `HyppoError("NO_ACTIVE_TAB", …)` when `this.activeId` is null; otherwise run the same body as `navigate(tabId, url)` (`unwrapUrl` → `validateUrl` → `recordUnwrap` → `setActive` → `onActivity` → `load`) against the active tab; on `tab.loadState === "loaded"` fire `this.events.onPersonOpen(url)` with the validated entered `url`; return `this.summary(tab)`. Factor the shared body with `navigate()` if it reads cleanly; duplication of ~5 lines is acceptable otherwise.
- [X] T015 [US2] In `src/main/index.ts` add `ipcMain.handle("chrome:navigate-active", (_e, url: string) => queue.run(() => tabs.navigateActive(url)).then((r) => ({ ...r.value, queueDepth: r.queueDepth })))`, placed next to the `chrome:open-url` handler. Do NOT add a new `__hyppo` test-handle method (the spec drives the renderer path).
- [X] T016 [US2] In `src/preload/chrome.cjs` add `navigateActive: (url) => ipcRenderer.invoke("chrome:navigate-active", url)` to the exposed `hyppo` object; add it to the `HyppoApi` interface in `src/renderer/app.ts`.
- [X] T017 [US2] In `src/renderer/app.ts` rename `open()` → `submit()`: read `const url = address.value.trim()`; `if (!url) return;`; if `activeId` is set call `hyppo.navigateActive(url)` (on resolve, do NOT force-clear `address.value` — the ensuing `tabs:changed` → `syncAddress()` handles it); else call `hyppo.openUrl(url)` (keep the existing `address.value = ""` clear on resolve so `recent-urls.spec.ts`'s `toHaveValue("", …)` still holds). Keep the `catch` → `showNotice(error)` path (no new-tab fallback — FR-009). Bind `submit` to both the `#go` click and the `#address` Enter keydown.
- [X] T018 [US2] In `src/renderer/index.html` update the `#address` `placeholder` from `"https://…  — Enter opens a new tab"` to `"https://…  — Enter navigates this tab · + opens a new tab"` (FR-011).
- [X] T019 [US2] Run T012 (and T013 if created) green; `npm run lint`; re-run `tests/integration/recent-urls.spec.ts` to confirm the new-tab clear-on-open path is unbroken.

**Checkpoint**: US1 + US2 both work independently. The address bar now behaves like a
browser omnibox.

---

## Phase 5: User Story 3 — Open a new tab even when a tab is active (Priority: P2)

**Goal**: a dedicated "+" button opens the typed URL in a new tab without disturbing the
active tab; present whenever the address row is; with no tab active it behaves like submit.

**Independent Test**: with one tab open, type a URL and click "+"; confirm a second tab is
created and activated while the first tab is unchanged. With no tab open, "+" opens a new
tab.

### Tests for User Story 3

- [X] T020 [P] [US3] Add the **US3** cases to `tests/integration/address-bar-navigation.spec.ts`: (a) one tab open, `#address` fill, click `#newtab` → `hyppo.listTabs()` has 2 tabs, the new one active, the original tab's URL unchanged; (b) no tab open, `#address` fill, click `#newtab` → one tab created. Expect FAIL until T021–T022.

### Implementation for User Story 3

- [X] T021 [US3] In `src/renderer/index.html` add `<button id="newtab" title="Open in a new tab" aria-label="Open in a new tab">` immediately after `#go` inside `#bar-row`, with a "+" glyph (inline SVG, matching `#go`'s icon style). Add a CSS rule mirroring `#go` (reuse the selector list, e.g. `#go, #newtab { … }` and `#go svg, #newtab svg { … }`).
- [X] T022 [US3] In `src/renderer/app.ts` add a `#newtab` click handler that always calls `hyppo.openUrl(address.value.trim())` (guard empty → no-op), independent of `activeId`, clearing `address.value` on resolve like the existing new-tab path.
- [X] T023 [US3] Run T020 green; `npm run lint`.

**Checkpoint**: all three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T024 [P] Update `docs/install-and-run.md` (~line 45, "Type a URL to try it"): note that with a tab open, Enter / → re-point the current tab and the "+" button opens a new tab.
- [X] T025 [P] Add a one-line clarification to `docs/design-notes.md` near "No Enter key, ever" (~line 89): the ban is on *page-interaction operations* against web content; the app's own chrome address bar submitting with Enter is a top-level `loadURL`, never a DOM submit — consistent with plan.md's Constitution Check.
- [ ] T026 Run the full `quickstart.md` manual walkthrough (US1, US2, US3, FR-003 steps 11–13) against `npm start`. **Not run by the implementing agent — needs a human at a display.** The automated `address-bar-navigation.spec.ts` covers the same US1/US2/US3/FR-003 paths headlessly and is green.
- [X] T027 Full green gate: `npm run build && npm run lint && npm run test && npm run test:e2e`.
- [ ] T028 In the PR description, call out for the Principle III review gate: (a) the new `chrome:navigate-active` IPC channel; (b) the `tabs:changed` payload change from `TabSummary[]` to `{ tabs, activeTabId }`. Both stay inside the renderer↔main chrome boundary; the MCP surface is untouched. **Pending — no PR opened yet;** copy the note above into the PR body when it is raised. (One further review point: `errors.ts` gained the `NO_ACTIVE_TAB` code.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: after Setup. **Blocks US1 and US2.** (US3 does not strictly need it, but ships after for a coherent branch.)
- **US1 (Phase 3)**: after Phase 2.
- **US2 (Phase 4)**: after Phase 2. Independent of US1 in principle, but both edit `src/renderer/app.ts` — see below.
- **US3 (Phase 5)**: after Phase 2 (for branch coherence); its code touches only `index.html` + a fresh handler block in `app.ts`.
- **Polish (Phase 6)**: after US1–US3.

### Story Independence & the `app.ts` / spec-file constraint

- `src/renderer/app.ts` is edited by T006 (Foundational), T009–T010 (US1), T016–T017 (US2), T022 (US3). These are **sequential** on that file — do not run those tasks in parallel with each other.
- `tests/integration/address-bar-navigation.spec.ts` is created by T008 (US1) and appended by T012 (US2) and T020 (US3). T008 must land first; T012/T020 then edit it sequentially.
- `src/preload/chrome.cjs`: T005 (Foundational) then T016 (US2) — sequential.
- `src/main/tabs/tab-manager.ts`: T003 (Foundational) then T014 (US2) — sequential.
- `src/main/index.ts`: T004 (Foundational) then T015 (US2) — sequential.

### Within Each User Story

- Write the story's test task first; confirm it fails; then implement; then re-run green.

### Parallel Opportunities

- T024 and T025 (docs) are `[P]` — different files, no code dependency.
- T008, T012, T020 are marked `[P]` **only** in the sense that they belong to different
  stories; in practice they share one spec file, so land T008 first, then T012, then T020.
- T013 (unit test, if created) is genuinely parallel with the US2 integration work — different file.
- Across stories: because `app.ts` is the shared hot file, the realistic path is
  Foundational → US1 → US2 → US3 in order, by one implementer. Two implementers could split
  US2's main-process side (T014–T015) from US1's renderer side (T009–T010) after Phase 2.

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 (T001) → Phase 2 (T002–T007) → Phase 3 (T008–T011).
2. **STOP and validate**: the address bar reflects the active tab; nothing about Enter has
   changed yet. Safe, shippable, useful on its own.

### Incremental delivery

1. Foundational → address bar has a source of truth.
2. + US1 → bar reflects the active tab (MVP, display-only).
3. + US2 → Enter / → navigate in place; recent-URLs fed.
4. + US3 → "+" button for new tabs.
5. Polish → docs + full gate + PR review-gate note.

---

## Notes

- `[P]` = different file, no dependency on an incomplete task. The renderer `app.ts` is the
  main serialization point here — respect the ordering above.
- No MCP tool, no persisted store, no constitution amendment (FR-012).
- Commit after each task or logical group; the repo convention is `feat(015): …` /
  `test(015): …` prefixes (see `commit-message` skill).
- The `NO_ACTIVE_TAB` reject is defence-in-depth; the renderer's `submit()` picks
  open-vs-navigate before calling, so it should never surface in normal use (research R7).
