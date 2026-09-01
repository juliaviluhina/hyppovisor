# Implementation Plan: Run More Than One HyppoVisor on One Machine

**Branch**: `012-multi-instance` (feature dir `specs/012-multi-instance`) |
**Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-multi-instance/spec.md`

## Summary

Make the existing "second process" stopgap a supported, loud workflow. One new pure module,
`src/main/instance.ts`, resolves an **instance** at launch from `process.argv`
(`--instance <name>`, `--port <n>`) and the environment (`HYPPO_USER_DATA_DIR` etc. still
win), yielding a profile directory, a display label, an MCP server name, and an optional
CLI port. `src/main/index.ts` calls it *before* `app.whenReady()`, points `userData` at
`<userData>/instances/<name>/` for a named instance, and then does three things it does not
do today:

1. **`app.requestSingleInstanceLock()`** — keyed on the resolved `userData` dir. A second
   process against the *same* profile gets `false` → `dialog.showErrorBox` naming the fix
   (`--instance <name>`) → exit, no window (FR-007). The primary handles `second-instance`
   by raising its window (FR-008). Distinct profiles each hold their own lock (FR-009); a
   dead holder's lock is reclaimed automatically (FR-010).
2. **A bind-failure status.** The `startHttpMcpServer` call is already wrapped in
   `try/catch`; the catch now classifies the error (`EADDRINUSE` → `port-unavailable`,
   else `error`) into a `serverStatus` the panel renders as a real error with the remedy
   (FR-011/FR-012), and `chrome:set-port` can (re)start a server that never bound, clearing
   the state without a restart (FR-015). No auto-pick (FR-013).
3. **Instance identity.** The label flows to the window title
   (`HyppoVisor — work`, via a `page-title-updated` guard so the renderer `<title>` can't
   override it), a new `#panel-instance` header line, the MCP `initialize`
   `serverInfo.name` (`hyppovisor-work`), and the panel's copy snippets (same
   `hyppovisor-work` as the `claude mcp add` server name).

Plus a PATCH constitution amendment (1.4.0 → 1.4.1) recording that N single-window
instances, each its own profile dir under the app-support root and sharing no state, are
permitted; and doc edits to `docs/configuration.md` / `docs/connect-an-agent.md`.

No new MCP tool, no browser interaction primitive, no external act, no change to the action
queue (FR-023 / Principle V).

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22 (ESM for `src/main`/`src/shared`;
`tsconfig.renderer.json` compiles `src/renderer` in isolation), Electron 33.

**Primary Dependencies**: Electron — `app.requestSingleInstanceLock()` / `app.on
("second-instance")` / `app.setPath("userData", …)` / `dialog.showErrorBox()` (all valid
before `app.whenReady()`), `BrowserWindow` `title` + `webContents` `page-title-updated`;
`node:fs` `mkdirSync`; `node:http` (existing `listenOn`). `@modelcontextprotocol/sdk`
`McpServer` (`name` field → handshake `serverInfo.name`). **No new runtime dependency.**

**Storage**: No new *kind* of store. A named instance gets `<userData>/instances/<name>/`
holding exactly today's per-profile files (`settings.json`, `recent-urls.json`,
`interaction-log.jsonl`, the Chromium session), same formats. The default instance's
directory is unchanged. No file indexes instances (FR-024).

**Testing**:
- `vitest` unit — `src/main/instance.ts`: `resolveInstance(argv, env, baseDir)` precedence
  matrix (env dir > `--instance` > default; label from `--instance` name, else
  `HYPPO_USER_DATA_DIR` basename, else empty), `validateInstanceName` accept/reject,
  `deriveLabel` sanitising a raw basename, `serverNameFor(label)`, `classifyListenError`.
  Additions to `connection-snippets.test.ts` — `serverName` threads through
  `mcpAddCommand` / `mcpJsonConfig` / `stdioJsonConfig`; default stays `hyppovisor`.
- `@playwright/test` `_electron` integration — `tests/integration/multi-instance.spec.ts`:
  US1 two instances up on two ports, `initialize` `serverInfo.name` differs, window titles
  differ, each `settings.json` under its own dir; US3 occupy a port → `serverStatus ===
  "port-unavailable"` → panel `setPort` to a free port → `"listening"` + `ping` succeeds;
  US2 second launch into a reused dir opens no window and exits. Offline — no live-site
  traffic (uses the fixture server / loopback only).

**Target Platform**: Electron desktop (macOS primary; Windows/Linux build) + embedded MCP
HTTP/stdio server.

