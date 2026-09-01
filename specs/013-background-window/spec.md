# Feature Specification: Unobtrusive / Background Window

**Feature Branch**: `013-background-window`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Headless / background HyppoVisor — run one or several instances
without disturbing the user's screen and keyboard, and make local Playwright `_electron`
test runs stop flashing windows."

## Overview

Feature 012 made running several HyppoVisor instances on one machine supported. But each
process opens a window, and each new window can jump to the foreground and capture
keystrokes — so launching three project instances interrupts whatever the person is doing
three times, and leaves three windows on screen they didn't ask to see. The same friction
hits the integration test suite: every local `npm run test:e2e` run pops real windows on the
developer's screen.

This feature adds an **unobtrusive** way to run an instance:

1. A `--background` launch flag: the instance starts with **no visible window** and does not
   take focus. Its MCP server, tabs, reading, drafting, and screenshots all work exactly as
   a foreground instance's — an agent drives it the same way.
2. A **summon** gesture: re-launching the instance with the same `--instance` identity brings
   its window to the front, so the person can sign into a site or review a drafted form,
   then send it back to the background.
3. Focus safety for *every* named instance: launching `--instance <name>` never pulls focus
   from the app the person is using, `--background` or not. The plain default instance
   (no `--instance`) is unchanged.
4. The test harness runs the app with no window visible.

This is **not** a headless automation mode. A background instance is always one gesture away
from a real, viewable window — because signing in and reviewing drafts are things only the
person can do, and they need to see the page. Fully unattended browser automation with no
viewable window is an explicit non-goal (Constitution Principle V).

Boundaries kept from the constitution:

- **One installable artifact, one window (Principle III).** A hidden window is still exactly
  one window; a Dock / app-switcher entry is presentation, not a second surface. There is no
  system tray or menu-bar icon, no new persistent UI. The plan is expected to carry a
  PATCH-level clarification that the one window may start hidden and be summoned.
- **Assistive pace, human-supervised (Principle V).** A background instance is still a
  session the person started, still human-paced, and still summonable so the person can
  watch and intervene. This feature adds no way to run without the person able to see the
  tabs.
- **The human performs every external act (Principle I).** No page is touched, no
  interaction primitive is added, no MCP tool is added.
- **Zero business logic (Principle II).** Window visibility and focus, a launch flag, and a
  summon gesture. No judgment.
- **User-held credentials (Principle IV).** Unchanged. The person still signs in inside a
  visible tab — which is exactly why the window must stay summonable.

## Clarifications

### Session 2026-09-01

- Q: When the person closes the window of a summoned background instance, what happens? → A: Closing the window returns the instance to the background with its MCP server still running; it does **not** quit. Quitting is a separate, documented gesture — terminating the launching process (e.g. Ctrl-C) or a Quit menu item / keyboard shortcut in the window.
- Q: Does `--background` apply only to the launch that passes it, or does it persist as that instance's default for later launches? → A: Launch-flag only. `--background` affects just the launch that passes it; there is no stored "background" state. A standing background setup is a shell alias or a per-project launch line. (A persisted per-instance setting is a Follow-up.)
- Q: Does the "a named instance never steals focus" rule (FR-003) apply to every `--instance` launch, or only to `--background` ones? → A: Every named instance. Launching `--instance <name>` shows its window without taking focus; `--background` additionally hides it. This revises feature 012's launch behaviour for named instances (which currently show and focus). The plain default instance (no `--instance`) is unchanged — it still shows and focuses.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run several instances without them taking over the screen (Priority: P1)

A person has three project instances configured. They launch each with `--instance <name>
--port <n> --background`. No windows appear, no focus is taken, and their editor stays in
front. All three MCP servers are reachable; agents in three project sessions drive the three
instances in parallel. The person's screen and keyboard are undisturbed.

**Why this priority**: This is the point of the feature. Without it, the multi-instance
workflow from feature 012 interrupts the person once per instance and clutters the screen.

**Independent Test**: Launch two or three instances with `--background`. Confirm no window
appears and focus never leaves the foreground app. Confirm each instance answers on its MCP
port and an agent can open a URL, read a page, and fill a field in each.

**Acceptance Scenarios**:

1. **Given** the person is typing in another application, **When** they launch an instance
   with `--background`, **Then** no window appears, no keystroke is captured by HyppoVisor,
   and the foreground application keeps focus.
2. **Given** a `--background` instance is running, **When** an agent connects to its MCP
   port and calls open / read / fill / screenshot, **Then** every call works exactly as it
   would for a foreground instance.
