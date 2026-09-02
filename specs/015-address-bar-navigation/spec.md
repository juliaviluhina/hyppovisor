# Feature Specification: Address Bar Reflects and Navigates the Active Tab

**Feature Branch**: `015-address-bar-navigation`

**Created**: 2026-09-01

**Status**: Clarified (2026-09-01) — clarify session 2026-09-01 (1 Q: FR-006 new-tab affordance)

**Input**: User description: "Tier 2 follow-up to feature 014 — when a tab activates, its
URL is shown in the address input, and editing + Enter navigates that tab in place (like a
browser address bar) instead of always opening a new tab. Keep a way to open a new tab."

## Overview

Today HyppoVisor's address input is one-way and single-purpose: it is always empty (a
placeholder prompts for a URL), and pressing Enter or the → button always opens the typed
URL in a **new** tab. The field never shows what the active tab is pointing at, and there
is no way to re-point an existing tab from the chrome — an agent can `navigate`, a person
cannot.

This feature makes the address input behave like a normal browser address bar: it shows
the **active tab's current URL**, and editing it and pressing Enter **navigates that tab in
place**. Opening a new tab stays possible via an explicit affordance. The change is
entirely in the app's own chrome (renderer + one new IPC route to the existing
`TabManager.navigate`); it adds no browser capability that isn't already exposed to agents,
and "navigate" is already a permitted action under Constitution Principle I — no amendment.

## Clarifications

### Session 2026-09-01

- Q: Once Enter navigates the active tab in place, how does a person open a URL in a new tab instead? → A: A dedicated "+" new-tab button in the top bar (beside the address row); Enter and the → button both navigate the active tab in place.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The address bar shows the active tab's URL (Priority: P1)

A person has three tabs open. They click the second tab (or pick it from the tab
dropdown). The address input immediately shows that tab's current URL. They click the
third tab — the input updates to the third tab's URL. When the active tab follows a
redirect or an in-page navigation, the input tracks the new URL. When they close the last
tab, the input goes empty and shows its placeholder again.

**Why this priority**: This is the visible half of the request and is useful on its own —
even with no behaviour change to Enter, seeing "where is this tab" is the point of a
browser address bar. It is also the safe half (display only).

**Independent Test**: Open two tabs on different URLs, switch between them via the tab strip
and the dropdown, and confirm the address input shows the active tab's URL each time;
trigger a redirect in the active tab and confirm the input updates; close all tabs and
confirm the input clears.

**Acceptance Scenarios**:

1. **Given** two or more tabs are open, **When** the person makes a different tab active
   (tab strip, dropdown, or by closing the current one), **Then** the address input shows
   the now-active tab's current URL.
2. **Given** a tab is active, **When** that tab navigates on its own (redirect, in-page
   link, agent `navigate`), **Then** the address input updates to the tab's new URL.
3. **Given** exactly one tab is open, **When** the person closes it, **Then** the address
   input becomes empty and shows its placeholder.
4. **Given** the person has typed a URL into the address input and has not submitted it,
   **When** the active tab's URL changes in the background (redirect, in-page navigation,
   or an agent `navigate`) while the input still has keyboard focus, **Then** the person's
   typed text is left intact — the automatic refresh does not overwrite an edit in
   progress. (Activating a different tab moves focus out of the input first; see Edge
   Cases — an unsubmitted edit is not carried between tabs.)

---

### User Story 2 - Enter navigates the active tab in place (Priority: P1)

A person is on a job board list in the active tab and wants to jump to a specific posting
whose URL they have. They select the address input, replace the URL, and press Enter. The
**current tab** loads the new page — no new tab is created. The tab stays the active tab
and its entry in the tab strip / dropdown updates.

**Why this priority**: This is the behaviour people expect the moment the bar shows a URL;
without it the bar looks like a browser address bar but silently does something else
(opens a duplicate tab), which is worse than the status quo.

