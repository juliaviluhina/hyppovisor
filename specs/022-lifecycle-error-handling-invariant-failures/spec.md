# Feature Specification: Lifecycle Error Handling and Invariant Failures

**Feature Branch**: `018-lifecycle-error-handling-invariant-failures`

**Created**: 2026-09-04

**Status**: Ready for planning

**Input**: User description: "Classify lifecycle errors as recoverable operational failures or invariant failures, surface degraded state in the app panel, and test startup/rebind/shutdown/queued-action failure paths."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See when the app is degraded (Priority: P1)

As a human using HyppoVisor, I can see a clear degraded-state indication when a lifecycle or transport failure may have made the app unreliable, so I know to stop relying on it and can restart or recover it.

**Why this priority**: Silent continuation after an invariant failure can make browser tabs or MCP actions appear healthy while producing unsafe or misleading results.

**Independent Test**: Trigger a classified invariant failure and verify the panel shows degraded state, the failure summary, and recovery guidance without requiring a separate log viewer.

**Acceptance Scenarios**:

1. **Given** the app is healthy, **When** an invariant failure is reported, **Then** the panel changes to a visibly degraded state and identifies that automation should not continue normally.
2. **Given** the app is degraded, **When** additional failures occur, **Then** the panel retains the original failure context and presents the latest relevant details without hiding the degraded state.
3. **Given** the app is degraded, **When** the app is restarted successfully, **Then** the degraded indication is cleared and the panel presents the healthy state.

### User Story 2 - Preserve safe lifecycle behavior (Priority: P1)

As an MCP client or operator, I receive a deterministic failure signal when the server cannot bind or rebind, while expected operational races during shutdown remain handled safely.

**Why this priority**: Lifecycle failures affect whether callers can trust the transport and must not be silently converted into a healthy-looking service.

**Independent Test**: Exercise startup bind failure, rebind failure, and shutdown during an in-flight request, then verify each outcome is classified and surfaced according to its safety impact.

**Acceptance Scenarios**:

1. **Given** the configured server address cannot be bound during startup, **When** startup completes, **Then** the app reports a failed/degraded lifecycle state with an actionable error and does not claim the server is ready.
2. **Given** a running server must rebind and the new bind fails, **When** the failure occurs, **Then** the previous healthy state is not silently asserted and the app exposes the degraded condition.
3. **Given** shutdown begins while a request is in flight, **When** the request completes or is interrupted, **Then** the request receives a deterministic result and expected shutdown races are not misclassified as invariant failures.

### User Story 3 - Protect queued tab actions (Priority: P2)

As an operator, I receive a visible and deterministic indication when transport failure interrupts a tab action in the shared queue, so I do not mistake an incomplete action for success.

**Why this priority**: A queued action that fails mid-flight can leave tab state uncertain and is especially risky when later actions continue as if nothing happened.

**Independent Test**: Start a queued tab action, inject a transport failure, and verify the action result, queue state, logs, and panel state all indicate the interruption.

**Acceptance Scenarios**:

1. **Given** a tab action is in progress, **When** its transport fails, **Then** the action is reported as failed or interrupted, never successful, and its error includes enough context for recovery.
2. **Given** an action has been interrupted by an invariant failure, **When** another action is submitted, **Then** it is rejected or held until the degraded condition is cleared rather than executed against unknown state.

### Edge Cases

- A non-Error rejection or thrown value is classified and displayed with a useful string representation.
- Multiple failures arrive nearly simultaneously; the UI remains responsive and does not create unbounded visible error entries.
- A server close/error event arrives after shutdown has already begun; the expected race is handled idempotently.
- A bind failure occurs because the address is temporarily occupied and recovery/rebind is attempted more than once.
- The renderer is unavailable while a failure occurs; logging and process-level state remain safe, and the next renderer load receives the current degraded state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST classify lifecycle and transport failures as either recoverable operational errors or invariant failures using explicit, testable classification rules.
- **FR-002**: Recoverable operational errors MUST remain observable in logs and MUST NOT automatically mark the app degraded when system invariants remain valid.
- **FR-003**: An invariant failure MUST transition the app into a degraded state that is observable by the renderer and MCP-facing lifecycle status.
- **FR-004**: The degraded state MUST include a human-readable summary, occurrence time, affected subsystem, and recovery guidance when available.
- **FR-005**: The system MUST NOT report the MCP server as ready when startup bind or rebind has failed.
- **FR-006**: Shutdown-related close and request races MUST be handled idempotently and MUST distinguish expected shutdown from unexpected transport failure.
- **FR-007**: A tab action interrupted by transport failure MUST resolve as failed or interrupted and MUST NOT be reported as successful.
- **FR-008**: After an invariant failure, new actions that depend on the affected subsystem MUST be rejected or held until the subsystem is healthy again.
- **FR-009**: A successful restart or explicit recovery MUST clear the degraded state only after the affected subsystem has been re-established and validated.
- **FR-010**: The system MUST preserve the existing human-only external-action boundary; error handling MUST NOT submit forms, send messages, authenticate, or otherwise perform an external act.
- **FR-011**: The system MUST provide automated coverage for startup bind failure, rebind failure, shutdown during an in-flight request, and transport failure during a queued tab action.

### Key Entities

- **Lifecycle status**: The current health state of the app and MCP transport, including healthy, stopping, stopped, or degraded.
- **Failure classification**: A normalized failure record containing category, subsystem, message, time, and whether recovery is possible.
- **Queued action outcome**: The terminal result of a tab action, including success, failure, or interruption and its associated failure context.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of tested startup bind and rebind failures produce a non-ready/degraded status and an actionable visible error.
- **SC-002**: 100% of tested transport failures during queued tab actions produce a non-success outcome and prevent dependent actions from silently proceeding while degraded.
- **SC-003**: 100% of tested expected shutdown races complete without an unhandled process error or false invariant-failure alarm.
- **SC-004**: A human can identify that the app is unsafe to rely on and the recommended recovery action from the panel within 10 seconds of viewing it.
- **SC-005**: Existing healthy startup, normal request completion, and clean shutdown tests continue to pass without new user-visible warnings.

## Assumptions

- The app panel is the primary human-facing surface for lifecycle health; no new window or persistent database is needed.
- The existing logging and MCP lifecycle interfaces can be extended while preserving compatible healthy-path behavior.
- Restarting the Electron app is an acceptable recovery path for failures that cannot be safely repaired in place.
- Tests may use controlled fakes or injected failures; production behavior must remain deterministic without test-only recovery shortcuts.
- The feature does not change browser navigation, tab interaction permissions, credentials, or data-directory persistence.
