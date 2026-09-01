# Feature Specification: Run More Than One HyppoVisor on One Machine

**Feature Branch**: `012-multi-instance`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Run more than one HyppoVisor on one machine — supported and
safe multi-instance." Take the **lean cut** of issue 006: make the existing stopgap
(`HYPPO_USER_DATA_DIR` + `HYPPO_MCP_PORT` + `open -na`) a supported, discoverable workflow
that fails loudly. Not the issue's registry / picker-window / in-app-management proposal.

## Overview

A person wants to run parallel agent sessions on one machine — one Claude Code project per
client or persona — each talking to its **own** HyppoVisor on its **own** MCP port, so the
sessions never disturb each other. Session A fills a form while session B reads pages, and
neither blocks or contaminates the other: separate tabs, separate logged-in browser
sessions, separate `settings.json` / `recent-urls.json` / `interaction-log.jsonl`.

This already works today by accident: nothing in the app blocks a second process, and two
environment variables (`HYPPO_USER_DATA_DIR`, `HYPPO_MCP_PORT`) already point a process at
its own profile and port. But `HYPPO_USER_DATA_DIR` reads as a test-only knob, no
documentation tells a person to use it, and the two failure modes that matter —
two instances sharing a profile, and two instances wanting the same port — are silent or
confusing. The action queue is deliberately app-wide (Constitution Principle V), so making
*one* instance serve non-interfering parallel sessions is a larger change; running one
process per session sidesteps it entirely because each process has its own everything.

This feature does four things and nothing more:

1. **A supported launch path** — `--instance <name>` (derives a named profile directory and
   a display label) and `--port <n>` (the MCP HTTP port for this process). The existing
   environment variables stay as explicit overrides.
2. **A loud profile-collision guard** — launching a second instance against a profile
   directory another instance already holds shows a plain dialog with the fix and exits,
   instead of opening a broken window; an accidental re-launch of the default profile
   raises the window that is already running.
3. **A loud port-collision state** — when the MCP HTTP server cannot bind because the port
   is in use, the connection panel (feature 007) shows a named error with the remedy,
   instead of only a line on stderr. The port is never auto-changed.
4. **Instance identity** — the display label appears in the window title, the connection
   panel header, and the MCP handshake, and the panel's copy-paste registration snippets
   use a per-instance server name so registering a second instance does not overwrite the
   first.

Plus documentation: reframe `HYPPO_USER_DATA_DIR` as an override and add a "Run more than
one HyppoVisor" section.

Boundaries kept from the constitution:

- **The human performs every external act (Principle I).** This feature touches no page,
  adds no interaction primitive, and adds no MCP tool. Nothing here can submit, send, or
  authenticate.
- **Zero business logic (Principle II).** Launch-argument parsing, a collision dialog, a
  connection state, and window/handshake labels. No judgment, no orchestrator concept.
- **Solid and comprehensible (Principle III).** Each instance is still exactly one window
  with its own profile directory and no state shared between instances. No new *kind* of
  store: a named instance's profile directory holds exactly today's per-profile files in
  today's formats. No registry file indexing instances, no picker window, no in-app
  instance creation or switching — those are explicitly out of scope (see Follow-ups). The
  plan MUST cite Principle III and is expected to carry a PATCH-level clarification that
  several instances — each one window, each its own profile directory, sharing no state —
  are permitted, so the review gate does not read this as a second-window or hidden-state
  change.
- **User-held credentials and sessions (Principle IV).** Each instance's loopback bearer
  token stays a local per-profile secret. Nothing about multi-instance moves a token into
  shared or committed storage.
- **Assistive pace (Principle V).** Each instance keeps the app-wide one-operation-at-a-time
  sequencing within itself. Running N processes does not raise any single instance's pace;
  it is N independent human-paced sessions, which is what a person running N projects does
  anyway.

## Clarifications

### Session 2026-09-01

