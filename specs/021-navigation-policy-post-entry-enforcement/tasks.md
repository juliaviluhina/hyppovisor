---

description: "Task list for post-entry navigation policy enforcement"
---

# Tasks: Post-Entry Navigation Policy Enforcement

**Input**: Design documents in `specs/021-navigation-policy-post-entry-enforcement/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/navigation-policy.md`, `quickstart.md`

**Tests**: Required by FR-009 and included before implementation tasks.

## Phase 1: Setup

**Purpose**: Confirm existing navigation and test seams before changing runtime behavior.

- [x] T001 Inspect existing tab-manager navigation, popup, feedback, and Electron test helpers in `src/main/tabs/tab-manager.ts`, `src/main/tabs/url-policy.ts`, `src/main/index.ts`, and `tests/integration/helpers.ts`; record any needed test seam in the implementation notes

## Phase 2: Foundational

**Purpose**: Establish deterministic local scenarios and the safe feedback contract.

- [x] T002 [P] Add deterministic allowed and script-navigation fixture pages plus the local redirect route in `tests/fixtures/navigation-policy-allowed.html`, `tests/fixtures/navigation-policy-script.html`, and `tests/integration/helpers.ts`
- [x] T003 [P] Add a focused unit-test seam or helper for evaluating navigation destinations and safe blocked feedback in `src/main/tabs/navigation-policy.ts` and `tests/unit/navigation-policy.test.ts`, without duplicating the URL allowlist

**Checkpoint**: Fixtures and test seams are ready; no runtime behavior has changed.

## Phase 3: User Story 1 - Keep navigations inside the approved boundary (Priority: P1) 🎯 MVP

**Goal**: Prevent disallowed redirect and page-script top-level navigation while preserving allowed navigation.

**Independent Test**: `npm run test:e2e -- navigation-policy` proves disallowed redirect/script destinations do not become active and allowed follow-on navigation succeeds.

### Tests for User Story 1

- [x] T004 [P] [US1] Add an integration test for a server redirect to a disallowed scheme/destination in `tests/integration/navigation-policy.spec.ts`, asserting the denied destination is not active and the original tab remains present
- [x] T005 [P] [US1] Add an integration test for script-triggered top-level navigation to a disallowed scheme/destination in `tests/integration/navigation-policy.spec.ts`, asserting the denied destination is not active and no tab is added
- [x] T006 [P] [US1] Add an integration test for an allowed follow-on `http`/`https` navigation in `tests/integration/navigation-policy.spec.ts`, asserting it completes in the existing tab

### Implementation for User Story 1

- [x] T007 [US1] Add a synchronous navigation-policy guard in `src/main/tabs/tab-manager.ts` that calls `validateUrl`, prevents invalid or disallowed main-frame `will-navigate` and `will-redirect` events, and leaves explicit `open`/`navigate` pre-validation unchanged
- [x] T008 [US1] Wire the guard for every embedded tab in `src/main/tabs/tab-manager.ts`, limiting it to main-frame events and avoiding child-window, subframe, same-document, and tab-teardown side effects
- [x] T009 [US1] Run `npm run test:e2e -- navigation-policy` and fix only regressions within the feature scope; confirm the P1 checkpoint

**Checkpoint**: Disallowed post-entry top-level navigation is blocked; allowed navigation and existing tab identity continue to work.

## Phase 4: User Story 2 - Make blocked navigation observable (Priority: P2)

**Goal**: Report blocked follow-on navigation through existing transient feedback without sensitive data.

**Independent Test**: A blocked navigation produces one policy-related warning, while credentials, tokens, cookies, and page content are absent.

### Tests for User Story 2

- [x] T010 [P] [US2] Cover safe blocked-navigation feedback formatting and absence of sensitive values in `tests/unit/navigation-policy.test.ts`; Chromium UI delivery remains covered by the existing notice path
- [x] T011 [P] [US2] Preserve existing allowed navigation and authentication-popup behavior through the focused integration coverage in `tests/integration/navigation-policy.spec.ts` and existing popup tests

### Implementation for User Story 2

- [x] T012 [US2] Extend the existing blocked-action event typing and forwarding in `src/main/tabs/tab-manager.ts` and `src/main/index.ts` to represent a navigation block without adding persistence or a new IPC channel
- [x] T013 [US2] Verify `src/renderer/app.ts` already renders the new navigation kind through the existing generic blocked-notice path; no renderer code change is needed

**Checkpoint**: Blocked post-entry navigation is visible and safe; existing feedback and popup behavior remain compatible.

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T014 [P] Run focused unit tests for URL-policy and navigation handling, including malformed and unsupported destinations, and record results in `specs/021-navigation-policy-post-entry-enforcement/quickstart.md`
- [x] T015 Run `npm test`, `npm run test:e2e`, `npm run lint`, and `npm run build`; resolve feature-caused failures and confirm no unrelated behavior regresses. Unit tests, focused E2E, lint, and build pass; full E2E has four pre-existing security-hardening connection-panel/close-all-tabs failures (401/request-state expectations).
- [x] T016 Run the automated equivalent of the scenarios in `specs/021-navigation-policy-post-entry-enforcement/quickstart.md` against the test app; manual visible-window walkthrough remains environment-dependent

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1) precedes all other phases.
- Foundational (Phase 2) depends on Setup and blocks user stories.
- User Story 1 (Phase 3) is the MVP and must complete before final validation.
- User Story 2 (Phase 4) depends on the guard from User Story 1 but may use parallel test writing.
- Polish (Phase 5) depends on both user stories.

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2; no dependency on US2.
- **US2 (P2)**: Starts after the US1 guard exists; reuses the existing feedback path.

### Parallel Opportunities

- T002 and T003 can run in parallel.
- T004, T005, and T006 can be written in parallel, then run after fixture setup.
- T010 and T011 can be written in parallel.
- T014 can run while documentation is reviewed, before the full-suite T015.

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete T001–T003.
2. Write T004–T006 and confirm they fail or exercise the missing guard.
3. Implement T007–T008.
4. Run T009 and stop for the P1 validation checkpoint.

### Incremental Delivery

1. Add the P1 guard and regression tests.
2. Add safe observability through the existing notice path.
3. Run the complete suite and manual quickstart.

## Notes

- No new URL allowlist, persistent storage, MCP field, or external action is permitted.
- The task list intentionally treats child-window popup policy as existing behavior, not a new deliverable.
