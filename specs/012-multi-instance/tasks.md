---
description: "Task list for feature 012 — Run More Than One HyppoVisor on One Machine"
---

# Tasks: Run More Than One HyppoVisor on One Machine

**Input**: Design documents from `specs/012-multi-instance/`
**Prerequisites**: plan.md, spec.md, research.md (R1–R11), data-model.md, contracts/instance-launch.md, contracts/connection-state-delta.md, quickstart.md

**Tests**: Included. The spec gives an "Independent Test" per story and plan.md names the unit
file (`tests/unit/instance.test.ts`) and integration spec (`tests/integration/multi-instance.spec.ts`)
explicitly, so test tasks are first-class here.

**Organization**: Tasks are grouped by user story (US1–US5). Every edit is to a file the
feature already touches conceptually; the one new source file is `src/main/instance.ts`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 for user-story phases; no label for Setup / Foundational / Polish

## Path Conventions

Single project, existing layout: `src/main/**`, `src/shared/**`, `src/renderer/**`,
`tests/**`, `docs/**`, `.specify/memory/**`. All paths below are repo-root-relative.

> **`src/main/index.ts` is edited by US1, US2, US3, and US4** (different regions of `main()`
> and the IPC handlers). Those edits are sequential — do the phases in order; none are `[P]`
> with each other.

---

## Phase 1: Setup

**Purpose**: Governance gate and a known-green baseline before touching code.

- [ ] T001 Bump the constitution `1.4.0 → 1.4.1` in `.specify/memory/constitution.md`: add the Principle III sentence permitting N single-window instances (each its own `instances/<name>/` profile dir, no shared state, no registry), add the `1.4.1` Amendment History entry, and update the footer to `**Version**: 1.4.1 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-09-01` — verbatim text in research.md R8. No Sync Impact Report block (per repo convention).
- [ ] T002 Confirm the baseline is green from repo root: `npm test && npm run build && npm run lint`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure module, the shared type additions, and the e2e-helper isolation that
every user story builds on.

**⚠️ CRITICAL**: No user-story phase can start until T003–T005 are done.

- [ ] T003 [P] Create `src/main/instance.ts` — pure, no Electron import. Export: `ResolvedInstance` interface (data-model.md §1), `INSTANCE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/`, `validateInstanceName(raw)`, `deriveLabel(raw)` (lowercase; non-`[a-z0-9_-]` runs → `-`; trim `-`; clamp 32), `serverNameFor(label)` (`label ? \`hyppovisor-${label}\` : "hyppovisor"`), `collisionMessage(r)` (`{title, body}` naming the profile + the `--instance`/`--port` fix), `classifyListenError(err)` (`EADDRINUSE` code or `/EADDRINUSE|in use/i` → `"port-unavailable"`, else `"error"`), and `resolveInstance(argv, env, baseUserDataDir)` — hand-rolled `--instance`/`--port` scan (`=` and space forms), precedence per contracts/instance-launch.md, returns `ResolvedInstance` or a distinguished `{ error: "invalid-instance-name" | "invalid-port", reason }`.
- [ ] T004 [P] Extend `src/shared/types.ts` per contracts/connection-state-delta.md: add `"cli"` to `ConnectionSource`; add to `EffectiveConnection` the fields `serverStatus: "listening" | "port-unavailable" | "error" | "stdio"`, `instanceLabel: string`, `serverName: string`.
- [ ] T005 [P] Isolate the e2e suite from the new lock (research.md R11) in `tests/integration/helpers.ts`: give `launchApp` its own `mkdtemp` `HYPPO_USER_DATA_DIR`, cleaned up in the returned close path; add an optional `extraArgs: string[]` param to `launchAppFull`, appended after `mainEntry`.

**Checkpoint**: `npm test` still green (new file has no callers yet); user stories can begin.

---

## Phase 3: User Story 1 - Launch a named instance on a chosen port (Priority: P1) 🎯 MVP

