# Research: Lifecycle Error Handling and Invariant Failures

## Decision: Explicit normalized lifecycle status

- **Decision**: Represent health with a small in-memory status record containing state, failure class, subsystem, message, timestamp, and recovery guidance.
- **Rationale**: The renderer already receives `EffectiveConnection`; extending that contract avoids a second state channel and keeps status inspectable without persistence.
- **Alternatives considered**: Logging only (rejected because it is invisible to operators); a database or runtime file (rejected by Principle III and unnecessary for transient health).

## Decision: Operational versus invariant classification at boundaries

- **Decision**: Classify expected close races, request cancellation during intentional shutdown, and recoverable bind conflicts as operational; classify unexpected startup/rebind inability, transport failure during an action, and process-level uncaught failures as invariant/degraded.
- **Rationale**: Classification belongs where context is known. Generic process handlers should normalize unknown failures as invariant failures because they cannot prove recovery safety.
- **Alternatives considered**: Error-name heuristics globally (rejected as brittle); exiting for every error (rejected because known operational failures should not take down the app).

## Decision: Gate affected queued actions after degradation

- **Decision**: Add a queue health gate that rejects new work while degraded and lets the active task settle with its original failure.
- **Rationale**: This prevents unknown tab/server state from being compounded while preserving deterministic completion for work already in flight.
- **Alternatives considered**: Drain all queued work (rejected because state may be invalid); cancel active work forcibly (rejected because cancellation is not universally safe).

## Decision: Preserve existing transport bind-first rebind behavior

- **Decision**: Keep binding the replacement listener before closing the old one, but notify lifecycle state on failed rebind, request transport errors, and idempotent close completion.
- **Rationale**: Existing behavior protects a healthy listener during a failed rebind; the missing piece is visible health propagation.
- **Alternatives considered**: Close old listener first (rejected because it creates an avoidable outage); restart the whole process for every rebind error (rejected because the panel can report and recover from a later successful bind).
