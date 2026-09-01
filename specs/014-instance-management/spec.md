# Feature Specification: Local Instance Management Panel

**Feature Branch**: `014-instance-management`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "given few hyppovisor instances executed on local machine (and
some of them might be in background mode) — to simplify instances management, add a page
with a list of all local hyppovisor instances (name, port, mode) and the possibility to
close any of them. For the current instance, reflect it in the list but do not allow to
close. And one more spec — a close-all-opened-tabs button."

## Overview

A person runs several HyppoVisor instances on one machine at the same time — one per client
or persona — started with `--instance <name>` / `--port <n>`, and some started with
`--background` so they have no Dock, taskbar, or app-switcher entry. Today the only way to
see what is running is the OS process list, and the only way to stop a background instance
is to find its PID or relaunch-then-quit it. This feature adds an in-window panel that lists
the instances this machine is running and lets the person shut one down from there, plus a
one-click way to close all embedded content tabs in the current instance.

> **Constitution note.** HyppoVisor's constitution (Principle III) currently states: "This
> is N independent single-window instances, not a multi-window app; there is no
> cross-instance registry or shared index." A panel that discovers sibling instances and
> shuts them down is cross-instance management. Delivering the instance-list user story as
> written requires a constitution amendment to Principle III (see Dependencies, and the open
> question in the requirements checklist). The close-all-tabs user story is within a single
> instance and does not raise this conflict.

## Clarifications

### Session 2026-09-01

- Q: Should the panel be allowed to shut down other running instances, or only list them? → A: Panel lists all local instances and can shut down any non-current one; Principle III gets a scoped amendment permitting a bounded local instance-management surface (same-user, same-machine).
- Q: When shutting down another instance that is mid-way through an agent-driven page action, what happens? → A: Shut down immediately; the in-flight action fails cleanly for the MCP caller (clear error, port released).
- Q: Before an instance is shut down from the panel, is there a confirmation prompt? → A: Yes — a single confirmation prompt naming the target instance and its port.
- Q: After "Close all tabs" runs, what does the tab area show? → A: A single blank/home tab, the same state as a freshly launched instance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See and shut down local instances (Priority: P1)

A person has three HyppoVisor instances running — `acme` on port 4100 (foreground),
`contoso` on port 4101 (foreground), and `initech` on port 4102 (background). They open
the instance-management panel in any one of them and see all three listed with name, port,
and mode. They no longer need `initech` today, so they close it from the panel; its window
(hidden) and process end. The row for the instance they are currently in is shown but its
close control is disabled, so they cannot shut down the window they are looking at by
accident.

**Why this priority**: This is the core of the request — background instances are otherwise
invisible and awkward to stop, and that friction is the reason the feature exists.

**Independent Test**: Launch 2+ instances (at least one `--background`), open the panel in
one, confirm every running instance appears with correct name / port / mode, close a
non-current one and confirm its process exits, and confirm the current instance's row
cannot be closed.

**Acceptance Scenarios**:

1. **Given** two foreground instances and one background instance are running, **When** the
   person opens the instance-management panel, **Then** all three appear, each showing its
   name, its MCP port, and its mode (foreground / background), and the current instance's
   row is visually marked as "this instance".