**Project Type**: Single project — `src/main/**` + `src/preload/**` + `src/shared/**` +
`src/renderer/**` + `tests/**`. Existing layout.

**Performance Goals**: `requestSingleInstanceLock()` and the arg parse are synchronous and
run before `whenReady` — no measurable startup cost. Collision dialog appears essentially
immediately (SC-003, "~2 s"). Recovering from `port-unavailable` is one `listenOn()`
(SC-004, FR-015).

**Constraints**: Loopback only (unchanged). Each instance keeps app-wide
one-operation-at-a-time sequencing *within itself* — the queue is untouched (Principle V).
`HYPPO_USER_DATA_DIR` / `HYPPO_MCP_PORT` / `HYPPO_MCP_TOKEN` keep their current meaning and
still win (FR-004). The default single instance (no `--instance`, no env overrides) is
byte-identical to today — same dir, same port, same bare `HyppoVisor` title and
`hyppovisor` snippet name (FR-005 / SC-007).

**Scale/Scope**: 1 new main module (~120 lines), 1 new unit test file, 1 new integration
spec, 2 contract docs. Edits to `src/main/index.ts`, `src/main/settings.ts`,
`src/main/mcp/server.ts`, `src/shared/types.ts`, `src/renderer/{snippets,panel}.ts`,
`src/renderer/index.html`; `docs/configuration.md`, `docs/connect-an-agent.md`; a PATCH
constitution amendment.

**Unknowns**: none. The three `/speckit-clarify` answers (env-override label = path
basename; `--instance` form `[a-z0-9][a-z0-9_-]*` used verbatim; no-`--port` resolves via
feature-007 per-instance precedence) plus the spec Assumptions resolve every decision. The
one plan-level item flagged in the spec — the named-profile-directory path — is decided
here: `<userData>/instances/<name>/`.

**Known risk (mitigated)**: `app.requestSingleInstanceLock()` is keyed on the `userData`
dir, and the `HYPPO_E2E` test helper `launchApp` currently runs against the real dev
`userData`. Mitigation (R11): `launchApp` gets its own throwaway `HYPPO_USER_DATA_DIR`
(as `launchAppFull` already does) so the lock never collides across specs or with a dev
`npm start`. Test-only change.

## Constitution Check

*GATE: re-checked after Phase 1 design — still PASS.*

### I. Human Does Every External Act (NON-NEGOTIABLE) — PASS

No page is touched, no interaction primitive is added, no MCP tool is added. The MCP
surface is identical; only `serverInfo.name` in the handshake changes. Nothing here can
submit, send, apply, or authenticate.

### II. Zero Business Logic in HyppoVisor — PASS

The feature is launch-argument parsing, a startup lock, an OS dialog, a connection-status
field, and identity strings in the title / panel / handshake / snippets. No scoring,
ranking, filtering, or judgment; no orchestrator concept enters the code or the UI.

### III. Solid and Comprehensible — PASS **with a bundled PATCH amendment**

- **One window per instance.** Each process still opens exactly one `BrowserWindow` and has
  one entry point (`main()`). Running the one artifact more than once is N independent
  single-window instances, not a multi-window app. The two feature-007/1.3.2 carve-outs
  (person-triggered `_blank` → tab; allowlisted OAuth popup → modal child) are untouched.
- **State.** A named instance adds `<userData>/instances/<name>/` — the *same* per-profile
  files in the *same* formats the default profile already writes. There is **no** registry
  / index file, **no** picker window, **no** in-app instance creation or switching (all in
  Follow-ups). The OS process list plus each instance's `--instance` label / window title
  are the enumerable index Principle III asks for.
- **Smallest mechanism.** Two launch flags and one startup lock, versus the issue's
  `instances.json` + picker window + in-app manager. The `--port` flag reuses the existing
  feature-007 port machinery; the lock is one Electron built-in call.
- **Amendment.** The plan bundles a PATCH bump (1.4.0 → 1.4.1) adding a Principle III
  sentence + an Amendment History entry, so the review gate reads N single-window
  instances as conforming rather than as a second-window / hidden-state change. Tracked in
  Complexity Tracking below (precedent: feature 007's 1.3.1 token PATCH — a scoped
  clarification that blesses no new capability kind).

### IV. User-Held Credentials and Sessions — PASS

Each instance generates and stores its own loopback bearer token in its own profile
directory (feature 007, outside the shared data directory). Multi-instance moves no token
into shared or committed storage; nothing is typed into a site.