- Q: When launched with the `HYPPO_USER_DATA_DIR` env override and no `--instance` name, what is the display label? → A: The basename of the `HYPPO_USER_DATA_DIR` path (e.g. `.../work` → `work`); fall back to the bare `HyppoVisor` / `hyppovisor` only when that basename is empty or unusable.
- Q: What is the allowed form for `--instance <name>`, and is it used verbatim as both the profile directory name and the `hyppovisor-<name>` MCP server-name suffix? → A: `[a-z0-9][a-z0-9_-]*`, 1–32 chars (must start alphanumeric); used verbatim for both — no sanitizing step. Out-of-form names are refused at launch.
- Q: When `--instance <name>` is given without `--port`, which port is used? → A: Feature 007's existing precedence, applied within that instance's own profile: `--port` if given → else the port persisted in that instance's `settings.json` → else the built-in default. A first-run collision on the default port is a one-time panel fix that then persists.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Launch a named instance on a chosen port (Priority: P1)

A person has two projects, each pre-configured with its own HyppoVisor MCP port. They start
one HyppoVisor per project, each with `--instance <name> --port <n>`. Each opens its own
window, binds its own port, and uses its own profile directory. An agent in project A fills
a form in instance A while an agent in project B reads pages in instance B; neither call
waits on or affects the other, and each instance's audit log records only its own actions.

**Why this priority**: This is the whole point of the feature — parallel, non-interfering
sessions on one machine. Without it there is nothing.

**Independent Test**: Launch two instances with distinct `--instance` names and `--port`
values. Confirm two windows, two bound ports, two profile directories. Drive a fill in one
and a read in the other concurrently; confirm both complete and each
`interaction-log.jsonl` contains only its own entries.

**Acceptance Scenarios**:

1. **Given** no HyppoVisor running, **When** the person launches with `--instance work
   --port 7357`, **Then** a window opens titled for the `work` instance, the MCP server is
   reachable on `7357`, and the profile files are created under a `work`-specific
   directory.
2. **Given** the `work` instance is running on `7357`, **When** the person launches a
   second process with `--instance personal --port 7358`, **Then** both windows are open,
   both ports are reachable, and the two instances share no tabs, settings, recent URLs, or
   log.
3. **Given** both instances are running, **When** an agent on `7357` performs a multi-step
   fill and an agent on `7358` performs several reads at the same time, **Then** neither
   agent's calls are delayed by the other's and each instance's log reflects only its own
   activity.
4. **Given** an invalid `--port` value (non-numeric or outside 1–65535), **When** the
   person launches, **Then** the app refuses to start with a message naming the bad value.

---

### User Story 2 - Loud guard when two instances would share a profile (Priority: P2)

A person forgets they already have HyppoVisor running and launches it again without
`--instance`. Instead of a second window that fights the first over the same profile (or a
half-broken window from a held profile lock), they get a plain dialog explaining that a
HyppoVisor is already using this profile and how to run a separate instance, and the
window that is already running comes to the foreground.

**Why this priority**: The stopgap's sharpest edge. A shared profile directory corrupts
session state and confuses the person; this must never present as a usable-looking window.

**Independent Test**: With the default instance running, launch a second default instance.
Confirm a readable dialog appears, the second process exits without opening a window, and
the first window is raised.

**Acceptance Scenarios**:

1. **Given** the default instance is running, **When** a second default instance is
   launched, **Then** the second process shows a dialog naming the situation and the fix
   (`--instance <name>`), exits, and does not open a window.
2. **Given** the default instance is running, **When** the accidental second launch is
   dismissed, **Then** the already-running window is brought to the foreground.
3. **Given** instance `work` is running, **When** instance `personal` (a different profile
   directory) is launched, **Then** it starts normally with no dialog.

---

### User Story 3 - Loud state when the port is already in use (Priority: P2)

A person launches an instance whose pre-configured port is already taken (another instance,
or an unrelated process). The window still opens and the browser is fully usable, but the
connection panel shows a clear "port in use" error naming the port and the remedy. The app
does not silently pick a different port, because the person's MCP client is configured for
the one they chose.