**Independent Test**: With one tab open, edit the address input and press Enter; confirm
the tab count is unchanged, the active tab now shows the new URL, and it is still the
active tab. Repeat using the → button and confirm it also navigates the active tab in
place (not a new tab).

**Acceptance Scenarios**:

1. **Given** a tab is active, **When** the person edits the address input and presses
   Enter, **Then** the active tab navigates to the entered URL in place and no new tab is
   created.
2. **Given** a tab is active, **When** the entered URL fails the URL policy (not http/https,
   etc.), **Then** the navigation is refused with a clear notice and the tab stays on its
   current page — same policy and messaging as opening a new tab.
3. **Given** a tab is active, **When** the entered URL is reachable but the load fails,
   **Then** the tab shows its failed-load state and a notice, exactly as a failed new-tab
   open does today.
4. **Given** no tab is open, **When** the person enters a URL and presses Enter, **Then**
   the URL opens in a new tab (unchanged from today).
5. **Given** a person-initiated navigation reaches a successfully loaded page, **When** it
   completes, **Then** the entered URL is added to the recent-URLs history, the same as a
   successful person-initiated new-tab open (feature 009).

---

### User Story 3 - Open a new tab even when a tab is active (Priority: P2)

A person has a tab open and wants a *second* tab rather than replacing the first. They
click the "+" new-tab button and the typed URL opens in a new tab, leaving the original
tab untouched.

**Why this priority**: Once Enter means "navigate the current tab", there must still be a
first-class way to open a new tab; but it is secondary to getting the primary behaviour
right, and a person can always close and reopen in the meantime.

**Independent Test**: With one tab open, enter a URL and click the "+" new-tab button;
confirm a second tab is created and activated while the first tab is unchanged.

**Acceptance Scenarios**:

1. **Given** a tab is active, **When** the person enters a URL and clicks the "+" new-tab
   button, **Then** a new tab is created with that URL and the previously active tab is
   unchanged.
2. **Given** no tab is open, **When** the person invokes any open/navigate action with a
   URL, **Then** a new tab is created (there is nothing to navigate).

---

### Edge Cases

- The address input is focused and empty while a tab is active: leaving it and pressing
  Enter with no text is a no-op (no navigation, no new tab).
- The active tab is mid-load when the person submits a new URL: the in-flight load is
  abandoned and the new URL is loaded (same as an agent `navigate` mid-load).
- A link-shim / redirect-interstitial URL is entered: it is unwrapped before loading, the
  same as `open_url` (feature 002).
- The person edits the URL, then clicks a different tab without submitting: the edit is
  discarded and the input shows the newly active tab's URL (an unsubmitted edit is not
  carried between tabs).
- Rapidly switching tabs: the input always ends on the finally-active tab's URL, with no
  stale value.
- The active tab's title changes but not its URL: the input does not flicker or change.

## Requirements *(mandatory)*

### Functional Requirements

#### Reflecting the active tab (User Story 1)

- **FR-001**: The address input MUST display the current URL of the active tab, updated
  when the active tab changes and when the active tab's own URL changes (redirect, in-page
  navigation, or an agent-driven `navigate`).
- **FR-002**: When no tab is open, the address input MUST be empty and show its placeholder.
- **FR-003**: An automatic update of the address input (from FR-001) MUST NOT overwrite
  text the person is currently editing — while the input has keyboard focus, its value is
  left as the person left it. The input resyncs to the active tab's URL once it loses
  focus (blur) without a submit.
- **FR-004**: The displayed value MUST be the tab's effective current URL (post-redirect),
  not the address originally entered to open it.

#### Navigating the active tab (User Story 2)

- **FR-005**: When a tab is active, submitting the address input — Enter or the → button —
  MUST navigate that tab to the entered URL in place, creating no new tab and keeping it
  the active tab.