2. **Given** the panel is open, **When** the person triggers close on a non-current
   instance, **Then** that instance shuts down gracefully and its row disappears from the
   list (in this panel and in any other instance's panel) within a few seconds.
3. **Given** the panel is open, **When** the person looks at the row for the instance they
   are currently in, **Then** its close control is absent or disabled and a hint explains
   why.
4. **Given** an instance was closed or crashed outside the panel, **When** the panel is
   open or is next opened, **Then** the stale row is gone.
5. **Given** the person triggers close on an instance that is mid-way through an
   agent-driven action, **Then** the instance shuts down immediately and the in-flight
   action fails cleanly for the MCP caller with a clear error, and the port is released.

---

### User Story 2 - Close all open tabs at once (Priority: P2)

A person has opened a dozen job pages, an ATS, and LinkedIn as embedded tabs in one
instance over a work session. They are done and want a clean slate without quitting the
instance. They click "Close all tabs" and every embedded content tab closes, leaving the
instance running with a single blank/home tab (the same state as a freshly launched
instance).

**Why this priority**: A convenience that stands on its own and is much smaller in scope
than User Story 1; useful even if User Story 1 is deferred or amended.

**Independent Test**: Open several tabs in one instance, click "Close all tabs", confirm
every content tab is gone, the instance is still running, and the MCP session / logged-in
browser state for the instance is unaffected beyond the closed tabs.

**Acceptance Scenarios**:

1. **Given** an instance has several embedded content tabs open, **When** the person
   activates "Close all tabs", **Then** all content tabs close and the instance keeps
   running.
2. **Given** "Close all tabs" has been activated, **When** the person looks at the window,
   **Then** the tab area shows a single blank/home tab (the freshly-launched state), and no
   page from a previously open tab is still loaded.
3. **Given** there are no content tabs open, **When** the person looks at the control,
   **Then** "Close all tabs" is disabled or is a no-op.
4. **Given** a tab is mid-load or mid-interaction, **When** "Close all tabs" is activated,
   **Then** that tab still closes and any in-flight page work for it is abandoned cleanly.

---

### Edge Cases

- Two instances were started with the same `--instance` name (misconfiguration): the panel
  distinguishes them by port so both are still individually identifiable and closable.
- An instance is running but its MCP port is not responding (starting up, or wedged): it
  appears with a "not responding" mode/state rather than being hidden, and close still
  attempts a graceful-then-forced shutdown.
- The person closes every other instance from the panel, leaving only the current one: the
  list shows a single non-closable row.
- A close is triggered twice quickly on the same instance: the second is a no-op, not an
  error.
- The current instance is itself running in `--background` mode: its row still shows,
  marked as current and non-closable, with mode "background".
- "Close all tabs" is activated while an orchestrator (MCP client) is actively reading a
  tab: the read fails cleanly for the caller and the tab still closes.
- Closing another instance always requires a single confirmation prompt that names the
  target instance and its port; there is no undo after confirming.

## Requirements *(mandatory)*

### Functional Requirements

#### Instance-management panel (User Story 1)

- **FR-001**: The app MUST provide an in-window panel, reachable from the existing UI, that
  lists the HyppoVisor instances currently running on the local machine.
- **FR-002**: Each listed instance MUST show its instance name, its MCP port, and its mode
  (foreground or background), and MUST indicate whether it is currently responding.
- **FR-003**: The panel MUST clearly mark which row is the instance the person is currently
  viewing.
- **FR-004**: The panel MUST allow the person to shut down any listed instance that is not
  the current one, after a single confirmation prompt that names the target instance and
  its port. There is no undo once confirmed.
- **FR-005**: The panel MUST NOT allow the person to shut down the current instance from
  the list (its close control is absent or disabled, with a brief explanation).
- **FR-006**: Shutting down another instance MUST be a graceful shutdown (the target
  instance closes its window and ends its process, releasing its MCP port); if graceful
  shutdown does not complete within a short bounded time, the app MUST escalate to a forced
  termination. Shutdown MUST NOT wait for an in-flight agent-driven action to finish: the
  target instance shuts down immediately and any in-flight MCP operation against it fails
  cleanly for the caller with a clear error.
- **FR-007**: The list MUST reflect instances appearing and disappearing (newly launched,
  closed here, closed elsewhere, or crashed) within a few seconds, without the person
  needing to reload the whole app.
- **FR-008**: Instance discovery MUST be limited to HyppoVisor instances started by the
  same user on the same machine; the panel MUST NOT reach across machines or the network.
- **FR-009**: The mechanism the panel uses to discover and to signal other instances MUST
  NOT introduce a persistent shared store of business or page data, and MUST NOT persist
  any state beyond what is needed to enumerate live processes. [Depends on the constitution
  amendment — see FR-014.]
- **FR-010**: If discovery cannot enumerate instances (mechanism unavailable), the panel
  MUST still show the current instance and MUST show a clear "cannot list other instances"
  state rather than an empty list implying none are running.

#### Close-all-tabs (User Story 2)

- **FR-011**: The app MUST provide a single control that closes all embedded content tabs
  in the current instance.
- **FR-012**: Activating close-all-tabs MUST leave the current instance running, with its
  MCP server, configuration, and logged-in browser sessions otherwise unaffected; only the
  open tabs are closed.
- **FR-013**: After close-all-tabs, the window MUST show a single blank/home tab — the same
  state as a freshly launched instance — with no previously open page still loaded, and the
  control MUST be disabled or a no-op when only that blank/home tab (or no content tab) is
  open.

#### Governance

- **FR-014**: Before User Story 1 is implemented, the project constitution's Principle III
  ("no cross-instance registry or shared index"; "not a multi-window app") MUST be amended
  to permit a local, read-plus-shutdown instance-management surface, with the amendment
  recorded in Amendment History. User Story 2 does not depend on this.

### Key Entities *(include if feature involves data)*

- **Local instance**: one running HyppoVisor process on this machine, characterised by its
  instance name, its MCP port, its mode (foreground / background), its responding/not-
  responding state, and whether it is the current instance. Exists only while the process
  runs; not persisted.
- **Embedded content tab**: one open page inside the current instance's window (a job page,
  an ATS, LinkedIn, etc.), as already defined by the app. Close-all-tabs operates on the
  set of these for the current instance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With N instances running (at least one in background), a person opening the
  panel in any one of them sees all N, each with correct name, port, and mode, in under 3
  seconds.