**Goal**: `--instance <name> --port <n>` opens one window, binds that port, uses a
`<userData>/instances/<name>/` profile; two such instances run side by side with no shared
tabs/settings/log and neither call delayed by the other.

**Independent Test**: Launch two instances with distinct `--instance` names and `--port`
values → two windows, two bound ports, two profile dirs. Drive a fill in one and reads in
the other concurrently → both complete; each `interaction-log.jsonl` holds only its own
entries.

### Tests for User Story 1

- [ ] T006 [P] [US1] `tests/unit/instance.test.ts` (new): `resolveInstance` precedence matrix (`HYPPO_USER_DATA_DIR` dir > `--instance` > default; `userDataDir === join(base, "instances", name)` for a named instance; label fallback chain name → `deriveLabel(basename(env dir))` → `""`); `validateInstanceName` accept/reject (path separators, `..`, uppercase, leading `-`, empty, 33 chars); `deriveLabel` sanitising; non-numeric / out-of-range `--port` → `{ error: "invalid-port" }`; invalid `--instance` → `{ error: "invalid-instance-name" }`.
- [ ] T007 [P] [US1] `tests/integration/multi-instance.spec.ts` (new) — US1 case: launch two apps via `launchAppFull` each with its own `HYPPO_USER_DATA_DIR` **and** `extraArgs: ["--instance", "<n>", "--port", "<p>"]`; assert both ports answer an `initialize` ping, each `settings.json` is under its own dir, and a write driven in one instance never appears in the other's `interaction-log.jsonl`. Offline (loopback / fixture server only).

### Implementation for User Story 1

- [ ] T008 [US1] `src/main/index.ts` — first statement of `main()`: `const resolved = resolveInstance(process.argv, process.env, app.getPath("userData"))`, subsuming the existing `HYPPO_USER_DATA_DIR` `setPath` block (lines ~56–58). If `resolved.error` → `dialog.showErrorBox(...)` + `app.exit(1)` before any side effect. If `resolved.userDataDir` → `mkdirSync(resolved.userDataDir, { recursive: true })` then `app.setPath("userData", resolved.userDataDir)`.
- [ ] T009 [US1] `src/main/settings.ts` — `resolveEffective(settings, env, existed, cliPort?: number)`: effective port = `env.port ?? cliPort ?? settings.port`; `portSource` = `env.port !== undefined ? "env" : cliPort !== undefined ? "cli" : existed ? "persisted" : "default"`; extend `sourceFor` / the `ConnectionSource` usage for `"cli"` per contracts/connection-state-delta.md.
- [ ] T010 [US1] `src/main/index.ts` — pass `resolved.cliPort` into the effective-port resolution (`currentEffective()` → `resolveEffective(curSettings, env, existed, resolved.cliPort)`) and into the `startHttpMcpServer({ port, ... })` call, so the panel reflects `portSource: "cli"`.

**Checkpoint**: two instances launch, bind their ports, stay isolated. MVP is testable.

---

## Phase 4: User Story 2 - Loud guard when two instances would share a profile (Priority: P2)

**Goal**: A second launch against a profile another live instance holds shows a plain dialog
with the fix and exits without opening a window; the running window is raised. Distinct
profile dirs both start with no dialog; a stale lock is not a collision.

**Independent Test**: With the default instance running, launch a second default instance →
a readable dialog appears, the second process exits with no window, the first window is
raised.

### Tests for User Story 2

- [ ] T011 [P] [US2] `tests/unit/instance.test.ts` — `collisionMessage(resolved)`: for a named instance names its label; for the default names "the default profile"; body states the `--instance <name>` + different `--port` remedy.
- [ ] T012 [P] [US2] `tests/integration/multi-instance.spec.ts` — US2 case: `launchAppFull` into dir `D`; then `_electron.launch({ args: [mainEntry], env: { ...HYPPO_USER_DATA_DIR: D } })`; assert the second app exposes no `BrowserWindow` within a short poll and its process exits on its own. (Dialog text is asserted in T011.)

