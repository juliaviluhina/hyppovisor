# Tasks: Lifecycle Error Handling and Invariant Failures

**Input**: Design documents from `/specs/022-lifecycle-error-handling-invariant-failures/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/lifecycle-status.md

**Tests**: Included because the feature explicitly requires failure-oriented unit and integration coverage.

## Phase 1: Setup

**Purpose**: Establish the feature contracts and test seams in the existing Electron project.

- [X] T001 [P] Add shared lifecycle status and failure classification types in src/shared/types.ts
- [X] T002 [P] Add lifecycle classification/state unit-test scaffold in tests/unit/lifecycle.test.ts

## Phase 2: Foundational

**Purpose**: Provide the in-memory health state and safe queue gate used by all stories.

- [X] T003 Implement LifecycleStateStore with operational/invariant transitions in src/main/lifecycle.ts
- [X] T004 Add normalized handling for non-Error thrown values in src/main/lifecycle.ts
- [X] T005 Add ActionQueue health gate and rejected outcome behavior in src/main/queue/action-queue.ts
- [X] T006 [P] Add lifecycle and queue unit coverage for transitions, deduplication, and gating in tests/unit/lifecycle.test.ts and tests/unit/action-queue.test.ts

## Phase 3: User Story 1 - See when the app is degraded (Priority: P1) 🎯 MVP

**Goal**: Surface a durable, human-readable degraded state through the existing connection panel and top-level notice.

**Independent Test**: Trigger an invariant transition through the app health seam and verify the renderer receives the status, displays the failure context, and clears it after healthy recovery.

- [X] T007 [P] [US1] Extend the lifecycle IPC contract and EffectiveConnection payload in src/shared/types.ts
- [X] T008 [US1] Wire LifecycleStateStore into main-process connection state and renderer push updates in src/main/index.ts
- [X] T009 [US1] Carry lifecycle status through the existing isolated connection event bridge in src/preload/chrome.cjs and src/main/index.ts
- [X] T010 [US1] Render degraded status, subsystem, message, and recovery guidance in src/renderer/app.ts and src/renderer/panel.ts
- [X] T011 [P] [US1] Add renderer-facing degraded-state rendering path in src/renderer/panel.ts and src/renderer/app.ts

## Phase 4: User Story 2 - Preserve safe lifecycle behavior (Priority: P1)

**Goal**: Classify startup bind, rebind, request, and shutdown failures deterministically while preserving safe healthy behavior.

**Independent Test**: Exercise HTTP server bind/rebind and close races with controlled server failures and assert lifecycle callbacks and request outcomes.

- [X] T012 [P] [US2] Add HTTP lifecycle event callbacks and deterministic request/close handling in src/main/mcp/server.ts
- [X] T013 [US2] Mark startup bind and rebind failures as degraded and restore healthy state after successful bind in src/main/index.ts
- [X] T014 [US2] Replace process-level log-only handlers with normalized lifecycle reporting in src/main/index.ts
- [X] T015 [P] [US2] Add HTTP lifecycle callback coverage through existing unit and integration suites in tests/unit/mcp-server.test.ts and tests/integration/connection-panel.spec.ts
- [X] T016 [P] [US2] Validate startup/rebind/shutdown behavior with npm run test:e2e

## Phase 5: User Story 3 - Protect queued tab actions (Priority: P2)

**Goal**: Ensure interrupted actions never appear successful and dependent work does not run against degraded state.

**Independent Test**: Inject a transport failure into a queued action, assert failed/interrupted completion, then assert a dependent action is rejected until recovery.

- [X] T017 [US3] Provide an explicit ActionQueue health gate for affected tab-action callers in src/main/queue/action-queue.ts
- [X] T018 [P] [US3] Add queued transport-failure and post-failure gating coverage in tests/unit/action-queue.test.ts
- [X] T019 [P] [US3] Add end-to-end queued-action failure scenario in tests/integration/interaction.spec.ts

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the complete feature and preserve existing safety/healthy-path behavior.

- [X] T020 [P] Update lifecycle comments and quickstart validation notes in specs/022-lifecycle-error-handling-invariant-failures/quickstart.md
- [X] T021 Run npm test and resolve lifecycle regression failures across tests/unit/
- [X] T022 Run npm run lint and npm run build; resolve feature-related diagnostics in src/ and tests/
- [X] T023 Run npm run test:e2e and verify all tasks satisfy the lifecycle specification in specs/022-lifecycle-error-handling-invariant-failures/spec.md

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 precedes Phase 2; Phase 2 blocks all user stories.
- US1 and US2 can proceed in parallel after Phase 2, but share src/main/index.ts and should be merged sequentially.
- US3 depends on the queue gate from Phase 2 and the lifecycle state wired by US1/US2.
- Polish depends on all desired stories.

### Parallel Opportunities

- T001 and T002 can run in parallel.
- T006, T011, T015, T016, T018, and T019 are parallel test/documentation tasks when their production seams exist.
- US1 and US2 are parallel at the conceptual level but have a shared main-process integration file.

### MVP Scope

Phase 1 + Phase 2 + Phase 3 (US1) provide the minimum visible degraded-state value; US2 is required for complete lifecycle correctness and US3 closes the queued-action safety gap.
