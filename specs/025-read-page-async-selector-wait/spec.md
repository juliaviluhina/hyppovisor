# Feature Specification: Async Selector Readiness for Page Reads

**Feature Branch**: `020-read-page-async-selector-wait-auth-panel`
**Created**: 2026-09-08
**Status**: Draft
**Input**: User description: `specs/issues/020-read-page-async-selector-wait-and-auth-panel-exposure.md`

## User Scenarios & Testing

### User Story 1 - Wait for scoped content before reading (Priority: P1)

An orchestrator reading a client-rendered page can request a positive content selector and an
opt-in wait, then receive that scoped content once the page renders it without making a separate
wait call.

**Why this priority**: Async rendering currently makes the privacy-preserving positive-selector
path race-prone and pushes callers toward broad reads.

**Independent Test**: Open a fixture that inserts the target element after a delay and call the
page-read capability with the selector and wait option. Confirm the read succeeds after insertion.

**Acceptance Scenarios**:

1. **Given** a selector target appears before the configured timeout, **When** a caller requests
   an opted-in waiting scoped read, **Then** the read waits and returns only the target content.
2. **Given** the selector target does not appear before the configured timeout, **When** the
   caller requests an opted-in waiting scoped read, **Then** the call fails with a clear timeout
   that identifies the missing selector and does not return an unscoped read.
3. **Given** a caller omits the opt-in wait, **When** the selector is not present, **Then** the
   existing immediate target-not-found behavior remains unchanged.

### User Story 2 - Preserve safe, explicit read boundaries (Priority: P1)

An orchestrator can rely on a waited positive selector to keep persistent authenticated-page
chrome, feeds, and private side-panel content outside the returned context.

**Why this priority**: The issue is a privacy surface as well as a reliability issue; failure to
find the positive target must never silently broaden the read.

**Independent Test**: Use a fixture containing a delayed content pane and a persistent private
panel. Read with the delayed pane selector and wait enabled, then verify panel text is absent.

**Acceptance Scenarios**:

1. **Given** a delayed target and persistent side panel, **When** the waited scoped read succeeds,
   **Then** the result contains target content and no side-panel or unrelated page content.
2. **Given** a positive selector and a timeout failure, **When** the call returns an error, **Then**
   it never falls back to `exclude`-only or full-page content.
3. **Given** an exclude-only or unscoped read, **When** it is used without a positive selector,
   **Then** existing behavior remains available and the tool description warns that it is not a
   privacy guarantee for authenticated pages.

### Edge Cases

- Invalid selectors fail as invalid-selector errors without waiting or broadening the read.
- A zero or negative timeout is rejected clearly; omitted timeout uses the documented default.
- A target removed before the read completes is treated as a target-not-found/timeout failure,
  never as permission to read the page body.
- Existing text, DOM, truncation, title, URL, and timestamp behavior remains unchanged apart
  from the explicit readiness wait.

## Requirements

### Functional Requirements

- **FR-001**: The page-read capability MUST accept an optional opt-in readiness-wait control for
  a supplied positive selector.
- **FR-002**: When readiness waiting is enabled, the capability MUST wait for the positive target
  to exist before collecting the scoped read.
- **FR-003**: The capability MUST accept an optional timeout in milliseconds for the readiness
  wait and MUST apply a documented default when omitted.
- **FR-004**: A readiness timeout MUST return a distinct, actionable error naming the selector
  and timeout; it MUST NOT return unscoped or exclude-only content.
- **FR-005**: Invalid selectors MUST fail immediately with the existing invalid-selector behavior.
- **FR-006**: Omitting readiness waiting MUST preserve current immediate selector behavior.
- **FR-007**: A successful waited read MUST apply the existing positive selector boundary to all
  requested outputs, including text and optional DOM content.
- **FR-008**: Unscoped and exclude-only reads MUST retain their current behavior; documentation
  MUST state that exclude-only reads are not a safe way to omit sensitive authenticated-page
  regions.
- **FR-009**: The capability MUST never fall back from a failed positive selector to a broader
  read within the same call.
- **FR-010**: Existing read metadata, truncation, verbatim ordering, and persistence behavior
  MUST remain unchanged.

### Key Entities

- **Read Request**: A page-read request containing the optional positive selector, readiness-wait
  flag, timeout, reduction options, and existing read options.
- **Scoped Read Result**: The existing page-read payload whose outputs are bounded by the positive
  selector and whose failure states distinguish invalid, missing, and timed-out targets.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A delayed selector target that appears within its configured timeout is successfully
  read in 100% of deterministic fixture runs.
- **SC-002**: A target absent through the timeout produces a clear failure in 100% of runs, with
  zero fallback responses containing broader page content.
- **SC-003**: Successful scoped reads exclude fixture side-panel text in 100% of runs,
  regardless of side-panel size.
- **SC-004**: Existing callers that omit the new option pass the existing read test suite with no
  changed response fields or default timing behavior.

## Assumptions

- Waiting is opt-in and applies only when a positive selector is supplied.
- A selector wait observes DOM presence, matching the existing wait-for-selector primitive; it
  does not infer visibility or application readiness.
- The default timeout is bounded and documented so a caller cannot create an unbounded wait.
- Named exclude presets/content-only behavior is out of scope; the immediate privacy guarantee is
  the positive-selector path and its no-broadening failure behavior.
- Existing selector scoping, reduction, ancestor escalation, and truncation semantics are reused.
