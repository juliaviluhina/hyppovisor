---

description: "Task list for feature 014 — Local Instance Management Panel"
---

# Tasks: Local Instance Management Panel

**Input**: Design documents from `specs/014-instance-management/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — this repo tests every feature (`vitest` unit + `@playwright/test`
`_electron` integration) and plan.md enumerates the test tasks.

**Organization**: Grouped by user story. US1 (instance panel) is the MVP; US2 (close all
tabs) is independently shippable and does **not** require the constitution amendment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 for story-phase tasks

## Path Conventions

Single project: `src/main/**`, `src/renderer/**`, `src/preload/**`, `src/shared/**`,
`tests/**` at repo root (per plan.md "Structure Decision").

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Small shared scaffolding both the main and renderer sides build on.

- [x] T001 [P] Add feature-014 config knobs to `src/main/config.ts` — `instanceShutdownGraceMs` (default 5000, env `HYPPO_INSTANCE_SHUTDOWN_GRACE_MS`), `instanceProbeTimeoutMs` (default 400, env `HYPPO_INSTANCE_PROBE_TIMEOUT_MS`), `instancePollMs` (default 2000, env `HYPPO_INSTANCE_POLL_MS`), using the existing `numFromEnv` helper (data-model.md §7)
- [x] T002 [P] Add `InstanceMode`, `InstanceRuntime` (the `runtime.json` shape), and `InstanceSummary` (the IPC row) to `src/shared/types.ts` per data-model.md §2–§3, with the same doc-comment style as the surrounding types
- [x] T003 [P] Add `listInstances()`, `closeInstance(pid)`, `closeAllTabs()` forwarders to the `hyppo` bridge in `src/preload/chrome.cjs` (each an `ipcRenderer.invoke("chrome:…")` one-liner per data-model.md §6) — one edit serving both stories; handlers land later

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Governance gate that MUST land before User Story 1 is implemented (FR-014).

**⚠️ CRITICAL for US1**: US1 tasks (Phase 3) MUST NOT be merged before T004. US2 (Phase 4)
does **not** depend on T004 and may proceed in parallel.

- [x] T004 Amend `.specify/memory/constitution.md` — Principle III gains a clause permitting a bounded local instance-management surface (one instance MAY enumerate and shut down other instances of the same user on the same machine, via per-instance transient runtime files; no daemon, no shared store, nothing in the shared data directory; Principles I / IV / V reaffirmed), bump **1.4.2 → 1.5.0**, add a `1.5.0` Amendment History entry citing feature `014-instance-management`, update the footer `**Version**` line (research.md R6, plan.md Complexity Tracking). May be done via `/speckit-constitution`.

**Checkpoint**: Amendment recorded — US1 implementation can be merged.

---

## Phase 3: User Story 1 — See and shut down local instances (Priority: P1) 🎯 MVP

**Goal**: An Instances section in the connection panel that lists every HyppoVisor instance
this user runs on this machine (label, MCP port, mode, responding state), marks the current
one as non-closable, and shuts down any other one after a confirmation naming it.

**Independent Test**: Launch 2+ instances (≥1 `--background`), open the panel in one,
confirm every instance appears with correct label / port / mode, close a non-current one
and confirm its process exits and its MCP port frees, and confirm the current instance's
row cannot be closed (spec US1 Independent Test; quickstart.md §1–§3).

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [x] T005 [P] [US1] Unit spec `tests/unit/instances-registry.test.ts` — `readRuntimeFile` parse / `schema` guard / malformed-and-absent tolerance; `enumerateProfiles` against a fake profile tree (missing `instances/` dir tolerated); `listInstances` filtering (live PID vs dead PID vs absent file vs junk file; stale file unlinked; `self` merged authoritatively; sort order); `isPidAlive` (ESRCH→false, EPERM→true); `closeInstance` SIGTERM→grace→SIGKILL with `vi.useFakeTimers()` and a stubbed `process.kill`, plus ESRCH→`alreadyGone` and EPERM→`{ok:false}` (data-model.md §4, contracts/instance-registry.md, contracts/instance-shutdown.md)
- [x] T006 [P] [US1] Integration spec `tests/integration/instance-management.spec.ts` — via `launchAppFull` (real app), 3 instances on `freePort()`s, one with `--background`: (a) `window.hyppo.listInstances()` in one returns all 3 with correct `label` / `port` / `mode` / `state` / `isCurrent`, in < 3 s (SC-001); (b) `closeInstance(pid)` of a non-current instance → that app's process exits and `mcpPost(port, ping)` stops answering within 10 s (SC-003) and it drops from a second instance's list within 5 s (SC-005); (c) `closeInstance(process.pid-of-current)` is refused (SC-004); (d) an instance closed via `app.close()` outside the panel drops from the list on the next poll (US1 scenario 4). Offline / loopback only.

### Implementation for User Story 1

- [x] T007 [P] [US1] Create `src/main/instances/registry.ts` with the file-level helpers per data-model.md §4 + contracts/instance-registry.md — `writeRuntimeFile(profileDir, r)` and `rewriteRuntimePort(profileDir, port)` (atomic temp-write + `renameSync`, mirroring `src/main/settings.ts`), `clearRuntimeFile(profileDir)` (best-effort `unlinkSync`, swallow `ENOENT`), `readRuntimeFile(profileDir)` (parse + `schema`/field guard, `null` on any problem), `enumerateProfiles(appSupportRoot)`, `isPidAlive(pid)`, `probePort(port, timeoutMs)` (`net.connect` to `127.0.0.1:port`, always `destroy()`). No Electron import.
- [x] T008 [US1] Add `listInstances(appSupportRoot, self, cfg)` to `src/main/instances/registry.ts` — enumerate → `readRuntimeFile` each → drop `!isPidAlive` (best-effort `unlinkSync` the stale file) → drop `pid === self.pid` → `probePort` survivors in parallel (`state` = responding / not-responding, `stdio` when `port === null`) → prepend `self` as `isCurrent` row → sort (current first, then `label` locale compare, then `port`). Never throws (contracts/instance-registry.md). Depends on T007.
- [x] T009 [US1] Add `closeInstance(pid, { graceMs })` to `src/main/instances/registry.ts` — `process.kill(pid, "SIGTERM")`; poll `isPidAlive` every 250 ms; `process.kill(pid, "SIGKILL")` + `forced: true` after `graceMs`; best-effort `unlinkSync` the target's `runtime.json`; map `ESRCH`→`{ ok:true, alreadyGone:true }`, `EPERM`→`{ ok:false, error:"not permitted (different user)" }`, else `{ ok:false, error }` (contracts/instance-shutdown.md). Depends on T007.
- [x] T010 [US1] Wire the runtime-file lifecycle in `src/main/index.ts` — capture `const appSupportRoot = app.getPath("userData")` **before** `app.setPath("userData", …)`; after the startup `pushConnection()`, call `writeRuntimeFile(app.getPath("userData"), { pid: process.pid, port: <effective port or null in stdio>, mode: resolved.background ? "background" : "foreground", label: instanceLabel, startedAt: new Date().toISOString() })`; in `app.on("before-quit")` add `clearRuntimeFile(app.getPath("userData"))` and `httpHandle?.close()`; in the `chrome:set-port` success paths call `rewriteRuntimePort(app.getPath("userData"), port)` (data-model.md §2 lifecycle table). Depends on T007.
- [x] T011 [US1] Add IPC handlers in `src/main/index.ts` — `ipcMain.handle("chrome:list-instances", …)` builds the `self` record from in-process state and returns `listInstances(appSupportRoot, self, { probeTimeoutMs: config.instanceProbeTimeoutMs })`; `ipcMain.handle("chrome:close-instance", (_e, pid) => …)` hard-refuses `pid === process.pid` with `{ ok:false, error:"can't close the current instance" }`, else returns `closeInstance(pid, { graceMs: config.instanceShutdownGraceMs })` (data-model.md §6, contracts/instance-shutdown.md). Depends on T008, T009, T010.
- [x] T012 [US1] Renderer Instances section in `src/renderer/panel.ts` — `renderInstances()` appends a `.section` with one `.inst-row` per `InstanceSummary` (`label` or `"(default)"` · `port` or `"stdio"` · `mode` · `state`); the `isCurrent` row gets `.inst-current`, a "this instance" tag, and a `disabled` Close button with hint "the instance you're viewing"; other rows get an enabled **Close** button. While `#panel` is open, `setInterval(refreshInstances, 2000 /* config.instancePollMs */)`; store the id and `clearInterval` in `close()`. `refreshInstances()` calls `hyppo.listInstances()` and re-renders; when the result is only the current row **and** the call rejected, show a `.notice` "Can't list other instances." (FR-010). Depends on T003, T011.
- [x] T013 [US1] Confirmation modal in `src/renderer/panel.ts` + CSS in `src/renderer/index.html` — a centered `role="dialog"` `aria-modal="true"` card over `#panel-body` with focus trap and `Esc`=Cancel; title text names the target `label` (or `"(default)"`) and `port` verbatim, body "Its open tabs and any in-progress work are lost. This can't be undone.", buttons **Cancel** (focused) / **Close instance**; on confirm `await hyppo.closeInstance(pendingClose.pid)` → `{ ok:false }` shows an inline `.notice` in the Instances section, success closes the modal and lets the next poll drop the row. Also retitle `#panel-head h2` to `HyppoVisor` in `index.html`. Depends on T012.

