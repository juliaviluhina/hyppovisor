---

description: "Dependency-ordered implementation tasks for async selector readiness"
---

# Tasks: Async Selector Readiness for Page Reads

**Input**: Design documents from `/specs/025-read-page-async-selector-wait/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, and the project constitution

**Tests**: Required by the feature's independent test criteria and quickstart validation scenarios.

**Organization**: Tasks are grouped by user story. User Story 1 establishes the opt-in readiness behavior; User Story 2 verifies that successful and failed positive-selector reads preserve explicit privacy boundaries.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the existing MCP/page-read and test locations before changing the feature path.

- [X] T001 Inspect the existing `read_page` request schema, dispatch path, and error constants in `src/main/mcp/tools.ts` and `src/main/errors.ts`
- [X] T002 Inspect existing selector validation, scoped-read, queue, and default-wait behavior in `src/main/page/read.ts` and `src/main/config.ts`
- [X] T003 [P] Inspect current unit and Electron integration read fixtures and test helpers in `tests/unit/read-page-selector.test.ts`, `tests/integration/read-page.spec.ts`, and `tests/fixtures/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the shared contract and test fixture prerequisites without changing source behavior.

**Checkpoint**: Existing read behavior and the bounded sequential wait assumptions are understood and testable before story implementation begins.

- [X] T004 Document the `waitForSelector` and `timeoutMs` request validation, default timeout, and no-broadening error expectations in `specs/025-read-page-async-selector-wait/contracts/read-page-async-selector-wait.md`
- [X] T005 [P] Add deterministic delayed-target and persistent-private-panel fixture markup under `tests/fixtures/`
- [X] T006 [P] Add shared test setup for controlled target insertion timing and selected-tab read requests in `tests/unit/read-page-selector.test.ts` and `tests/integration/read-page.spec.ts`

---

## Phase 3: User Story 1 - Wait for Scoped Content Before Reading (Priority: P1)

**Goal**: Allow an explicit positive-selector read to wait for DOM presence, then return the existing scoped result without requiring a separate wait call.

**Independent Test**: A delayed target read with `waitForSelector: true` succeeds after insertion; an absent target produces an actionable timeout; omitting the option preserves immediate `TARGET_NOT_FOUND`.

### Tests for User Story 1

- [X] T007 [P] [US1] Add unit coverage for `waitForSelector` requiring `selector`, positive-integer `timeoutMs`, omitted-timeout defaulting, and invalid-selector/invalid-timeout validation in `tests/unit/read-page-selector.test.ts`
- [X] T008 [P] [US1] Add integration coverage for delayed selector success, readiness timeout naming the selector and timeout, and immediate missing-target behavior when waiting is omitted in `tests/integration/read-page.spec.ts`

### Implementation for User Story 1

- [X] T009 [US1] Extend the `read_page` MCP input schema, tool description, and dispatch validation for `waitForSelector` and `timeoutMs` in `src/main/mcp/tools.ts`
- [X] T010 [US1] Implement selector-dependent bounded DOM-presence waiting immediately before the existing scoped read, reusing `config.defaultWaitMs` when omitted, in `src/main/page/read.ts`
- [X] T011 [US1] Add distinct readiness-timeout error construction and mapping that includes the selector and effective timeout in `src/main/errors.ts` and `src/main/page/read.ts`
- [X] T012 [US1] Preserve the existing immediate scoped-read path and unchanged `PageReadResult` shape while wiring the readiness path through the existing queue/dispatch flow in `src/main/mcp/tools.ts` and `src/main/page/read.ts`

**Checkpoint**: User Story 1 is independently functional: delayed positive-selector reads wait and succeed, bounded failures are actionable, and legacy immediate reads remain unchanged.

---

## Phase 4: User Story 2 - Preserve Safe, Explicit Read Boundaries (Priority: P1)

**Goal**: Ensure waited positive-selector reads remain scoped to the target and never broaden on timeout, while unscoped and exclude-only behavior remains available with an explicit warning.

**Independent Test**: A delayed target read excludes persistent side-panel text; a timeout returns no payload and no broader content; unscoped and exclude-only reads retain their existing behavior and documentation warning.

### Tests for User Story 2

