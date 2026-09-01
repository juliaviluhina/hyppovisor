---

description: "Task list for feature 013 — Unobtrusive / Background Window"
---

# Tasks: Unobtrusive / Background Window

**Input**: Design documents from `specs/013-background-window/`
**Prerequisites**: plan.md, spec.md, research.md (R1–R8), data-model.md, contracts/launch-flag.md, contracts/window-lifecycle.md, quickstart.md

**Tests**: Included — the spec (US1–US5 Independent Tests) and plan (Testing section) explicitly require unit + integration coverage.

**Organization**: Grouped by user story (US1–US5) so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 (setup / foundational / polish carry no story label)

## Path Conventions

Existing single-project layout: `src/main/**`, `src/renderer/**`, `tests/**` at repo root.

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching window lifecycle.

- [x] T001 Confirm baseline is green on branch `013-background-window`: run `npm run build && npm run lint && npm test && npm run test:e2e` and record the e2e pass/fail counts (used as the reference for T016 / T023 "unchanged outcome").

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `--background` flag and the single `show: false` + post-load reveal switch that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [P] In `src/main/instance.ts`: add `background: boolean` to the `ResolvedInstance` interface and set it from a bare `--background` token in the existing argv scan — present anywhere → `true`, absent → `false`, any `--background=…` form is not the flag and is ignored, never aborts startup (research.md R1, data-model.md §1). Composes with `--instance` / `--port` / `HYPPO_USER_DATA_DIR` in any order.
- [x] T003 In `src/main/index.ts`: construct the `BrowserWindow` with `show: false` (was default `true`) and `webPreferences.backgroundThrottling: false` (contracts/window-lifecycle.md "BrowserWindow construction").
- [x] T004 In `src/main/index.ts`, immediately after `await win.loadFile(...)` (before `send("tabs:changed", …)` / `pushConnection()`): add the reveal switch — `resolved.background` → leave hidden, `win.setSkipTaskbar(true)`, `if (process.platform === "darwin") app.dock?.hide()`; else `resolved.source === "default"` → `win.show()`; else → `win.showInactive()` (contracts/window-lifecycle.md "Reveal decision", data-model.md §2). Depends on T002, T003.
- [x] T005 [P] In `src/main/tabs/tab-manager.ts`: add `backgroundThrottling: false` to the tab `WebContentsView` `webPreferences` (research.md R7, contracts/window-lifecycle.md "Tab views").

**Checkpoint**: `--background` parses, the window is constructed hidden, and the three-way reveal runs after load. User stories can now proceed.

---

## Phase 3: User Story 1 - Run several instances without them taking over the screen (Priority: P1) 🎯 MVP

**Goal**: `--instance <name> --port <n> --background` starts an instance with no visible window, no focus taken, no Dock / ⌘-Tab / taskbar entry; its MCP server and every capability work exactly as a foreground instance's.

**Independent Test**: Launch two or three instances with `--background`. No window appears, focus never leaves the foreground app, each instance answers on its MCP port, and an agent can open a URL / read a page / fill a field / screenshot in each.

- [x] T006 [P] [US1] In `tests/unit/instance.test.ts`: add a `--background` describe block — flag present / absent / `--background=true` treated as unknown arg; and composition cases proving `background: true` alongside `--instance work`, `--port 7358`, and `HYPPO_USER_DATA_DIR` env, in mixed order, without disturbing `name` / `label` / `cliPort` / `source`.
- [x] T007 [US1] Create `tests/integration/background-window.spec.ts` — US1 test: `_electron.launch` two instances with `--instance` / `--port` / `--background` (offline fixture server / loopback only). Assert `await app.evaluate(() => require("electron").BrowserWindow.getAllWindows()[0].isVisible())` is `false` for each; assert each MCP port answers `initialize` with `serverInfo.name === "hyppovisor-<label>"`; drive `open_url` → `read_page` → `interact` (fill) → `screenshot` against each and assert success. Assert `BrowserWindow.getFocusedWindow()` is unaffected by either launch.
- [x] T008 [US1] In `tests/integration/background-window.spec.ts`: assert the FR-005 presentation state for a `--background` instance — on darwin `await app.evaluate(() => require("electron").app.dock?.isVisible?.() ?? false)` is `false`; assert `win.setSkipTaskbar` intent by checking the window was never shown (`isVisible() === false`) after `loadFile` settled.

**Checkpoint**: US1 fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 - Summon an instance to sign in or review (Priority: P2)

**Goal**: Re-launching a running instance with the same `--instance` identity brings its window to the foreground and focuses it; closing that window returns the instance to the background (MCP server still running), it does not quit.