**Why this priority**: Today this is caught and written only to stderr; the panel just says
the server is not running, with no reason. A person pre-configuring ports per project needs
to see the conflict explicitly.

**Independent Test**: Occupy a port, launch an instance configured for it, and open the
connection panel. Confirm a named "port in use" error with the remedy, confirm the browser
still works, and confirm the process did not bind a different port.

**Acceptance Scenarios**:

1. **Given** port 7357 is in use, **When** an instance configured for 7357 starts, **Then**
   the connection panel shows an error state that names port 7357 and states the remedy,
   not a generic "not running".
2. **Given** the MCP server failed to bind, **When** the person uses the browser (open a
   URL, read a page, draft into a field), **Then** every non-MCP capability works normally.
3. **Given** the "port in use" state is shown, **When** the person changes the port in the
   panel to a free one, **Then** the server binds, the error clears, and no restart is
   needed.
4. **Given** port 7357 is in use, **When** the instance starts, **Then** the app never
   binds a port other than the one configured.

---

### User Story 4 - Tell instances apart (Priority: P3)

With two instances open, the person can tell which window is the `work` one from the title
bar alone, the connection panel of each shows its instance label, and an agent that
connects can read the instance label from the MCP handshake. The panel's copyable
`claude mcp add` and JSON snippets use a per-instance server name, so wiring up the second
instance does not clobber the first instance's client entry.

**Why this priority**: Quality-of-life and correctness for the client config; the feature
works without it but is confusing and the snippets are a footgun.

**Independent Test**: Open two named instances. Confirm each window title and panel header
carry the label, confirm the MCP handshake server name carries the label, and confirm the
two panels' snippets use two different server names.

**Acceptance Scenarios**:

1. **Given** instance `work`, **When** its window is shown, **Then** the title includes
   `work` (e.g. `HyppoVisor — work`) and the connection panel header shows `work`.
2. **Given** an agent connects to instance `work`, **When** it completes the MCP handshake,
   **Then** the server name it receives carries `work`.
3. **Given** the connection panel of instance `work`, **When** the person copies the
   registration snippet, **Then** the MCP server name in it is instance-specific (e.g.
   `hyppovisor-work`) and the port is the live one.
4. **Given** the plain default instance (no `--instance`), **When** its window and panel
   are shown, **Then** the title is the bare `HyppoVisor` and the snippet server name is
   the bare `hyppovisor` — unchanged from today.

---

### User Story 5 - Documentation for running more than one (Priority: P3)

A person who has never run two instances reads the docs and gets a second instance running
from a cold start without opening the source. The docs describe `HYPPO_USER_DATA_DIR` as a
general override rather than a test-only knob, state the launch precedence, and warn that
two instances must never share a profile directory.

**Why this priority**: The capability is worthless if undiscoverable, but it depends on the
behavior in US1–US4 being settled first.

**Independent Test**: Follow the new docs section from a clean machine state; a second
instance is running on its own port within a few minutes.

**Acceptance Scenarios**:

1. **Given** the configuration docs, **When** a person reads the `HYPPO_USER_DATA_DIR`
   entry, **Then** it is described as an override with the launch precedence stated, not as
   "test isolation".
2. **Given** the docs, **When** a person looks for how to run two instances, **Then** there
   is a "Run more than one HyppoVisor" section built around `--instance` / `--port`, with
   the environment variables shown only as the escape hatch, and an explicit warning not to
   share a profile directory.
3. **Given** the agent-connection docs, **When** a person reads how to register the server,
   **Then** the per-instance server name is reflected.

---

### Edge Cases

- **Both `--instance` and an environment override are set.** The environment override wins
  and the affected panel field is shown read-only (source `env`), exactly as today. The
  display label still comes from `--instance` when that name is present.
- **`HYPPO_USER_DATA_DIR` set with no `--instance`.** The display label is the basename of
  that path (FR-004a) — e.g. `.../instances/ci` shows as `ci` in the title, panel header,
  handshake, and `hyppovisor-ci` snippet name.
