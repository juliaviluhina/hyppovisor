# Research: Async Selector Readiness for Page Reads

## Decision: Reuse the existing browser-context selector wait pattern

Readiness uses the same DOM-presence semantics as `wait_for_selector`: a selector is ready when
it matches an element, without inferring visibility, network idle, or application readiness. The
wait occurs immediately before the scoped read, which resolves the target again and avoids stale
element state.

**Rationale:** Matches the existing primitive and feature assumptions without cross-process polling.

**Alternatives considered:** Visibility or network-idle waits change semantics; Node polling adds
complexity and race windows.

## Decision: Make waiting opt-in and selector-dependent

Add an optional boolean readiness control only with `selector`, plus an optional positive
`timeoutMs`. Omitted timeout uses `config.defaultWaitMs` (10,000 ms by default, overridable by
`HYPPO_DEFAULT_WAIT_MS`).

**Rationale:** Existing callers retain immediate behavior and default timing; every blocking wait
is explicit and bounded.

**Alternatives considered:** Automatic waits alter compatibility and latency; unbounded waits
violate bounded-operation and pace requirements.

## Decision: Validate before waiting and never broaden failures

Invalid CSS follows the existing `INVALID_SELECTOR` path without waiting. A valid selector that
remains absent returns a distinct timeout error containing selector and timeout. No fallback read
is attempted.

**Rationale:** Errors are actionable and the reliability feature cannot become a privacy regression.

**Alternatives considered:** `TARGET_NOT_FOUND` loses timeout distinction; fallback broadens content.

## Decision: Preserve the existing result pipeline

After readiness succeeds, use the existing scoped path. Text, DOM, reduction, ancestor escalation,
exclusions, truncation, metadata, queue depth, and transient persistence behavior stay unchanged.

**Rationale:** The feature changes when the read starts, not what a successful read means.
