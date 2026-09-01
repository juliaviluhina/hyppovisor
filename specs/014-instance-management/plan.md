# Implementation Plan: Local Instance Management Panel

**Branch**: `014-instance-management` (feature dir `specs/014-instance-management`) |
**Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-instance-management/spec.md`

## Summary

Two independent slices on the existing single window:

1. **Instances section** in the connection panel — lists every HyppoVisor instance this
   user is running on this machine (label, MCP port, foreground/background mode,
   responding state), marks the current one, and shuts down any *other* one after an
   in-panel confirmation. Discovery is by a tiny per-instance runtime file each process
   writes into its **own** profile directory (`<profile>/runtime.json` = `{ pid, port,
   mode, label, startedAt }`) and removes on quit; the panel enumerates sibling profile
   directories under the app-support `instances/` root, drops entries whose PID is dead,
   and probes each live port. Shutdown is `process.kill(pid, "SIGTERM")` → (bounded wait) →
   `SIGKILL`; the target's existing `SIGTERM → app.quit()` handler (feature 013) does the
   graceful part, and an in-flight MCP call against it drops with a clean transport error.
   No daemon, no shared registry, no shared-data-dir writes.

2. **Close all tabs** button in the same panel — one `TabManager.closeAll()` that tears
   down every content tab and returns the window to the freshly-launched zero-tab state;
   the MCP server, `settings.json`, and logged-in browser sessions are untouched.

Plus a **MINOR constitution amendment** (1.4.2 → 1.5.0) to Principle III permitting a
bounded local instance-management surface (FR-014), and a `docs/configuration.md` update.

No new MCP tool, no browser-interaction primitive, no external act on any website, no
persisted business/page state, no network beyond the existing loopback.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (ESM in `src/main`; `src/renderer` compiled
in isolation via `tsconfig.renderer.json`), Electron 33.

**Primary Dependencies**: Electron — `app.getPath("userData")` (captured pre-override for
the app-support root), `ipcMain.handle`, `app.on("before-quit")`, `dialog` (not used —
confirmation is an in-panel modal, testable). Node built-ins — `node:fs` (`readdirSync`,
`readFileSync`, atomic temp-write + `renameSync`, `unlinkSync`), `node:net` (loopback
`connect` probe), `process.kill(pid, 0 | "SIGTERM" | "SIGKILL")`, `process.pid`. **No new
runtime dependency.**

**Storage**: One new per-instance file `<profile>/runtime.json` — transient runtime
coordinates only (`pid`, `port`, `mode`, `label`, `startedAt`, `schema`). Written after the
MCP server binds, rewritten on a panel port-rebind, removed on `before-quit`, reclaimed
opportunistically when a scan finds its PID dead. It lives beside the existing
`settings.json` / `recent-urls.json` / `interaction-log.jsonl` in the same profile
directory — **not** in the shared data directory, and it is not a cross-instance registry
(each process owns exactly its own file).

**Testing**:
- `vitest` unit — `src/main/instances/registry.ts`: runtime-file parse / schema-guard /
  malformed-file tolerance; the enumerate-and-filter logic against a fake profile tree
  (live PID vs. dead PID vs. absent file vs. junk file); the SIGTERM→SIGKILL escalation
  timing with `vi.useFakeTimers()` and a stubbed `process.kill`.
- `@playwright/test` `_electron` integration:
  - new `tests/integration/instance-management.spec.ts` — US1: launch 3 real instances via
    `launchAppFull` (one `--background`), open the panel in one, assert all 3 rows with
    correct label / port / mode / `isCurrent`; close a non-current one → its process exits
    (`app.close`/exit observed) and its MCP port stops answering `mcpPost` within 10 s and
    its row disappears; assert the current instance's row exposes no working close
    (SC-004); US1 edge: a killed-outside instance's row drops on the next poll.
  - new `tests/integration/close-all-tabs.spec.ts` — US2: open several tabs
    (`window.hyppo.openUrl`), invoke close-all-tabs, assert `list_open_tabs` (MCP) and
    `window.hyppo.listTabs()` both return `[]`, the same instance still answers MCP
    `initialize`, and `settings.json` is byte-unchanged.
  - `tests/integration/helpers.ts` — no change needed (the feature is driven through
    `window.hyppo` on the real-app `launchAppFull` harness, like the feature-012 spec).

**Target Platform**: Electron desktop — macOS primary (POSIX signals native), Windows/Linux
build. On Windows `process.kill(pid, "SIGTERM")` maps to `TerminateProcess`; the
graceful-then-forced path still resolves via the SIGKILL escalation (documented in
`contracts/instance-shutdown.md`).

**Project Type**: Single project — existing `src/main/**` + `src/renderer/**` + `tests/**`.

**Performance Goals**: Panel open → full list ≤ 3 s (SC-001) with N ≲ 10 instances: one
`readdirSync` + N small `readFileSync` + N parallel loopback `connect` probes at a ~400 ms
timeout. Poll cadence while the panel is open: 2 s (satisfies SC-005's 5 s and FR-007's
"within a few seconds"). Shutdown: SIGTERM, then SIGKILL after a 5 s grace window
(configurable) — well inside SC-003's 10 s.

**Constraints**: Loopback only — the port probe `connect`s to `127.0.0.1:<port>` and never
a routable address (FR-008). Discovery is confined to profile directories under the
app-support `instances/` root plus the default profile; an instance launched with a
`HYPPO_USER_DATA_DIR` outside that tree (test/CI wrappers) is not enumerable — the panel
still lists the current instance and shows a "can't list other instances" note if the scan
yields nothing (FR-010). The action queue (Principle V) is untouched. The default instance
(no `--instance`, no env) still starts byte-identically, now also writing its
`runtime.json`.

**Scale/Scope**: ~1 new source file (`src/main/instances/registry.ts`, ~150 lines); ~3
IPC handlers + ~15 lines of lifecycle wiring in `index.ts`; one `closeAll()` on
`TabManager`; ~90 lines of renderer (two panel sections + a confirm modal + a poll timer)
in `panel.ts` and a little CSS; 3 shared types; 2 new integration specs + 1 unit spec;
`docs/configuration.md`; a MINOR constitution amendment.

**Unknowns**: none blocking — resolved in `research.md` (R1 discovery mechanism, R2
shutdown signalling & escalation, R3 "responding" probe, R4 confirmation surface, R5
close-all-tabs end state, R6 amendment scope/level).

## Constitution Check

*GATE: evaluated pre-Phase 0, re-checked after Phase 1 design — PASS with one bundled
MINOR amendment.*

### I. Human Does Every External Act (NON-NEGOTIABLE) — PASS

No website is touched. No page read, navigation, or interaction primitive is added; no MCP
tool is added. Shutting down a sibling process the same user launched is local process
management (the same category as Ctrl-C / Cmd-Q, already in the app), not an outward act on
any site. Close-all-tabs only tears down local `WebContentsView`s. No submit, no send, no
auth, no Enter key anywhere.

### II. Zero Business Logic in HyppoVisor — PASS

The panel lists processes and kills one on request; the button closes tabs. No scoring,
ranking, tiering, filtering, or judgement about a job, a fact, or a connection. No
orchestrator concept. `runtime.json` holds only mechanical facts (pid/port/mode/label).

### III. Solid and Comprehensible — PASS **with a bundled MINOR amendment**

- **One window per instance.** Unchanged. The panel is a section of the existing
  connection-panel overlay in the one window — no second window, no tray, no background
  service. Each process still has one entry point.
- **State.** One new file, `<profile>/runtime.json`, of the same kind and location as the
  existing per-profile `settings.json` / `recent-urls.json` — not in the shared data
  directory, not Markdown/CSV pipeline state. It is transient (removed on quit, reclaimed
  when stale) and per-process (each instance writes only its own). It is **not** a
  "cross-instance registry or shared index": nothing aggregates or coordinates; the panel
  reads N independent files at display time.
- **Smallest mechanism.** Enumerate sibling profile dirs + `process.kill` + a loopback
  `connect` probe — versus a broker process, a lock-file protocol, a shared SQLite, or an
  mDNS/UDP beacon. No new IPC channel *kind* (three more `ipcMain.handle` invoke routes on
  the existing `hyppo` bridge).
- **Amendment.** Principle III's "there is no cross-instance registry or shared index" and
  "not a multi-window app" were written to forbid coordination machinery, not a read-only
  list + a kill button. Bundle a MINOR bump (1.4.2 → 1.5.0): Principle III gains a clause
  permitting a **bounded local instance-management surface** — one instance may enumerate
  and shut down other instances of the same user on the same machine, via per-instance
  transient runtime files (no daemon, no shared store, nothing in the data directory) —
  and Amendment History gains a 1.5.0 entry. Tracked in Complexity Tracking. MINOR (not
  PATCH like 1.4.2) because it blesses a genuinely new capability kind and a new UI
  surface, materially expanding the principle rather than clarifying one sentence.

### IV. User-Held Credentials and Sessions — PASS

No password is captured, stored, typed, or transmitted. Shutting down an instance drops
its in-memory authenticated browser sessions (they were never serialized); close-all-tabs
drops the tab's live session state only. `runtime.json` carries no token and no
credential. The loopback MCP bearer token is not read or written by this feature.

### V. Assistive Pace, Not Bulk Collection — PASS

The app-wide action queue is not modified. No page is fetched or crawled. The port probe is
a bare TCP `connect` (no HTTP request, no MCP call) to a loopback port the user's own
instance opened. Close-all-tabs and shutdown are person-initiated UI actions, not automated
traversal.

## Project Structure

### Documentation (this feature)

```text
specs/014-instance-management/
├── plan.md              # This file
├── research.md          # Phase 0 — R1–R6 decisions
├── data-model.md        # Phase 1 — InstanceRuntime, InstanceSummary, TabManager.closeAll, IPC delta
├── quickstart.md        # Phase 1 — run N instances, list them, close one, close all tabs; validate US1–US2 / SC-001–SC-006
├── contracts/
│   ├── instance-registry.md    # <profile>/runtime.json schema; enumerate + staleness + probe rules; chrome:list-instances
│   ├── instance-shutdown.md     # chrome:close-instance: confirm → SIGTERM → grace → SIGKILL; current-instance guard; in-flight MCP failure
│   └── close-all-tabs.md        # chrome:close-all-tabs / TabManager.closeAll; end state; no-op when empty
├── checklists/requirements.md   # from /speckit-specify + /speckit-clarify (16/16)
└── tasks.md             # /speckit-tasks output — NOT created here
```

### Source Code (repository root)

```text
src/main/
├── instances/
│   └── registry.ts       # NEW — writeRuntimeFile / clearRuntimeFile / rewriteRuntimePort;
│                          #       listInstances(appSupportRoot, self) → InstanceSummary[]
│                          #       (readdir instances/*, parse runtime.json, drop dead PIDs,
│                          #       probe ports, merge authoritative self); closeInstance(pid,
│                          #       { graceMs }) → SIGTERM, poll liveness, SIGKILL on timeout
├── index.ts              # EDIT — capture appSupportRoot = app.getPath("userData") BEFORE
│                          #        setPath; after the MCP server binds: writeRuntimeFile({
│                          #        pid: process.pid, port: effectivePort, mode, label });
│                          #        on before-quit: clearRuntimeFile(); in chrome:set-port
│                          #        success: rewriteRuntimePort(newPort); new IPC handlers
│                          #        chrome:list-instances, chrome:close-instance,
│                          #        chrome:close-all-tabs
├── tabs/tab-manager.ts   # EDIT — closeAll(): remove + webContents.close() every tab, clear
│                          #        the map, activeId = null, layout(), one onChange()
└── config.ts             # EDIT — instanceShutdownGraceMs (default 5000, env-overridable);
                           #        instanceProbeTimeoutMs (default 400); instancePollMs (2000)

src/preload/chrome.cjs    # EDIT — expose listInstances(), closeInstance(pid),
                           #        closeAllTabs() on window.hyppo

src/renderer/
├── panel.ts              # EDIT — renderInstances(): section with one row per InstanceSummary
│                          #        (label · port · mode · state), current row tagged and its
│                          #        close disabled with a hint; other rows' Close opens an
│                          #        in-panel confirm modal naming label + port → closeInstance;
│                          #        poll listInstances() every instancePollMs while panel open.
│                          #        renderTabsSection(): "Close all tabs" button, disabled when
│                          #        tab count is 0. Retitle panel <h2> to "HyppoVisor".
└── index.html            # EDIT — CSS for .inst-row / .inst-current / .inst-confirm modal;
                           #        <h2> text "HyppoVisor"

src/shared/types.ts       # EDIT — InstanceMode, InstanceRuntime (the file), InstanceSummary (IPC)

tests/
├── unit/instances-registry.test.ts        # NEW — parse/staleness/enumerate/escalation
├── integration/instance-management.spec.ts # NEW — US1 + edge cases + SC-001/003/004/005
└── integration/close-all-tabs.spec.ts      # NEW — US2 + SC-006

docs/configuration.md     # EDIT — "Manage running instances" subsection: the panel list,
                           #        closing another instance, the runtime.json mechanism +
                           #        its limits (env-dir instances), Close all tabs

.specify/memory/constitution.md  # EDIT — MINOR 1.4.2 → 1.5.0 (Principle III clause +
                                 #        Amendment History entry)
```

**Structure Decision**: Existing single-project layout. One new folder `src/main/instances/`
for the registry module (mirrors `src/main/tabs/`, `src/main/page/`, `src/main/queue/`).
Everything else is edits to existing files. The instance list and the Close-all-tabs button
are new **sections of the existing connection panel** (like feature 009's "Recent URLs"
section) rather than a new overlay or new top-bar chrome — smallest surface, reuses the
panel's open/close, overlay-hiding, and live-push plumbing.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| MINOR constitution amendment (1.4.2 → 1.5.0), Principle III | Principle III bars a "cross-instance registry or shared index" and calls the system "not a multi-window app". A panel that lists sibling instances and shuts one down is squarely that principle's subject; without a clause the review gate cannot pass it. The amendment scopes it: bounded, local, same-user, transient per-instance files, no daemon, nothing in the data dir. | Not amending — rejected: leaves a squarely-Principle-III change to reviewer improvisation, the same reason 013 took a scoped bump. Doing it as PATCH — rejected: this adds a new capability kind (one instance terminating another) and a new UI surface, which is a material expansion, not a wording fix. |
| New file `<profile>/runtime.json` | The panel needs each instance's live `pid` + bound `port` + `mode`. `settings.json` only holds the *persisted* port; a `--port` / `HYPPO_MCP_PORT` instance has no persisted port, and PID is nowhere on disk. Electron's internal `SingletonLock` encodes a PID but is undocumented, platform-specific, and carries no port/mode. | Probing a fixed port range — rejected: instances bind arbitrary ports; slow and unreliable. Parsing `SingletonLock` — rejected: fragile dependency on Chromium internals, no port/mode. A shared registry file all instances append to — rejected: that *is* the "shared index" Principle III forbids and needs concurrent-write coordination. |
| `process.kill` across instances | FR-004/FR-006: shut down another instance from the panel, gracefully then forced. The target already turns `SIGTERM` into a clean `app.quit()` (feature 013 FR-011). | An MCP "shutdown" tool — rejected: adds an external-control tool surface, needs the bearer token, and is a bigger Principle I/II conversation than a local signal. A file-drop "please quit" flag the target polls — rejected: needs a new watcher loop in every instance for no gain over a signal. |