- **`--instance` name outside `[a-z0-9][a-z0-9_-]*` / 1–32 chars** (path separators, `..`,
  whitespace, uppercase, leading `-`, empty, too long). The name is rejected at launch with
  a message stating the allowed form; no directory is created.
- **Same `--instance` name, two `--port` values, launched twice.** The second launch is a
  profile collision (US2) — the name, not the port, identifies the profile.
- **`--port` omitted but `--instance` given.** The instance uses its own persisted port
  (feature 007) if it has one, else the built-in default (FR-002a). If that default is
  already held by the default instance, the person sees the US3 port-in-use state, picks a
  port in the panel, and it persists for that instance's next launch.
- **The other instance exits while this one shows "port in use".** The state does not clear
  on its own; the person re-applies the port (or restarts). Auto-recovery is out of scope.
- **Profile directory exists but no instance is running** (previous instance crashed,
  stale lock). Startup proceeds normally; a stale lock must not be treated as a live
  collision.
- **Default single-instance user upgrades to this version.** With no `--instance` and no
  environment overrides, nothing observable changes: same profile path, same default port,
  same bare title.
- **stdio transport with `--instance`.** A stdio instance has no port to collide; the
  instance name still selects the profile and labels the handshake. Two stdio instances
  with the same name are still a profile collision.

## Requirements *(mandatory)*

### Functional Requirements

#### Instance selection at launch

- **FR-001**: The app MUST accept a `--instance <name>` launch argument that selects a
  named profile directory (a stable per-name location under the application-support root)
  and a display label derived from the name.
- **FR-002**: The app MUST accept a `--port <n>` launch argument that sets the MCP HTTP
  port for the process. `n` MUST be validated as an integer in 1–65535; an invalid value
  MUST stop startup with a message naming the bad value.
- **FR-002a**: When `--port` is not given, the effective port MUST follow feature 007's
  existing precedence resolved against the selected instance's own profile: the port
  persisted in that instance's `settings.json` if present, otherwise the built-in default.
  `--instance` without `--port` is therefore a valid launch; a first-run clash on the
  default port surfaces as the FR-011 port-in-use state and the panel-set port then
  persists per instance.
- **FR-003**: The app MUST validate `--instance <name>` against the form
  `[a-z0-9][a-z0-9_-]*`, 1–32 characters (lowercase letters, digits, hyphen, underscore;
  first character alphanumeric). An out-of-form name MUST be refused at launch with a
  message stating the allowed form, and no directory is created. The validated name is
  used **verbatim** as both the profile directory name (FR-001) and the `hyppovisor-<name>`
  MCP server-name suffix (FR-019) — there is no separate sanitizing step.
- **FR-004**: The existing environment overrides (`HYPPO_USER_DATA_DIR`, `HYPPO_MCP_PORT`,
  `HYPPO_MCP_TOKEN`) MUST continue to work and MUST take precedence over the values a
  `--instance` name would derive. When an override is in effect, the connection panel MUST
  show the affected field(s) read-only with source `env`, exactly as today.
- **FR-004a**: When the app is launched with `HYPPO_USER_DATA_DIR` and no `--instance`
  name, the display label MUST be the basename (last path segment) of the
  `HYPPO_USER_DATA_DIR` value. If that basename is empty or unusable, the app MUST fall
  back to the bare default identity (`HyppoVisor` title, `hyppovisor` snippet name).
- **FR-005**: With neither `--instance` nor any of the environment overrides set, behavior
  MUST be byte-identical to the current single-instance behavior: same profile directory,
  same default port, same window title.
- **FR-006**: The launch precedence MUST be explicit and documented: environment override
  first, then `--instance` / `--port`, then per-instance persisted settings (FR-002a for
  the port), then the built-in default.

#### Profile-collision guard

- **FR-007**: At startup, if the chosen profile directory is already held by another
  running HyppoVisor, the app MUST NOT open a window; it MUST show a plain dialog stating
  that a HyppoVisor is already using this profile and that a separate instance is run with
  `--instance <name>`, then exit.