3. **Given** three `--background` instances are running, **When** an agent drives all three
   at once, **Then** none of them shows a window and each instance's audit log records only
   its own activity.

---

### User Story 2 - Summon an instance to sign in or review (Priority: P2)

A page in the `work` instance needs a login. The person performs the documented summon
gesture (re-launching `--instance work`), and that instance's window comes to the front.
They sign in, scroll a drafted form to review it, switch tabs, then dismiss the window; the
instance returns to running in the background.

**Why this priority**: A background instance is useless if the person can never see it —
login and draft review are theirs to do and require a visible page. But summoning is the
exception, not the default flow, so it ranks below US1.

**Independent Test**: With a `--background` instance running, perform the summon gesture.
Confirm the window comes to the foreground and is fully interactive (sign in, scroll, switch
tabs). Dismiss it and confirm the instance is still running and still reachable on its MCP
port.

**Acceptance Scenarios**:

1. **Given** a `--background` instance with no visible window, **When** the person performs
   the summon gesture, **Then** that instance's window appears in the foreground and takes
   focus, within about 2 seconds.
2. **Given** a summoned window, **When** the person signs into a site, scrolls, and switches
   tabs, **Then** it behaves as an ordinary HyppoVisor window.
3. **Given** a summoned window, **When** the person closes it, **Then** the instance returns
   to the background — it keeps running, its MCP server stays reachable — and the person's
   other applications are not disturbed. Closing the window does not quit the instance.
4. **Given** two `--background` instances, **When** the person summons one, **Then** the
   other stays hidden and unaffected.

---

### User Story 3 - A named instance never steals focus (Priority: P2)

The person is mid-sentence in another app and launches `--instance client-a --port 7360`
(without `--background`). HyppoVisor's window does not jump in front of what they are doing
and does not swallow the keystrokes they were typing. The plain default instance
(`HyppoVisor` with no `--instance`) still shows and focuses on launch, exactly as before.

**Why this priority**: Focus theft is the sharpest everyday annoyance of the multi-instance
workflow and it is cheap to fix, but it is a refinement of US1's territory. It applies to
every named instance (Clarification Q3), revising feature 012's launch focus behaviour.

**Independent Test**: While typing in another application, launch a named instance without
`--background`. Confirm focus does not move and no keystroke is lost. Separately launch the
plain default instance and confirm it shows and focuses as today.

**Acceptance Scenarios**:

1. **Given** the person is typing in another application, **When** they launch
   `--instance <name>` without `--background`, **Then** focus stays where it was and no
   keystroke is captured by HyppoVisor.
2. **Given** no flags at all, **When** the person launches the default instance, **Then**
   its window is shown and focused, unchanged from the previous version.

---

### User Story 4 - Local test runs don't flash windows (Priority: P3)

A developer runs the integration test suite on their machine. No HyppoVisor windows appear
on their screen while it runs. The suite still exercises the full app — opening URLs,
reading pages, filling fields, taking screenshots — and its results are identical to running
it with windows visible.

**Why this priority**: Quality-of-life for contributors; it depends on the background
mechanism from US1 being in place first.

**Independent Test**: Run the integration suite locally. Confirm no window is shown at any
point and the pass/fail outcome matches a run with visible windows.

**Acceptance Scenarios**:

1. **Given** a developer machine with a display, **When** the integration suite runs,
   **Then** no HyppoVisor window is shown on screen.
2. **Given** the suite runs with windows hidden, **When** it completes, **Then** every test
   that passed with visible windows still passes — including the screenshot tests.

---

### User Story 5 - Quitting a background instance is discoverable (Priority: P3)

The person is done with the `client-a` instance for the day. They stop it cleanly — without
ever seeing a window — using a documented method. The other instances keep running.

**Why this priority**: Closing a summoned window returns the instance to the background
(Clarification Q1), so a running process with no window is easy to lose track of; the feature
must provide and document a real quit gesture. Lower priority because it is a small
affordance plus documentation.

**Independent Test**: Start a `--background` instance, then stop it with the documented
method. Confirm the process exits and any sibling instances are untouched.

**Acceptance Scenarios**:

1. **Given** a `--background` instance running with no visible window, **When** the person
   uses the documented quit method, **Then** the process exits.
2. **Given** several background instances, **When** the person quits one, **Then** the
   others keep running and stay reachable on their MCP ports.

---

### Edge Cases