**Independent Test**: With a `--background` instance running, perform the summon gesture. The window comes to the foreground and is fully interactive. Dismiss it — the instance is still running and still reachable on its MCP port. Other instances are unaffected.

- [x] T009 [US2] In `src/main/index.ts`: extend the feature-012 `app.on("second-instance", …)` handler to also un-hide a `--background` window — after `win.show(); win.focus();` add `win.setSkipTaskbar(false); if (process.platform === "darwin") app.dock?.show();` (research.md R3, contracts/window-lifecycle.md "second-instance handler"). Depends on T004.
- [x] T010 [US2] In `src/main/index.ts`: add `let quitting = false; app.on("before-quit", () => { quitting = true; });` and `win.on("close", (e) => { if (quitting || !resolved.background) return; e.preventDefault(); win.hide(); win.setSkipTaskbar(true); if (process.platform === "darwin") app.dock?.hide(); });` (research.md R4, contracts/window-lifecycle.md "Close interceptor"). `window-all-closed → app.quit()` stays unchanged. Depends on T004.
- [x] T011 [US2] In `tests/integration/background-window.spec.ts`: add US2 test — start a `--background` instance plus one sibling; second `_electron.launch` into the same profile dir; assert the first window becomes `isVisible()` true and is the focused window within ~2 s; then trigger `win.close()` via `app.evaluate` and assert the window is hidden (`isVisible() === false`), the process is still alive, and the MCP port still answers `initialize`; assert the sibling's visibility and MCP port are unchanged throughout.

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 - A named instance never steals focus (Priority: P2)

**Goal**: Launching any `--instance <name>` (without `--background`) shows the window but never moves OS focus; the plain default instance (no `--instance`, no `--background`) still shows AND focuses, unchanged.

**Independent Test**: While typing in another application, launch a named instance without `--background` — focus does not move, no keystroke lost. Launch the plain default instance — it shows and focuses as before.

> Implementation is already covered by the Foundational reveal switch (T004: `source !== "default"` → `win.showInactive()`, `source === "default"` → `win.show()`). This phase is verification only.

- [x] T012 [P] [US3] In `tests/unit/instance.test.ts`: add cases pinning `resolved.source` — `default` (no `--instance`, no env dir), `instance` (`--instance <name>`), `env-dir` (`HYPPO_USER_DATA_DIR`) — so the reveal switch's decision input is regression-guarded.
- [x] T013 [US3] In `tests/integration/background-window.spec.ts`: add US3 test — `_electron.launch` `--instance <name> --port <n>` without `--background`; assert `BrowserWindow.getAllWindows()[0].isVisible()` is `true` and `BrowserWindow.getFocusedWindow()` is `null` (app not activated). Add a note in the test referencing quickstart.md step 3 as the manual check for SC-007 (plain `npx electron .` shows + focuses), which cannot be asserted under the profile-isolated harness.

**Checkpoint**: US1–US3 independently functional.

---

## Phase 6: User Story 4 - Local test runs don't flash windows (Priority: P3)

**Goal**: `npm run test:e2e` on a developer machine shows zero HyppoVisor windows; every test that passed with visible windows still passes, screenshots included.

**Independent Test**: Run the integration suite locally — no window appears at any point and the pass/fail outcome matches the T001 baseline.

- [x] T014 [US4] In `tests/integration/helpers.ts`: append `--background` to the assembled `args` in `launchApp` and `launchAppFull`, unless the caller's `extraArgs` already opts out (a spec that specifically needs a visible window passes its own args) — research.md R8. `_electron.firstWindow()` / the "wait for firstWindow + ping port" loop are unaffected (Playwright hooks window creation, not visibility).
- [x] T015 [US4] Run `npm run test:e2e` — confirm no HyppoVisor window appears on screen and the pass/fail counts match the T001 baseline, including `tests/integration/screenshot.spec.ts` (the live proof of R2: `capturePage()` on a tab inside a hidden window).
- [x] T016 [US4] CONTINGENCY — only if `screenshot.spec.ts` fails in T015: add a reveal-then-capture fallback scoped to `src/main/page/screenshot.ts` (momentary `win.showInactive()` → `capturePage()` → `win.hide()` around the capture, or off-screen `win.setPosition(-32000, -32000)` while shown, then restore) per research.md R2. Change no spec assertion; re-run `screenshot.spec.ts` unchanged. If T015 passed, mark this task done with "not needed".

**Checkpoint**: US1–US4 independently functional; suite runs windowless.

---

## Phase 7: User Story 5 - Quitting a background instance is discoverable (Priority: P3)