**Checkpoint**: US1 fully functional — `npm run test:e2e -- instance-management` green; quickstart.md §1–§3 pass.

---

## Phase 4: User Story 2 — Close all open tabs at once (Priority: P2)

**Goal**: A "Close all tabs" button in the connection panel that tears down every embedded
content tab and returns the instance to the freshly-launched zero-tab state, leaving the
MCP server, settings, and logged-in sessions untouched.

**Independent Test**: Open several tabs in one instance, activate "Close all tabs", confirm
every content tab is gone, the instance is still running and serving MCP, and its
`settings.json` / logged-in state are unaffected (spec US2 Independent Test; quickstart.md §4).

**Note**: No dependency on T004 (constitution amendment) — can be built and shipped before US1.

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL)

- [x] T014 [P] [US2] Integration spec `tests/integration/close-all-tabs.spec.ts` — via `launchAppFull`: open 3 tabs with `window.hyppo.openUrl` against the fixture server; `window.hyppo.closeAllTabs()` → `window.hyppo.listTabs()` returns `[]` and MCP `list_open_tabs` (via `mcpPost`) returns `[]`; the same instance still answers MCP `initialize`; `settings.json` is byte-unchanged (read before/after); the button is `disabled` when no tabs are open (FR-013, SC-006; contracts/close-all-tabs.md). Offline / loopback only.