- **`--background` on the plain default profile** (no `--instance`). Allowed: the
  "byte-identical default" guarantee from feature 012 applies only when no flags are passed;
  `--background` is a flag, so it may change launch behaviour for the default profile too.
- **Summon when the window is already visible.** No-op beyond bringing it to the front and
  focusing it.
- **Person closes the window expecting the app to quit.** The instance returns to the
  background instead (Clarification Q1). The quit gesture (FR-011) is separate and
  documented; the window's own Quit control makes it discoverable.
- **`--background` with the stdio transport.** HyppoVisor always opens a window (the window
  is the product); `--background` hides it while the stdio server runs normally.
- **A platform with no hidden-window concept** (some Linux window managers). `--background`
  degrades to a visible-but-inactive window — never focused, never foreground — rather than
  failing to start.
- **Page read while the window is hidden.** Returns the same content as when the window is
  visible (`read_page` / `read_form_fields` use `executeJavaScript`, no surface needed).
- **Screenshot while the window is hidden.** As built, `screenshot` returns `SCREENSHOT_FAILED`
  for a `--background` instance — a never-shown window has no compositor surface. The tool's
  error names the fix (summon the window, or run without `--background`). This is the one
  capability that is not at parity; see FR-002 and `research.md` R2.
- **The terminal that launched a foreground `--background` instance is closed.** Process
  lifetime then follows the launch method (`open -na` detaches; a shell-foreground
  `electron .` does not); this feature does not change that.
- **Summon gesture fired for an instance that isn't running.** Falls through to a normal
  launch of that instance (which, without `--background`, shows its window).
- **macOS: a summoned instance's Dock icon.** Appears while the window is visible and goes
  away when the instance returns to the background (it is not a permanent Dock resident).

## Requirements *(mandatory)*

### Functional Requirements

#### Background launch

- **FR-001**: The app MUST accept a `--background` launch flag that starts the instance with
  no window visible on screen and without taking keyboard focus from the foreground
  application.
- **FR-002**: A `--background` instance's MCP server, tabs, navigation, page reading, form
  reading, and drafting (fill / space / choose_option / reveal-click) MUST all function
  identically to a foreground instance's.
  - **As-built exception:** `screenshot` does **not**. A window that has never been shown has
    no compositor surface, so `capturePage()` fails; the tool returns `SCREENSHOT_FAILED`
    with guidance to summon the window or drop `--background`. Every other tool is
    unaffected. The R2 off-screen-reveal fallback was evaluated and declined as more
    fragile than a clear, documented refusal; captured in `research.md` R2.
- **FR-003**: Launching **any** named instance (`--instance <name>`), with or without
  `--background`, MUST NOT move focus away from the application the person is currently
  using and MUST NOT capture keystrokes intended for that application. Without `--background`
  the window is shown but not focused; this revises feature 012's show-and-focus behaviour
  for named instances.
- **FR-004**: With no `--instance` and no `--background`, launch behaviour MUST be identical
  to the previous version: the window is shown and focused.
- **FR-005**: On macOS, while an instance's window is not visible, that instance MUST NOT
  show a Dock icon or an application-switcher (⌘-Tab) entry.
- **FR-006**: On a platform with no hidden-window capability, `--background` MUST degrade to
  a visible-but-inactive window (never focused, never brought to the foreground) rather than
  failing to launch.

#### Summon and dismiss

- **FR-007**: Re-launching an already-running instance with the same `--instance` identity
  MUST bring that instance's window to the foreground and focus it (the summon gesture),
  extending feature 012's same-profile relaunch handling.
- **FR-008**: A summoned window MUST support everything an ordinary HyppoVisor window does —
  signing into sites, scrolling, reviewing drafted fields, switching and closing tabs.
- **FR-009**: Closing the window of a summoned instance MUST return it to the background —
  window not visible, MCP server still running — without disturbing other applications, and
  MUST NOT quit the instance.
- **FR-010**: Summoning or dismissing one instance MUST NOT change the visibility or focus
  of any other running instance.

#### Lifecycle

- **FR-011**: The person MUST be able to fully quit a background instance that has no
  visible window, by a documented method — terminating the launching process (e.g. Ctrl-C)
  and a Quit control in the window (menu item / keyboard shortcut). Quitting one instance
  MUST NOT stop any other.
- **FR-012**: `--background` MUST apply only to the launch that passes it. The feature MUST
  NOT introduce any stored "background" state — no new file and no new field in an existing
  per-profile settings file. A standing background setup is the person's own shell alias or
  per-project launch line.

#### Testing and tooling