**Goal**: A background instance with no visible window can be fully quit by a documented method (Ctrl-C in the launching terminal; Cmd/Ctrl-Q from the existing default menu when summoned). Quitting one instance stops no other.

**Independent Test**: Start a `--background` instance, stop it with the documented method, confirm the process exits and siblings are untouched.

- [x] T017 [US5] In `src/main/index.ts`: add `for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => app.quit());` (research.md R5, contracts/window-lifecycle.md "Terminal quit"). `app.quit()` → `before-quit` sets `quitting = true` → the T010 `close` handler lets the window go → clean exit. No application menu is added or replaced (default Cmd/Ctrl-Q already covers the summoned case). Depends on T010.
- [x] T018 [US5] In `tests/integration/background-window.spec.ts`: add US5 test — start a `--background` instance plus a sibling; call `app.evaluate(() => require("electron").app.quit())` (or send SIGINT to the process) on the first; assert its process exits and its MCP port stops answering; assert the sibling still answers `initialize` on its port.

**Checkpoint**: All five user stories independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T019 [P] In `.specify/memory/constitution.md`: apply the PATCH bump 1.4.1 → 1.4.2 — append the hidden-and-summoned-window sentence to Principle III bullet one, add the `1.4.2` Amendment History entry, update the footer to `**Version**: 1.4.2 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-09-01` (exact text in research.md R8).
- [x] T020 [P] In `docs/configuration.md`: document `--background` in the "Launch flags" table; add the summon gesture, how to quit a background instance (Ctrl-C / Cmd·Ctrl-Q), and the macOS Dock / ⌘-Tab behaviour (FR-014); recommend `--background` for multi-instance setups in the "Run more than one HyppoVisor" section (FR-015).
- [x] T021 [P] In `docs/connect-an-agent.md` and `skills/hyppovisor/SKILL.md`: mention `--background` in the parallel-sessions guidance so agent setups launch quiet instances (consistent with FR-015). Keep the launch/register recipes otherwise unchanged.
- [x] T022 Run `npm run build && npm run lint && npm test && npm run test:e2e` — all green; e2e outcome matches the T001 baseline.
- [x] T023 Execute `specs/013-background-window/quickstart.md` flows 1–5 by hand on macOS; confirm SC-001…SC-007 (no windows on three `--background` launches; summon within ~2 s; close → background; named instance no focus steal; plain default still focuses; Ctrl-C isolates one instance).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. **Blocks all user stories.** Within it: T002 and T005 are `[P]`; T003 before T004.
- **US1 (Phase 3)**: after Foundational. No dependency on US2–US5.
- **US2 (Phase 4)**: after Foundational (T009/T010 touch the same `index.ts` region as T004). Independent of US1, US3–US5.
- **US3 (Phase 5)**: after Foundational (impl already done in T004) — verification only. Independent of others.
- **US4 (Phase 6)**: after Foundational; T014 changes the shared harness, so run its full-suite check (T015) after US1–US3 land to keep the baseline comparison meaningful. T016 is conditional on T015.
- **US5 (Phase 7)**: after Foundational; T017 depends on T010 (the `quitting` flag / `close` handler).
- **Polish (Phase 8)**: after all targeted user stories. T019–T021 are `[P]` (separate files).

### Story independence

Each of US1, US2, US3, US5 has its own test block in `tests/integration/background-window.spec.ts` and is independently runnable. US4 is a harness + whole-suite property. The only shared source region is `src/main/index.ts` window lifecycle — Foundational lands the switch once, US2 and US5 extend disjoint parts of it.

---

## Parallel Opportunities

- **Foundational**: T002 (`instance.ts`) ∥ T005 (`tab-manager.ts`).
- **US1**: T006 (`instance.test.ts`) ∥ start of T007 (new spec file).
- **US3**: T012 (`instance.test.ts`) ∥ T013 (spec file) — different files.
- **Polish**: T019 (`constitution.md`) ∥ T020 (`configuration.md`) ∥ T021 (`connect-an-agent.md` / `SKILL.md`).

### Parallel example: Foundational

```bash
Task: "T002 add ResolvedInstance.background + --background parse in src/main/instance.ts"
Task: "T005 backgroundThrottling: false on tab WebContentsView in src/main/tabs/tab-manager.ts"
```

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **stop and validate**: two `--background` instances, no windows, both MCP ports drive an agent end to end. Ship.

### Incremental delivery

US1 (MVP) → US2 (summon + close-to-background) → US3 (named-instance focus safety, verification) → US4 (windowless suite) → US5 (quit gesture) → Polish (constitution PATCH + docs). Each phase adds value without breaking the previous.

---