### Implementation for User Story 2

- [x] T015 [P] [US2] Add `closeAll(): void` to `src/main/tabs/tab-manager.ts` per contracts/close-all-tabs.md — for each tab `this.win.contentView.removeChildView(tab.view)` + `tab.view.webContents.close()`; then `this.tabs.clear()`, `this.activeId = null`, `this.layout()`, one `this.events.onChange()`; return immediately without firing `onChange` when `this.tabs.size === 0`; leaves `this.overlay`, the MCP server, settings, and the session untouched
- [x] T016 [US2] Add `ipcMain.handle("chrome:close-all-tabs", …)` in `src/main/index.ts` — `const closed = tabs.list().length; tabs.closeAll(); return { closed };` — registered near the other `chrome:*-tab` handlers, unqueued (matches `chrome:close-tab`). Depends on T015.
- [x] T017 [US2] Renderer Tabs section in `src/renderer/panel.ts` + button style in `src/renderer/index.html` — a `.section` with a **Close all tabs** button styled like `#clear-recent-urls`, `disabled` while the live tab count (tracked from a new `hyppo.onTabsChanged` subscription in `panel.ts`, or `hyppo.listTabs()` on open) is `0`; on click `await hyppo.closeAllTabs()` → inline `.notice` "Closed N tab(s)." / "No open tabs."; panel stays open. Depends on T003, T016.