- **FR-008**: When that collision is an accidental re-launch of the same profile, the
  already-running instance MUST bring its window to the foreground.
- **FR-009**: Two instances whose profile directories differ MUST both start normally with
  no dialog.
- **FR-010**: A stale lock left by a crashed instance (no live process holding the profile)
  MUST NOT be reported as a collision; startup proceeds.

#### Port-collision state

- **FR-011**: When the MCP HTTP server cannot bind because the port is already in use, the
  app MUST represent this as a distinct, user-visible connection state surfaced by the
  connection panel — not only a stderr log line and not the generic "server not running".
- **FR-012**: That state MUST name the configured port and state the remedy (another
  instance may hold it; change the port in the panel or relaunch with a different `--port`).
- **FR-013**: The app MUST NOT automatically bind a port other than the one configured.
- **FR-014**: When the MCP server fails to bind, every non-MCP capability (window, tabs,
  navigation, reading, drafting) MUST remain fully usable; the failure is reported, not
  fatal.
- **FR-015**: When the port is changed from the panel to a free one, the server MUST bind
  and the error state MUST clear without an app restart.

#### Instance identity

- **FR-016**: A non-default instance's window title MUST include its display label (e.g.
  `HyppoVisor — work`). The plain default instance MUST keep the bare title.
- **FR-017**: The connection panel MUST show the instance's display label in its header.
- **FR-018**: The MCP `initialize` handshake response MUST carry the instance's display
  label in the server name, so a connected agent can confirm which instance it reached.
- **FR-019**: The connection panel's copyable registration snippets (the `claude mcp add`
  command and the JSON block) MUST use the MCP server name `hyppovisor-<name>` (the
  `--instance` name verbatim, per FR-003) and the live port. For an
  `HYPPO_USER_DATA_DIR`-only launch the `<name>` is the path basename (FR-004a). The
  default instance MUST keep the bare `hyppovisor` name — unchanged from today.

#### Documentation

- **FR-020**: `docs/configuration.md` MUST describe `HYPPO_USER_DATA_DIR` as a general
  override (not "test isolation") and MUST state the launch precedence from FR-006.
- **FR-021**: The docs MUST include a "Run more than one HyppoVisor" section built around
  `--instance` / `--port`, mentioning the environment variables only as the escape hatch,
  and MUST state that two instances must never share a profile directory.
- **FR-022**: `docs/connect-an-agent.md` MUST reflect the per-instance MCP server name from
  FR-019.

#### Governance / non-goals

- **FR-023**: This feature MUST add no MCP tool, no browser interaction primitive, and no
  external act.
- **FR-024**: This feature MUST NOT introduce a new *kind* of persistent store: a named
  instance's profile directory holds exactly the current per-profile files
  (`settings.json`, `recent-urls.json`, `interaction-log.jsonl`, the browser session) in
  their current formats. No file indexes instances; no state is shared between instances.

### Key Entities

- **Instance**: a running HyppoVisor process, identified at launch by a profile directory,
  an MCP port, and a display label. It is runtime identity derived from launch arguments or
  environment overrides — it is not persisted as a record anywhere.
- **Profile directory**: the per-instance data directory holding that instance's
  `settings.json`, `recent-urls.json`, `interaction-log.jsonl`, and browser session. The
  default instance's is today's location; a named instance's is a stable per-name location
  under the same application-support root. Format unchanged.
- **Display label**: the human-readable name for an instance, shown in the window title,
  the connection panel header, the MCP handshake, and the panel's registration snippets.
  Derived from the `--instance` name; for an `HYPPO_USER_DATA_DIR`-only launch, the
  basename of that path (FR-004a); empty for the plain default instance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can start two instances with distinct `--instance` names and
  `--port` values and run a form-fill in one while reading pages in the other, with no
  observable interference — no shared tabs, no shared settings, no call in one instance
  delayed by activity in the other.
