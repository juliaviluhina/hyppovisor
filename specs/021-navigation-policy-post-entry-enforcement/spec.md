# Feature Specification: Post-Entry Navigation Policy Enforcement

**Feature Branch**: `021-navigation-policy-post-entry-enforcement`

**Created**: 2026-09-04

**Status**: Implemented

**Input**: `specs/issues/017-navigation-policy-post-entry-enforcement.md`

## User Scenarios & Testing

### User Story 1 - Keep navigations inside the approved boundary (Priority: P1)

As a person using an authenticated browser tab, I want navigation that happens after the
initial page load to remain subject to the same URL safety rules, so a redirect or page script
cannot move the tab to an unsupported or disallowed destination without being stopped.

**Why this priority**: The initial destination is already checked, but a later top-level
navigation can change the security boundary of the tab. Enforcing the rule at every top-level
navigation closes the gap without adding any new browsing capability.

**Independent Test**: Open an allowed page that attempts a top-level navigation to a disallowed
destination through a redirect and through page script. In both cases the disallowed navigation
does not complete, while an allowed follow-on navigation still completes normally.

**Acceptance Scenarios**:

1. **Given** an already-open tab on an allowed page, **When** the page redirects to a
   disallowed destination, **Then** the destination is blocked and the tab does not finish on
   that destination.
2. **Given** an already-open tab on an allowed page, **When** page script requests a top-level
   navigation to a disallowed destination, **Then** the destination is blocked and the tab does
   not finish on that destination.
3. **Given** an already-open tab on an allowed page, **When** it navigates to another allowed
   `http` or `https` destination, **Then** the navigation completes normally.
4. **Given** a navigation is blocked, **When** the tab remains available to the person, **Then**
   the existing tab identity and authenticated session remain usable.

### User Story 2 - Make blocked follow-on navigation observable (Priority: P2)

As a person supervising the browser session, I want a blocked follow-on navigation to be
reported through the existing activity or safety feedback, so I can understand why the page did
not move without exposing page credentials or content.

**Why this priority**: A silent block can look like a broken page. Existing safety feedback gives
the person a clear explanation while keeping the enforcement boundary independent of MCP callers.

**Independent Test**: Trigger a blocked redirect or script navigation and inspect the app's
existing activity/safety feedback. It identifies a blocked navigation and destination policy
failure without including credentials, cookies, or page body content.

**Acceptance Scenarios**:

1. **Given** a follow-on navigation is denied, **When** the app reports the event, **Then** the
   feedback identifies it as a blocked navigation and does not include sensitive session data.
2. **Given** a normal allowed navigation completes, **When** activity is inspected, **Then** the
   existing successful-navigation behavior remains unchanged.

### Edge Cases

- A redirect chain is checked at each top-level destination, not only at the original requested
  URL.
- A navigation event with a malformed or unsupported destination is denied safely and does not
  crash or detach the tab.
- Repeated blocked navigation attempts do not create an unbounded feedback loop or repeatedly
  open new tabs.
- Child-window policy remains governed by the existing popup and identity-provider rules; this
  feature does not broaden child-window behavior.
- A navigation initiated while a tab is closing is ignored or handled safely without producing a
  stale-tab failure.
- Allowed authentication-provider popup flows continue to work under their existing rules.

## Requirements

### Functional Requirements

- **FR-001**: Every top-level navigation in an embedded tab MUST be evaluated against the same
  destination policy used for an explicitly requested navigation.
- **FR-002**: The system MUST deny a top-level redirect whose destination violates the URL policy.
- **FR-003**: The system MUST deny a top-level navigation initiated by page script whose
  destination violates the URL policy.
- **FR-004**: The system MUST allow a top-level follow-on navigation when its destination
  satisfies the existing URL policy.
- **FR-005**: A denied follow-on navigation MUST leave the existing tab available and MUST NOT
  create a new tab or child window as a side effect.
- **FR-006**: A denied follow-on navigation MUST be surfaced through the existing activity or
  safety feedback channel with a concise policy-related reason.
- **FR-007**: Navigation feedback MUST NOT include bearer tokens, cookies, credentials, page
  content, or other session secrets.
- **FR-008**: The feature MUST preserve existing child-window and allowlisted authentication
  popup behavior.
- **FR-009**: Automated tests MUST cover disallowed redirects, disallowed script-triggered
  top-level navigation, allowed follow-on navigation, safe feedback, and lifecycle edge cases.

### Key Entities

- **Top-level navigation**: A change of the current embedded tab's main document, whether caused
  by an explicit request, redirect, or page script.
- **Destination policy decision**: The allow or deny result and safe reason produced when a
  navigation destination is evaluated.
- **Navigation feedback event**: Existing user-visible activity or safety information describing
  a blocked or allowed navigation without session secrets.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of tested disallowed redirect destinations are prevented from becoming the
  active top-level document.
- **SC-002**: 100% of tested disallowed script-triggered top-level destinations are prevented
  from becoming the active top-level document.
- **SC-003**: 100% of tested allowed follow-on `http` and `https` navigations complete without a
  new tab or regression to existing popup behavior.
- **SC-004**: Every tested blocked follow-on navigation produces one safe, policy-related
  feedback event and no sensitive values.
- **SC-005**: Existing navigation, popup, and authentication-popup regression tests remain
  passing after the enforcement is enabled.

## Assumptions

- The existing URL policy remains the source of truth; this feature does not introduce a second
  policy or new destination classes.
- “Top-level” means the current document of an existing embedded tab, not subresources such as
  images, scripts, or frames.
- Existing tab activity and blocked-action feedback are sufficient; no new persistent store or
  UI surface is required.
- A blocked navigation may remain on the current document or an intermediate safe document, but
  it must not complete on the denied destination.
- The feature number follows the repository's sequential Spec Kit numbering and fills the next
  available feature directory after 020.