- [X] T013 [P] [US2] Add unit assertions that successful waited reads preserve positive-selector scoping across text, optional DOM, reduction, ancestor escalation, truncation, and metadata outputs in `tests/unit/read-page-selector.test.ts`
- [X] T014 [P] [US2] Add integration assertions that delayed target results exclude persistent private-panel content and timeout responses contain no full-page or exclude-only fallback content in `tests/integration/read-page.spec.ts`
- [X] T015 [P] [US2] Add regression coverage for unscoped and exclude-only reads, including the authenticated-page privacy warning in the MCP tool description, in `tests/integration/read-page.spec.ts`

### Implementation for User Story 2

- [X] T016 [US2] Ensure readiness failure exits before result collection and cannot invoke an exclude-only or unscoped fallback in `src/main/page/read.ts`
- [X] T017 [US2] Ensure the successful readiness path reuses the existing positive-selector boundary for text and optional DOM without changing `src/shared/types.ts` in `src/main/page/read.ts`
- [X] T018 [US2] Update the `read_page` tool description to state that exclude-only reads are not a privacy guarantee for authenticated pages in `src/main/mcp/tools.ts`

**Checkpoint**: Both P1 stories are independently functional and preserve the constitution's verbatim, transient, human-paced read and privacy-boundary requirements.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validate compatibility, documentation, and the complete feature workflow.

- [X] T019 [P] Run the existing read-page unit suite and verify callers omitting readiness options retain response fields and default timing behavior in `tests/unit/read-page-selector.test.ts`
- [X] T020 [P] Run the complete read-page Electron integration scenarios, including the quickstart delayed-target, timeout, immediate-missing, and invalid-CSS cases in `tests/integration/read-page.spec.ts`
- [X] T021 Update feature validation notes and command expectations to match the implemented behavior in `specs/025-read-page-async-selector-wait/quickstart.md`
- [X] T022 Review the final implementation against the constitution and confirm no page content persistence, external action, credential handling, new service, or unbounded wait was introduced in `specs/025-read-page-async-selector-wait/plan.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T003 can run in parallel with T001-T002.
- **Foundational (Phase 2)**: Depends on Phase 1; T005-T006 can run in parallel after the existing test structure is identified.
- **User Stories (Phases 3-4)**: Depend on Phase 2. US1 should be completed before US2 because US2 validates the readiness path's boundary behavior.
- **Polish (Phase 5)**: Depends on both user stories; T019-T020 can run in parallel, followed by documentation and constitution review.

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Foundational. No dependency on another user story.
- **User Story 2 (P1)**: Depends on Foundational and the readiness path from US1 (T009-T012); it remains independently testable once that shared capability exists.

### Within Each User Story

- Write and run the story tests before implementation tasks where practical.
- Validate request/error contracts before changing the page-read path.
- Keep the readiness wait before the existing scoped collection pipeline.
- Complete the story checkpoint before starting the next story's implementation.

### Parallel Opportunities

- T003, T005, and T006 are parallel investigation/setup work once their prerequisite paths are known.
- T007 and T008 can be written in parallel.
- T013, T014, and T015 can be written in parallel after US1 behavior is available.
- T019 and T020 can run in parallel during polish.
- US2 test preparation can proceed in parallel with US1 implementation, but US2 execution depends on the completed readiness path.

## Parallel Example: User Story 1

```text
Task T007: Unit validation tests in tests/unit/read-page-selector.test.ts
Task T008: Delayed-target integration tests in tests/integration/read-page.spec.ts
```

## Parallel Example: User Story 2

```text
Task T013: Scoped result unit assertions in tests/unit/read-page-selector.test.ts
Task T014: Privacy-boundary integration assertions in tests/integration/read-page.spec.ts
Task T015: Unscoped/exclude-only regression assertions in tests/integration/read-page.spec.ts
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup and Foundational phases.
2. Add failing unit and integration coverage for opt-in waiting and timeout behavior.
3. Implement the schema, bounded wait, timeout error, and unchanged scoped-read pipeline.
4. Validate the User Story 1 checkpoint independently.

### Incremental Delivery

1. Deliver US1 as the opt-in async-read MVP.
2. Add US2 privacy-boundary and no-broadening regression coverage.
3. Run the full quickstart and existing read-page suites.
4. Confirm the final change remains transient, sequential, and compatible with existing callers.

## Task Count

Total: 22 tasks

- User Story 1: 6 tasks
- User Story 2: 6 tasks
- Setup: 3 tasks
- Foundational: 3 tasks
- Polish: 4 tasks