- **SC-002**: A person can shut down a background instance from the panel in at most two
  interactions (open panel, trigger close) without using the terminal, the OS process
  list, or a relaunch.
- **SC-003**: After a close is triggered, the target instance's process has exited and its
  MCP port is free within 10 seconds in 95% of cases.
- **SC-004**: The current instance can never be shut down from the list — 0 occurrences in
  testing of the current instance being closable.
- **SC-005**: A list open in one instance reflects an instance closed from another instance
  within 5 seconds.
- **SC-006**: From a session with 10+ open tabs, a person can clear all tabs in one
  interaction, and the instance is still running and usable afterwards.

## Assumptions

- "Instance" means a process launched per feature `012-multi-instance` (`--instance` /
  `--port`, or the `HYPPO_USER_DATA_DIR` / `HYPPO_MCP_PORT` overrides). "Mode" is
  foreground vs. `--background` (feature `013-background-window`).
- "Close all opened tabs" refers to the embedded content tabs within one instance's single
  window, not to closing instance windows and not to OS-level browser tabs outside the app.
- The panel is a new view on the app's existing single window (like the MCP connection
  panel), not a second window or a background service.
- Closing another instance is a shutdown of that whole instance (window + process), not
  closing one of its tabs.
- Discovery is expected to work by enumerating the per-instance profile directories under
  the app-support `instances/` root and/or probing the local MCP ports those instances
  use — no new always-on daemon. The exact mechanism is a planning decision, constrained
  by FR-009.
- A person running multiple instances is technical enough to understand that closing an
  instance ends its work; the feature still guards the current instance and (pending
  clarification) may confirm before closing others.
- Reasonable defaults for unspecified UI details (placement of the panel entry point,
  exact wording of the "this instance" marker, empty-state copy) will follow existing app
  conventions and be settled at design time.

## Dependencies

- **Feature `012-multi-instance`** — defines what an instance is, the `--instance` /
  `--port` launch path, and the `instances/<name>/` profile directories.
- **Feature `013-background-window`** — defines `--background` mode and the "no Dock /
  taskbar / app-switcher entry" behaviour that makes those instances hard to stop today.
- **Constitution amendment to Principle III** — required before User Story 1 ships
  (FR-014). The amendment must decide whether a bounded local instance-management surface
  is a permitted carve-out from "not a multi-window app / no cross-instance registry".
- **Existing tab model** — close-all-tabs reuses the app's current definition of an
  embedded content tab and its per-tab teardown.