- **SC-002**: Each instance writes `settings.json`, `recent-urls.json`, and
  `interaction-log.jsonl` only under its own profile directory; after a mixed parallel
  session, neither instance's files contain the other's data.
- **SC-003**: Launching a second instance against an in-use profile shows a readable dialog
  naming the fix within about 2 seconds and never opens a usable-looking window against the
  shared profile.
- **SC-004**: Launching an instance on an in-use port leaves every non-MCP capability
  working and shows a named "port in use" error with the remedy in the connection panel
  every time — never only in a log, never a silently different port.
- **SC-005**: With two instances open, a person can identify which window is which from the
  title bar alone, and a connected agent can read the instance label from the MCP
  handshake.
- **SC-006**: Registering both instances with an MCP client using the panel snippets
  produces two distinct client entries; neither overwrites the other.
- **SC-007**: A person who passes no `--instance` and sets no environment overrides sees
  behavior identical to the previous version — same profile path, same default port, same
  bare `HyppoVisor` title and `hyppovisor` snippet name.
- **SC-008**: Following the new docs section from a cold start, a person gets a second
  instance running on its own port in under 5 minutes without reading source code.

## Assumptions

- Parallel non-interfering sessions are achieved by running one process per session. The
  app-wide one-operation-at-a-time sequencing (Principle V) is unchanged *within* an
  instance; isolation between sessions is a property of separate processes, not of a shared
  server.
- Multi-instance sessions connect over the HTTP transport. The stdio transport is
  single-client by nature; `--instance` still selects a profile and labels the handshake
  for a stdio instance, but "parallel sessions on one instance" is an HTTP concept.
- Logged-in browser sessions are isolated for free because each instance is a separate
  browser profile. Sharing one login across instances is not a goal — each instance logs
  into each site in its own profile.
- A named instance's profile directory lives at a stable per-name path under the same
  application-support root the default instance already uses (e.g. an `instances/<name>`
  subtree). The exact path is a plan decision; the requirement is that it is stable,
  documented, and distinct per name.
- The runtime provides a per-profile startup lock keyed on the profile directory, so
  instances with distinct profile directories never collide and a same-profile second
  launch is detectable before a window opens. (This is how `--instance` avoids the
  Chromium `SingletonLock` confusion described in issue 006.)
- The connection panel (feature 007) is the surface for the port-in-use state; this feature
  extends its existing connection states rather than adding any new window or overlay.
- macOS is the reference platform for the launch recipe (`open -na HyppoVisor --args …`);
  the mechanism is not macOS-specific but the docs lead with macOS.
- Instance names are `[a-z0-9][a-z0-9_-]*`, 1–32 characters (Clarifications 2026-09-01),
  chosen so one string is valid as both a directory name and a `claude mcp add` server
  name with no transform.

## Dependencies

- **Feature 007 (MCP connection panel)** — the port setting, the token handling, the
  `EffectiveConnection` state the panel renders, and the copy-paste snippets. This feature
  adds a connection state and a header label and changes the snippet server name.
- **Feature 001 (open any URL)** — the app-wide action queue and the "a transport failure
  must not take the window down" behavior this feature makes visible.
- **The constitution** — the plan MUST cite Principle III and is expected to add a
  PATCH-level Amendment History entry clarifying that multiple instances (each one window,
  each its own profile directory, sharing no state) are permitted.

## Follow-ups (out of scope — not blocking)

- **Per-tab action queue.** Making the app-wide action queue per-tab so a *single* instance
  could serve non-interfering parallel sessions. Deliberately not pursued here: it touches
  the app-wide sequencing that Principle V and feature 001's FR-013/FR-013a define, and is
  too slow to land alongside this.
- **An `instances.json` registry file** listing every instance and its port.
- **A launch-time instance-picker window.**
- **In-app instance management** — creating, renaming, switching, or relaunching instances
  from the panel (including spawning new processes).
- **Session partitions for per-site identity isolation within one instance** (work vs
  personal login on the same site inside one window).