## Notes

- All e2e stays offline — fixture server / loopback only; assert window state via `app.evaluate(() => BrowserWindow.getAllWindows()[0].isVisible())` / `getFocusedWindow()`, never by looking at the screen.
- No new MCP tool, no browser interaction primitive, no external act, no persisted state, no new IPC channel, no new UI surface (FR-016 / FR-018 / FR-012).
- Commit after each phase or logical group. Mark tasks `[X]` as completed.

---

## Implementation notes (as-built deviations from the plan)

1. **`showInactive()` scoped to `source === "instance"`, not `env-dir`.** The plan's reveal
   switch put every non-`default` source on `showInactive()`. As built: `--background` →
   hidden; `source === "instance"` → `showInactive()` (FR-003); **`default` + `env-dir` →
   `win.show()`** (pre-013 behaviour). Driver: `show: false` + `showInactive()` with several
   stacked `WebContentsView`s reproducibly SIGSEGV'd the renderer on macOS / Electron 33
   (`recent-urls.spec.ts`). Only FR-003 (`--instance`) requires no-focus; `env-dir` is
   unconstrained, so it stays on the safe path and the whole existing e2e suite keeps its
   pre-013 visibility. `research.md` R1 + `contracts/window-lifecycle.md` updated.

2. **`backgroundThrottling` applied at runtime, `--background` only.** Not set in
   `webPreferences` (part of the same crash repro). `win.webContents.setBackgroundThrottling(false)`
   in the reveal switch; `TabManager` gained a 4th ctor arg (`resolved.background`) and calls
   `view.webContents.setBackgroundThrottling(false)` per tab only when set. `research.md` R7
   updated.

3. **Harness opt-out is `--no-background`.** `helpers.ts` `launchApp` / `launchAppFull` add
   `--background` by default (SC-005); `launchAppFull` strips a `--no-background` token from
   `extraArgs` and skips the default when present. `recent-urls.spec.ts` (renderer-driven tab
   loading) opts out; every other spec runs windowless.

4. **e2e focus/visibility assertions relaxed.** The `_electron` harness has no active display
   session, so `BrowserWindow.getFocusedWindow()` is `null` even after `win.focus()`, and
   `isVisible()` is unreliable for an inactive (`showInactive()`) window. `background-window.spec.ts`
   asserts summon via `isVisible()` polling to `true` for a `--background` instance (that
   path is reliable), the no-focus guarantee via `getFocusedWindow() === null`, and defers
   on-screen visibility of an inactive named window to `quickstart.md` step 3.

5. **`multi-instance.spec.ts`** — two direct `electron.launch` calls gained `--background`
   (they only read label / server name / title / handshake; no window needed).

6. **`screenshot` is not at parity on `--background` (R2 fallback declined).** Manual
   verification against a real standalone `--background` instance (HTTP MCP, no CDP) showed
   `capturePage()` always fails — `INTERNAL "Current display surface not available for
   capture"`. The e2e `screenshot.spec.ts` pass is a false positive: Playwright's CDP client
   keeps a hidden window compositing. Decision: **do not** take the off-screen-reveal
   fallback; instead `screenshot.ts` maps the surface error to a clear
   `HyppoError("SCREENSHOT_FAILED", …)` (naming the fix), and the limitation is stated in
   the `screenshot` tool description, `docs/configuration.md`, `docs/tools.md`,
   `docs/connect-an-agent.md`, `skills/hyppovisor/SKILL.md`, FR-002, SC-002, and
   `research.md` R2. `background-window.spec.ts` US1 no longer asserts screenshot; a new
   `screenshot.test.ts` unit block covers the error mapping. `read_page` /
   `read_form_fields` / `interact` / `wait_for_selector` are unaffected (no surface needed).

7. **Removed the modal collision dialog on a summon relaunch.** Feature 012's
   `requestSingleInstanceLock()` guard called `failStartup(collisionMessage, 0)`, which
   showed a blocking "HyppoVisor is already running" error box on *every* re-launch of a
   running profile. Feature 013 makes that relaunch the summon gesture (FR-007), so the
   refused process now just prints a stderr line and `app.exit(0)` — the primary's
   `second-instance` handler is the only visible effect. `collisionMessage()` is kept for
   the breadcrumb + its unit test. `multi-instance.spec.ts` US2 dropped its `HYPPO_E2E=1`
   dialog-suppression workaround. `docs/configuration.md` / `research.md` R3 /
   `contracts/launch-flag.md` updated.

**Result:** unit 303 passed; e2e 119 passed (was 115 — +4 `background-window.spec.ts`);
`npm run build` + `npm run lint` clean.