### Implementation for User Story 2

- [ ] T013 [US2] `src/main/index.ts` — immediately after the `setPath` in T008: `if (!app.requestSingleInstanceLock()) { const { title, body } = collisionMessage(resolved); dialog.showErrorBox(title, body); app.exit(0); return; }`. On the `true` branch register `app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } })` (FR-008).

**Checkpoint**: US1 still passes; same-profile double launch is loud, distinct profiles unaffected.

---

## Phase 5: User Story 3 - Loud state when the port is already in use (Priority: P2)

**Goal**: A failed HTTP bind becomes a first-class `serverStatus` the panel renders as a
named "port in use" error with the remedy; the browser stays fully usable; no auto-pick;
changing the port in the panel binds and clears the state with no restart.

**Independent Test**: Occupy a port, launch an instance configured for it, open the panel →
named "port in use" error with remedy; browser still works; process did not bind another
port. Set a free port in the panel → binds, error clears.

### Tests for User Story 3

- [ ] T014 [P] [US3] `tests/unit/instance.test.ts` — `classifyListenError`: `{ code: "EADDRINUSE" }` → `"port-unavailable"`; message matching `/EADDRINUSE|in use/i` → `"port-unavailable"`; anything else → `"error"`.
- [ ] T015 [P] [US3] `tests/integration/multi-instance.spec.ts` — US3 case: occupy a port with `net.createServer().listen(p, "127.0.0.1")`; `launchAppFull({ HYPPO_MCP_PORT: String(p) })`; `page.evaluate` `hyppo.getConnection()` → `serverStatus === "port-unavailable"`; assert a browser IPC call (e.g. open a fixture URL) still works while unbound; free the port; `hyppo.setPort(free)` → `serverStatus === "listening"` and `mcpPost(free, ping)` ok.

### Implementation for User Story 3

- [ ] T016 [US3] `src/main/index.ts` — introduce a `serverStatus` starting `"listening"` (or `"stdio"` when stdio). In the existing `startHttpMcpServer` try/catch (lines ~231–245) set `serverStatus = classifyListenError(err)` and leave `httpHandle` undefined instead of only `console.error`. `currentEffective()` includes `serverStatus`.
- [ ] T017 [US3] `src/main/index.ts` `chrome:set-port` (lines ~151–173) — recovery path per contracts/connection-state-delta.md: when `transport === "http"` && `portSource !== "env"` && `!httpHandle`, call `startHttpMcpServer` afresh on the requested port; on success set `httpHandle`, `saveSettings` when the port differs from env/default, `pushConnection()` with `serverStatus: "listening"`; on bind failure return `{ ok: false, error }` and leave `serverStatus` unchanged. The existing `rebind` path (handle present) is unchanged.
- [ ] T018 [P] [US3] `src/renderer/panel.ts` — add `"cli"` to the local `ConnectionSource`; in `renderHttp(c)` prepend a `.panel-error` div when `c.serverStatus === "port-unavailable"` (*"Port {c.port} is in use — another HyppoVisor instance? Change the port below and Apply, or relaunch with a different --port."*) or `"error"` (*"The MCP server could not start."*). Endpoint + snippet blocks still render.
- [ ] T019 [P] [US3] `src/renderer/index.html` — add `.panel-error { color: crimson; font-weight: 600; margin: 8px 0; }` to the panel styles.

**Checkpoint**: US1–US2 still pass; an in-use port is visible and recoverable in-panel.

---

## Phase 6: User Story 4 - Tell instances apart (Priority: P3)

**Goal**: The one derived `label` drives the window title (`HyppoVisor — work`, guarded
against the renderer `<title>`), the panel header, the MCP `serverInfo.name`
(`hyppovisor-work`), and the panel's copy snippets. The plain default is byte-identical to
today.

