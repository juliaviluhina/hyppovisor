# Data Model: Lifecycle Error Handling and Invariant Failures

## LifecycleStatus

- `state`: `healthy | degraded | stopping | stopped`
- `failure`: nullable `FailureClassification`
- `updatedAt`: ISO timestamp

Healthy means the configured transport is ready (or stdio is connected). Degraded means callers must not assume dependent actions are safe. Stopping/stopped are intentional lifecycle states.

## FailureClassification

- `kind`: `operational | invariant`
- `subsystem`: `process | http-bind | http-transport | queue | tab-action`
- `message`: human-readable normalized message
- `at`: ISO timestamp
- `recoverable`: boolean
- `guidance`: human-readable recovery instruction

## QueuedActionOutcome

- `outcome`: `success | failed | interrupted | rejected`
- `message`: optional failure context
- `queueDepth`: existing queue-depth observation

Invariant failures transition the lifecycle to degraded. Operational failures are logged and may leave lifecycle state healthy. A successful startup/rebind explicitly transitions back to healthy.