- **FR-013**: The integration test suite MUST be able to run the app with no window visible
  on the developer's screen, while still exercising URL opening, page reads, form fills, and
  screenshots, with an unchanged pass/fail outcome.

#### Documentation

- **FR-014**: `docs/configuration.md` MUST document `--background`, the summon gesture, how
  to quit a background instance, and the macOS Dock / app-switcher behaviour.
- **FR-015**: The "Run more than one HyppoVisor" section MUST recommend `--background` for
  multi-instance setups.

#### Governance / non-goals

- **FR-016**: This feature MUST add no MCP tool, no browser interaction primitive, and no
  external act.
- **FR-017**: This feature MUST NOT introduce a fully headless mode — an instance with no
  way for the person to bring up a viewable window and sign in. A background instance MUST
  always be summonable to a real window.
- **FR-018**: This feature MUST NOT add a system-tray / status-bar icon or any other new
  persistent UI surface. The summon gesture is the re-launch of the instance; the quit and
  any dismiss controls live inside the one window or the standard application menu.

### Key Entities

- **Background instance**: a running HyppoVisor instance (feature 012) whose window is not
  currently visible and whose launch did not take focus. It is purely a runtime visibility
  state — nothing about it is persisted (Clarification Q2).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can start three instances with `--background` and keep working in
  another application with no window appearing and no interruption to their typing.
- **SC-002**: Every capability that works in a foreground instance also works in a
  `--background` instance — verified end to end (open, read, fill, tab list) against an
  instance whose window is never shown. **Except `screenshot`**, which needs a rendered
  surface and returns `SCREENSHOT_FAILED` while hidden (as-built; see FR-002 / `research.md` R2).
- **SC-003**: A person can bring a chosen background instance's window to the foreground
  within about 2 seconds using one documented gesture, sign in, and return it to the
  background.
- **SC-004**: Launching a named instance never moves focus away from the application the
  person is actively using and never loses a keystroke.
- **SC-005**: Running the integration test suite locally shows zero HyppoVisor windows and
  produces the same pass/fail result as a run with windows visible.
- **SC-006**: Stopping one background instance leaves every other running instance reachable
  and unaffected.
- **SC-007**: The plain default instance (no flags) launches with its window shown and
  focused, identical to the previous version.

## Assumptions

- Feature 012 is the foundation: the `--instance` identity, the single-instance lock, and
  the same-profile relaunch event are what the summon gesture builds on.
- An agent reaches a background instance over its MCP port exactly as it reaches a
  foreground one; nothing about the MCP surface, tool set, or handshake changes.
- macOS is the reference platform for Dock / app-switcher behaviour; the mechanism is not
  macOS-specific and the docs lead with macOS.
- The person always retains a way to view any instance (summon), so signing in and reviewing
  drafts remain possible. This feature is not, and must not become, headless automation.
- Process lifetime when the launching terminal closes is a property of the launch method
  (`open -na` detaches; a shell-foreground `electron .` does not); this feature does not
  change it.
- A page read or screenshot taken while a window is hidden returns the same content it would
  when visible; if a platform cannot capture a hidden window, the instance handles that
  internally without the person seeing a window.
- The test harness opts into the hidden-window behaviour through the same mechanism
  `--background` uses; it is not a separate code path.

## Dependencies

- **Feature 012 (multi-instance)** — `--instance`, the single-instance lock, the
  `second-instance` / same-profile relaunch handling, the window title and label. This
  feature **revises** feature 012's launch behaviour for named instances: they now show
  without taking focus (Clarification Q3), and the `second-instance` handler becomes the
  summon gesture (FR-007).
- **Feature 007 (MCP connection panel)** — not a dependency: Clarification Q2 landed
  launch-flag-only, so no connection/settings state changes.
- **The constitution** — the plan MUST cite Principle III (a hidden window is still "one
  window"; Dock-hiding is presentation) and Principle V (a summonable, human-supervised
  background instance is in bounds; fully-headless is the non-goal), and is expected to add
  a PATCH-level Amendment History entry.

## Follow-ups (out of scope — not blocking)

- A system tray / menu-bar presence listing running instances, with summon / quit from
  there.
- Auto-return-to-background on idle, or auto-background after a login is completed.
- A persisted "always background this instance" setting (Clarification Q2 kept this feature
  launch-flag-only).
- A keyboard shortcut or OS notification as an alternative summon gesture.
- Offscreen / true-headless rendering for unattended use — deliberately not pursued
  (Principle V).