- **FR-006**: A dedicated "open in a new tab" control — a "+" button in the top bar beside
  the address row — MUST open the entered URL in a new tab without disturbing the active
  tab. While a tab is active it is the only new-tab affordance (Enter and the → button
  navigate in place), and it MUST be present whenever the address row is. When no tab is
  active it behaves the same as submitting the input (FR-007).
- **FR-007**: When no tab is active, submitting the address input MUST open the entered URL
  in a new tab (unchanged from today).
- **FR-008**: A person-initiated navigation MUST be subject to the same URL policy,
  link-shim unwrapping, and refusal messaging as opening a new tab (features 001 / 002).
- **FR-009**: A failed person-initiated navigation MUST leave the tab in the same
  failed-load state and produce the same notice as a failed new-tab open; it MUST NOT
  silently create a new tab as a fallback.
- **FR-010**: A person-initiated navigation that reaches a successfully loaded page MUST be
  recorded in the recent-URLs history on the same terms as a successful person-initiated
  new-tab open (feature 009: person-initiated, reached "loaded", entered URL not landing
  URL).
- **FR-011**: The address input's placeholder / hint text MUST reflect the resolved
  behaviour — submitting re-points the active tab, and the "+" button opens a new tab (it
  currently reads "Enter opens a new tab").

#### Scope guard

- **FR-012**: This feature MUST NOT add any browser capability beyond what agents already
  have via MCP `navigate`; it exposes the existing `TabManager.navigate` to the person's
  own chrome and adds no new external action. No constitution amendment is required.

### Key Entities *(include if feature involves data)*

- **Active tab**: the one tab currently shown in the window (already defined by the app).
  The address input reflects and re-points this tab. No new persisted state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a person makes a tab active, the address input shows that tab's URL
  with no perceptible delay (≤ 200 ms, and before the next person action).
- **SC-002**: Editing the address input and pressing Enter with a tab active changes that
  tab's page and creates 0 new tabs — 0 occurrences in testing of an accidental new tab.
- **SC-003**: A URL a person is typing is never lost to an automatic address-bar refresh —
  0 occurrences in testing of typed text being overwritten.
- **SC-004**: With a tab active, a person can open a URL in a new tab in at most one action
  beyond entering the URL.
- **SC-005**: The address bar shows the post-redirect URL for a tab that followed a
  redirect within 1 s of the load settling.

## Assumptions

- "Navigate the active tab" reuses the existing `TabManager.navigate(tabId, url)` path that
  MCP `navigate` already uses; the only new plumbing is one IPC route + preload forwarder
  and renderer wiring. No change to the tab model or to `url-policy`.
- FR-006 resolved (clarify 2026-09-01): a dedicated **"+" new-tab button** is added to the
  top bar beside the address row; **Enter and the → button both navigate the active tab in
  place**. This matches browser behaviour — the address bar re-points the current tab, and a
  separate control makes new tabs.
- Recent-URLs behaviour (feature 009) treats a person-initiated navigate the same as a
  person-initiated open for history purposes; the new person-only navigate path fires the
  existing, unchanged `onPersonOpen` event — not a new store, and no change to the
  `onPersonOpen` handler itself.
- The tab dropdown and tab strip already re-render on tab URL/title changes; the address
  input hooks the same `tabs:changed` feed.
- Keyboard focus / selection behaviour of the input (e.g. select-all on focus) is a design
  detail settled at implementation time following existing conventions.

## Dependencies

- **Feature `001-open-any-url`** — the tab model, `TabManager.open` / `TabManager.navigate`,
  and the `url-policy` this feature reuses for person-initiated navigation.
- **Feature `002-unwrap-link-shims`** — link-shim unwrapping applied to the entered URL.
- **Feature `009-recent-urls-dropdown`** — the recent-URLs history a successful
  person-initiated navigation feeds (FR-010).
- **Feature `014-instance-management`** — ships the current top-bar layout this feature
  edits (the address row and the icon buttons beside it).