**Checkpoint**: US2 fully functional — `npm run test:e2e -- close-all-tabs` green; quickstart.md §4 passes.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T018 [P] Update `docs/configuration.md` — new "Manage running instances" subsection: the panel Instances list (label / port / mode / state), closing another instance (confirmation, graceful-then-forced), the `<profile>/runtime.json` mechanism and its limit (an instance under a non-tree `HYPPO_USER_DATA_DIR` is not enumerable), and the "Close all tabs" button; cross-link from the "Run more than one HyppoVisor" section
- [x] T019 [P] Set `specs/014-instance-management/spec.md` **Status** to `Implemented (<date>)` with a one-line clarifications note, matching the 012 / 013 convention
- [x] T020 Run `npm run lint`, `npm test`, `npm run test:e2e -- instance-management`, `npm run test:e2e -- close-all-tabs`; fix any failure
- [x] T021 Walk `specs/014-instance-management/quickstart.md` §1–§4 against 3 real instances (one `--background`), including the SC-001 (< 3 s) and SC-003 (< 10 s) timings and the SC-005 cross-instance drop — covered by `tests/integration/instance-management.spec.ts` (SC-001 poll ≤ 3 s, SC-003 poll ≤ 10 s, SC-005 poll ≤ 5 s) and `close-all-tabs.spec.ts` (§4), all green

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies — start immediately. T001 / T002 / T003 all `[P]` (different files).
- **Foundational (Phase 2)**: T004 depends on nothing in code; it is the governance gate for Phase 3. Phase 4 does not depend on it.
- **US1 (Phase 3)**: needs Phase 1 + T004. Internal order: T005/T006 (tests, `[P]`) → T007 (`[P]` with tests) → T008 & T009 (both need T007; different functions same file → sequential) → T010 (needs T007) → T011 (needs T008/T009/T010) → T012 (needs T003/T011) → T013 (needs T012).
- **US2 (Phase 4)**: needs Phase 1 (T003) only. Internal order: T014 (test, `[P]`) → T015 (`[P]` with T014) → T016 (needs T015) → T017 (needs T003/T016).
- **Polish (Phase 5)**: after the stories you intend to ship. T020/T021 last.

### Story independence

- **US1** and **US2** touch three common files — `src/preload/chrome.cjs` (done once in T003), `src/main/index.ts` (T010/T011 vs T016 — sequential, no overlap in regions), `src/renderer/panel.ts` + `src/renderer/index.html` (T012/T013 vs T017 — sequential). No logic dependency either way; either story can ship first. US2 is the smaller, amendment-free slice.

### Parallel opportunities

- Phase 1: T001, T002, T003 together.
- US1 kickoff: T005, T006, T007 together.
- US2 kickoff: T014, T015 together.
- Across stories (if two people): one takes T005→T013, the other T014→T017, syncing on `index.ts` / `panel.ts` / `index.html` edits.
- Polish: T018, T019 together.

---

## Parallel Example: User Story 1 kickoff

```bash
Task: "Unit spec tests/unit/instances-registry.test.ts (T005)"
Task: "Integration spec tests/integration/instance-management.spec.ts (T006)"
Task: "Create src/main/instances/registry.ts file-level helpers (T007)"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 (T001–T003) → Phase 2 (T004) → Phase 3 (T005–T013).
2. **STOP and VALIDATE**: quickstart.md §1–§3, `npm run test:e2e -- instance-management`.
3. Ship.

### Amendment-free quick win (User Story 2 first)

If the Principle III amendment discussion needs time: do Phase 1 (T003 suffices) then Phase
4 (T014–T017) and ship "Close all tabs" on its own — it carries no governance dependency.

### Incremental delivery

Setup → US1 (MVP) → US2 → Polish. Each story is independently testable and adds value
without breaking the other.

---

## Notes

- `[P]` = different files, no incomplete dependency.
- The renderer never imports `src/main/config.ts`; the 2 s poll interval is a literal in
  `panel.ts` with a comment tying it to `config.instancePollMs` (T012).
- Windows: `process.kill(pid, "SIGTERM")` is an immediate terminate (no graceful hook); the
  SIGKILL escalation is then a redundant no-op. macOS/Linux get true graceful-then-forced
  (contracts/instance-shutdown.md) — the integration spec should not assert a graceful
  window on Windows CI.
- Commit after each task or logical group; keep US1 commits behind T004.