**Independent Test**: Open two named instances → each title and panel header carry the
label, the handshake server name carries the label, the two panels' snippets use two
different server names. Default instance → bare `HyppoVisor` / `hyppovisor`.

### Tests for User Story 4

- [ ] T020 [P] [US4] Unit: `serverNameFor` cases in `tests/unit/instance.test.ts` (`"work"` → `"hyppovisor-work"`, `""` → `"hyppovisor"`); `serverName` threading in `tests/unit/connection-snippets.test.ts` — `mcpAddCommand` / `mcpJsonConfig` / `stdioJsonConfig` emit the passed `serverName`; omitting it keeps `"hyppovisor"` (existing cases stay green).
- [ ] T021 [P] [US4] `tests/integration/multi-instance.spec.ts` — US4 case: two named instances; window titles differ via `app.evaluate(() => BrowserWindow.getAllWindows()[0].getTitle())`; `initialize` `serverInfo.name` is `hyppovisor-<name>` for each; panel snippet server names differ. Separately assert a no-flag `launchAppFull` yields title `HyppoVisor` and snippet name `hyppovisor` (SC-007).

### Implementation for User Story 4

- [ ] T022 [US4] `src/main/mcp/server.ts` — `makeServer(deps, serverName = "hyppovisor")` → `new McpServer({ name: serverName, version: "0.1.0" })`; `startHttpMcpServer(deps, opts)` and `startStdioMcpServer(deps, opts)` accept `opts.serverName?: string` and pass it into the per-request `makeServer` closure. Default keeps the handshake identical for the default instance.
- [ ] T023 [US4] `src/main/index.ts` — `const title = resolved.label ? \`HyppoVisor — ${resolved.label}\` : "HyppoVisor"`; create the `BrowserWindow({ title, ... })` with it and add `win.webContents.on("page-title-updated", (e) => { e.preventDefault(); win.setTitle(title); })`. Compute `const serverName = serverNameFor(resolved.label)`, pass it to `startHttpMcpServer` / `startStdioMcpServer`, and have `currentEffective()` set `instanceLabel: resolved.label` and `serverName`.
- [ ] T024 [P] [US4] `src/renderer/snippets.ts` — `SnippetState` gains `serverName?: string` (default `"hyppovisor"`); `stdioJsonConfig(launch, serverName = "hyppovisor")`; `mcpAddCommand` / `mcpJsonConfig` / `stdioJsonConfig` emit `serverName` as the `claude mcp add` name / `mcpServers` key.
- [ ] T025 [US4] `src/renderer/panel.ts` — in `open()` / `render(c)` set `#panel-instance` text to `c.instanceLabel` (empty → blank); pass `serverName: c.serverName` to the snippet builders; in `renderPortSection(c)` treat `c.portSource === "cli"` as editable-with-notice (*"Launched with --port {c.port}."*) — only `"env"` disables the field.
- [ ] T026 [P] [US4] `src/renderer/index.html` — add `<span id="panel-instance"></span>` after the `<h2>` inside `#panel-head`.

**Checkpoint**: all four behaviour stories independently testable; default instance unchanged.

---

## Phase 7: User Story 5 - Documentation for running more than one (Priority: P3)

**Goal**: A person gets a second instance running from the docs alone, without opening
source.

**Independent Test**: Follow the new docs section from a clean state → a second instance
running on its own port within a few minutes.