### V. Assistive Pace, Not Bulk Collection — PASS

The app-wide action queue (`src/main/queue/action-queue.ts`) is **not** modified. Each
instance keeps "at most one operation in flight across all its tabs". Running N processes
is N independent human-paced sessions — the same as a person running N projects by hand.
Making a *single* instance serve parallel non-interfering sessions (a per-tab queue) is an
explicit Follow-up precisely because it would touch this principle.

## Project Structure

### Documentation (this feature)

```text
specs/012-multi-instance/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions R1–R10
├── data-model.md        # Phase 1 — Instance, resolved launch state, connection-state delta
├── quickstart.md        # Phase 1 — run two instances; validate US1–US5
├── contracts/
│   ├── instance-launch.md        # CLI: --instance / --port, precedence, validation, collision
│   └── connection-state-delta.md # EffectiveConnection additions + IPC reply/panel changes
├── checklists/requirements.md    # from /speckit-specify (16/16)
└── tasks.md             # /speckit-tasks output — NOT created here
```

### Source Code (repository root)

```text
src/main/
├── instance.ts          # NEW — pure: resolveInstance / validateInstanceName / deriveLabel
│                         #        / serverNameFor / classifyListenError / collisionMessage
├── index.ts             # EDIT — resolve instance pre-whenReady; mkdir + setPath("userData");
│                         #        requestSingleInstanceLock + second-instance + showErrorBox;
│                         #        window title + page-title-updated guard; thread serverName
│                         #        + cliPort; capture serverStatus on bind failure;
│                         #        chrome:get-connection adds instanceLabel/serverName;
│                         #        chrome:set-port (re)starts a never-bound server
├── settings.ts          # EDIT — resolveEffective(settings, env, existed, cliPort?);
│                         #        port precedence env ?? cli ?? persisted; source "cli"
├── mcp/server.ts        # EDIT — makeServer(deps, serverName); startHttp/StdioMcpServer
│                         #        accept serverName (default "hyppovisor")
└── config.ts            # (no change expected; INSTANCE_NAME_RE lives in instance.ts)

src/shared/types.ts      # EDIT — ConnectionSource | "cli"; EffectiveConnection.serverStatus
                          #        + .instanceLabel + .serverName

src/preload/chrome.cjs   # (no change — getConnection reply just carries more fields)

src/renderer/
├── snippets.ts          # EDIT — SnippetState.serverName?; builders use it (default hyppovisor)
├── panel.ts             # EDIT — render serverStatus error block; header instance label;
│                         #        portSource "cli" info notice; pass serverName to builders
└── index.html           # EDIT — #panel-instance span in #panel-head; .panel-error style

tests/
├── unit/instance.test.ts            # NEW
├── unit/connection-snippets.test.ts # EDIT — serverName cases
├── integration/multi-instance.spec.ts # NEW
└── integration/helpers.ts           # EDIT — launchAppFull gains an extraArgs param;
                                      #        launchApp gets its own throwaway
                                      #        HYPPO_USER_DATA_DIR (R11 — lock vs. e2e)

docs/configuration.md    # EDIT — HYPPO_USER_DATA_DIR as override; --instance/--port;
                          #        "Run more than one HyppoVisor" section
docs/connect-an-agent.md # EDIT — per-instance server name

.specify/memory/constitution.md  # EDIT — PATCH 1.4.0 → 1.4.1
```

**Structure Decision**: Existing single-project layout. The only new source file is
`src/main/instance.ts` (pure, no Electron import — unit-testable like `settings.ts`).
Everything else is an edit to a file the feature already touches conceptually.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| PATCH constitution amendment (1.4.0 → 1.4.1), Principle III | Principle III says "one window"; without a clause, the review gate could read "run it N times" as a multi-window / hidden-state change and block it. The amendment scopes it: N processes, each one window + own profile dir, no shared state, no registry. | Not amending — rejected: leaves the gate ambiguous for a change that is squarely a Principle III topic (same reason feature 007 took the 1.3.1 token PATCH rather than leaving "is the bearer token a credential?" to reviewer judgement). |
| New `<userData>/instances/<name>/` directories | `app.setPath("userData", …)` must run before `whenReady`, and the profile *is* where settings/log/session live; a named instance needs its own. | A shared profile with per-instance sub-files — rejected: Chromium session (cookies) can't be partitioned by a sub-path, and it defeats the isolation the feature exists for. A registry file mapping names → dirs — rejected: that is the issue's heavier proposal and a new kind of store (Follow-up). |
