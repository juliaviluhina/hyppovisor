# Feature Specification: Copy Instance Settings

**Feature Branch**: `028-copy-instance-settings`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "HyppoVisor runs in background mode with a bearer token I cannot retrieve from it. A second visible instance lists all running instances and can stop any of them. I want to copy the MCP settings (server name, endpoint, bearer token) for any listed instance, so I can connect an agent to a background instance I cannot see."

## Clarifications

### Session 2026-09-21

- Q: When the selected instance has token auth off and there is no token to copy, what should the copied settings contain? → A: Omit the token, note auth off; the block still connects verbatim.
- Q: When a sibling instance's profile files are unreadable, what should its row offer? → A: Row stays visible with a settings-unavailable note and no copy action; never fabricate settings.
- Q: When a listed sibling runs in stdio mode with no HTTP port, what should its copy action produce? → A: The stdio launch command and stdio JSON block for that row.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Copy a background instance's connection settings (Priority: P1)

The user runs a hidden (`--background`) instance holding signed-in tabs and wants an agent session connected to it. They summon any visible instance, open its instance list, pick the background instance, and copy its MCP settings — the same ready-to-paste command and JSON config block the Connection & MCP panel offers for the local instance, but parameterized for the selected one (its server name, its port, its token). They paste it into their agent client and connect.

**Why this priority**: This is the whole feature — without it, a background instance's token is reachable only by digging through profile files on disk.

**Independent Test**: Can be fully tested by launching two instances (one background with token auth on), opening the instance list in the visible one, copying the background instance's settings, and registering them in a fresh agent client that successfully lists tabs through the background instance.

**Acceptance Scenarios**:

1. **Given** a visible instance and a running background instance with token auth, **When** the user copies the background instance's settings from the list, **Then** the pasted settings register an agent client that reaches the background instance (not the visible one).
2. **Given** a copied command block, **When** the user runs it verbatim, **Then** it connects without hand-editing (correct server name, URL, port, and token included).
3. **Given** a copied JSON block, **When** the user installs it in a JSON-based client, **Then** it connects with the same fidelity.

---

### User Story 2 - Copy settings for any listed instance (Priority: P2)

The same copy action works for every row in the instance list — the current instance itself, foreground siblings, and background siblings — so there is exactly one place to get connection settings and no reason to open each instance's own panel.

**Why this priority**: Generalizes Story 1 from "background instances" to "any instance"; depends on Story 1's per-instance settings assembly.

**Independent Test**: Can be fully tested by copying settings from each listed row (self, foreground sibling, background sibling) and confirming each block names the right server and port.

**Acceptance Scenarios**:

1. **Given** three running instances, **When** the user copies settings from each row, **Then** each block carries that row's server name and port (no two blocks identical, none pointing at the wrong instance).
2. **Given** the user's own row, **When** they copy from the list, **Then** the result matches what the Connection & MCP panel shows (one source of truth, two doors).

---

### User Story 3 - Honest state for unreachable instances (Priority: P3)

An instance whose process died but whose runtime file lingers (or one that stopped responding) still shows its last-known settings, clearly marked as stale/unreachable, so the user can still recover the token or deliberately clean up — but never mistakes it for a live endpoint.

**Why this priority**: Guards against the primary failure mode of a multi-instance list (stale rows); depends on Stories 1–2.

**Independent Test**: Can be fully tested by killing an instance's process without cleanup, then confirming its row offers last-known settings labelled unreachable and its connect attempt fails fast.

**Acceptance Scenarios**:

1. **Given** a not-responding row, **When** the user copies its settings, **Then** the block is marked with the instance's last-known state and the row visibly reads unreachable.
2. **Given** a not-responding row, **When** the user tries the copied settings, **Then** the connection fails (the tool reports unreachable) rather than hanging or landing on a different instance.

---

### Edge Cases

- What happens when the selected instance has token auth off (no token to copy)? Copy works normally with the token omitted and a visible auth-off note — the block still connects verbatim.
- A sibling in stdio mode (no HTTP port) offers the stdio launch command and stdio JSON block instead of the HTTP variants.
- Sibling profile files unreadable (permissions, corruption, mid-write) keep a visible row with a settings-unavailable note and no copy action — settings are never fabricated.
- How does the list behave when the selected instance stops or changes port between listing and copying?
- What happens when two instances share a port (one failed to bind — "port in use" state)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST offer a copy action on every row of the instance list, producing that instance's MCP connection settings.
- **FR-002**: Copied settings MUST contain everything needed to connect verbatim: the instance's MCP server name, its endpoint URL (with effective port), and its bearer token when token auth is on.
- **FR-003**: Copied settings MUST be offered in both formats the Connection & MCP panel offers for the local instance: the shell command and the JSON config block, per row.
- **FR-004**: A sibling instance's bearer token MUST be shown and copied in full, like the local panel does — no masking, no reveal step. The panel is a local, same-user surface; shoulder-surfing protection is explicitly out of scope.
- **FR-005**: Rows for not-responding instances MUST still offer last-known settings, visibly marked unreachable, and MUST never present them as live.
- **FR-006**: Copying MUST NOT disturb any instance: no focus change, no relaunch, no settings rewrite, no new audit or log side effects beyond what the existing list view already does.
- **FR-007**: The current instance's own row MUST produce settings identical to its Connection & MCP panel (single source of truth).

### Key Entities *(include if feature involves data)*

- **Instance Row**: One running (or recently-run) HyppoVisor instance as shown in the list — label, mode (foreground/background), liveness (responding/not-responding), effective port.
- **Connection Settings Block**: The copyable per-instance payload — server name, endpoint URL, bearer token (when auth is on) — in each offered format.
- **Liveness State**: Whether the row's instance currently answers; gates whether settings are presented as live or last-known.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user connects an agent to a background instance using only list-copied settings, with no file digging and no edits to the pasted block, on the first attempt.
- **SC-002**: Copied settings from 3 simultaneously running instances each reach the correct instance (3/3), verified by distinct server names in the handshake.
- **SC-003**: A not-responding row's copied settings fail fast (no hang, no wrong-instance connection) in 5/5 trials.
- **SC-004**: Zero settings or state changes on any instance as a result of listing or copying (verified by file comparison before/after).

## Assumptions

- Constitution Principles I (copying settings performs no external act), III (no new stores — reads the existing per-instance runtime/settings files; no new UI surface beyond the list row action), IV (loopback MCP bearer token is displayable per amendment 1.3.1 — extended here to sibling instances of the same user on the same machine; to be confirmed in the plan's Constitution Check), and V (single-flight pacing untouched — copying issues no page loads) constrain the design; the plan MUST include a Constitution Check.
- The instance list of feature 014 (per-instance runtime files) plus each profile's persisted settings remain the only data sources — no new cross-instance channel, no querying a sibling over MCP (which would need its token first).
- The Connection & MCP panel's existing command and JSON formats are the template for per-instance blocks; the plan confirms the exact fields.
- Standing user requirement: new functionality MUST be covered by automated tests (unit plus integration where the repo's harness supports it). Manual-only verification is acceptable only for behavior that cannot be automated (e.g. paid third-party calls); everything else ships with tests.