- [ ] T027 [P] [US5] `docs/configuration.md` — reframe `HYPPO_USER_DATA_DIR` from "test isolation" to a general **override**; state the FR-006 precedence (environment override → `--instance` / `--port` → per-instance persisted `settings.json` → built-in default); add a **"Run more than one HyppoVisor"** section with the research.md R10 recipes (`npx electron . --instance work --port 7358`; `open -na HyppoVisor --args --instance work --port 7358`; the stdio `claude mcp add hyppovisor-work … --instance work` form) and an explicit "two instances must never share a profile directory" warning.
- [ ] T028 [P] [US5] `docs/connect-an-agent.md` — reflect the per-instance `hyppovisor-<name>` MCP server name in the `claude mcp add` and JSON examples (the default stays `hyppovisor`).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T029 Walk `specs/012-multi-instance/quickstart.md` flows 1–5 by hand; record any behaviour gap as a fix task.
- [ ] T030 Full gate from repo root, all green and offline: `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`.
- [ ] T031 [P] Update `specs/012-multi-instance/spec.md` Status to reflect implementation and re-tick `specs/012-multi-instance/checklists/requirements.md` where the spec now satisfies an item.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T002)**: no dependencies.
- **Foundational (T003–T005)**: after Setup. **Blocks all user stories.**
- **US1 (P1)**: after Foundational. No dependency on other stories.
- **US2 (P2)**: after Foundational. Adds one block to `main()` after US1's `setPath` (T008) — so do US1 first; otherwise independent.
- **US3 (P2)**: after Foundational. Uses `classifyListenError` (T003) and `portSource` (`"cli"` from T009); the panel error block is independent of US4.
- **US4 (P3)**: after Foundational. Uses `serverNameFor` (T003), `instanceLabel` / `serverName` (T004). `resolved.label` comes from T003; wiring lands in `main()` alongside the earlier `index.ts` edits.
- **US5 (P3)**: after the behaviour it documents is settled (US1–US4).
- **Polish (T029–T031)**: after all desired stories.

### Within-file ordering

- `src/main/index.ts`: T008 → T010 → T013 → T016 → T017 → T023 (phase order).
- `src/renderer/panel.ts`: T018 (US3) → T025 (US4).
- `src/renderer/snippets.ts` (T024) before `panel.ts` T025's builder calls compile.

### Parallel opportunities

- **Foundational**: T003, T004, T005 are three different files → run together.
- **Per story**, the test tasks and the renderer/docs tasks marked `[P]` are different files from the `main`-process edits:
  - US1: T006, T007 together (then T008–T010).
  - US2: T011, T012 together (then T013).
  - US3: T014, T015, T018, T019 together (then T016, T017).
  - US4: T020, T021, T024, T026 together (then T022, T023, T025).
  - US5: T027, T028 together.

---

## Parallel Example: User Story 3

```bash
# tests + renderer, in parallel (different files):
Task: "T014 classifyListenError unit cases in tests/unit/instance.test.ts"
Task: "T015 US3 port-unavailable → recover in tests/integration/multi-instance.spec.ts"
Task: "T018 .panel-error block in src/renderer/panel.ts"
Task: "T019 .panel-error style in src/renderer/index.html"
# then, sequential (same file, src/main/index.ts):
Task: "T016 serverStatus capture on bind failure"
Task: "T017 chrome:set-port restarts a never-bound server"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational.
2. Phase 3 US1: `--instance` / `--port`, profile dir, port precedence.
3. **Stop and validate**: two instances side by side, isolated, both ports live. This is the
   feature's whole point (spec: "Without it there is nothing").

### Incremental delivery

US1 (MVP) → US2 (profile guard) → US3 (port-in-use state) → US4 (identity) → US5 (docs).
Each phase leaves `npm test` + `npm run test:e2e` green and adds value without breaking the
prior stories. The default no-flag instance stays byte-identical throughout (SC-007) — a
standing check at every checkpoint.

---

## Notes

- `[P]` = different files, no incomplete dependency.
- Tests are written to fail first, then the implementation task makes them pass.
- `specs/issues/` and `.specify/feature.json` are gitignored — never staged.
- Commit after each phase (or logical group) with the mandatory `Co-Authored-By` /
  `Claude-Session` trailers; commit as `juliaviluhina`.
- No `.specify/extensions.yml` in this repo → no tasks hooks; nothing to dispatch.
