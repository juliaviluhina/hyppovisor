# Tasks: Read Page Ancestor Escalation and Exclusion

**Input**: Design documents from `/specs/023-read-page-ancestor-escalation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

## Phase 1: Setup

- [X] T001 Confirm the existing `read_page` schema, dispatch, result type, and test harness paths in `src/main/mcp/tools.ts`, `src/main/index.ts`, `src/shared/types.ts`, and `tests/`

## Phase 2: Foundational

- [X] T002 Define additive read-scope request and response types in `src/shared/types.ts`
- [X] T003 Extend the `read_page` MCP input validation and dispatch arguments in `src/main/mcp/tools.ts`
- [X] T004 Thread the optional scope arguments through the test handle in `src/main/index.ts`

## Phase 3: User Story 1 - Read context around a matched element (Priority: P1) 🎯 MVP

**Goal**: Resolve the first selector match, climb the requested number of element ancestors with
root clamping, and report the effective scope.

**Independent Test**: Unit and integration tests verify level zero, multi-level escalation,
first-match behavior, root clamping, validation, and scope metadata.

- [X] T005 [P] [US1] Add ancestor escalation script-builder tests in `tests/unit/read-page-ancestor-escalation.test.ts`
- [X] T006 [P] [US1] Add nested ancestor escalation fixture cases in `tests/integration/read-page.spec.ts`
- [X] T007 [US1] Implement effective-root ancestor walking and root-depth clamping in `src/main/page/read.ts`
- [X] T008 [US1] Preserve selector-scoped and unscoped compatibility while adding ancestor scope metadata in `src/main/page/read.ts`
- [X] T009 [US1] Validate non-negative integer levels and selector dependency at the MCP boundary in `src/main/mcp/tools.ts`

**Checkpoint**: User Story 1 independently returns the requested surrounding context and identifies
the effective ancestor level.

## Phase 4: User Story 2 - Trim unwanted descendants (Priority: P1)

**Goal**: Remove matching descendant subtrees from both text and DOM inside the effective root,
then apply existing reduction and truncation.

**Independent Test**: Tests verify multiple exclusions, unmatched selectors, invalid selectors,
root exclusion, scope boundaries, composition with escalation, and reduction.

- [X] T010 [P] [US2] Add exclusion and composition unit tests in `tests/unit/read-page-ancestor-escalation.test.ts`
- [X] T011 [P] [US2] Add exclusion acceptance cases and fixture markup in `tests/integration/read-page.spec.ts` and `tests/fixtures/read-page-ancestor-escalation.html`
- [X] T012 [US2] Implement cloned-subtree exclusion before text/DOM serialization in `src/main/page/read.ts`
- [X] T013 [US2] Map invalid exclusion and root-exclusion outcomes to existing clear errors in `src/main/page/read.ts`
- [X] T014 [US2] Add exclusion scope metadata while preserving `scopedTo` and `domReduced` compatibility in `src/main/page/read.ts`

**Checkpoint**: User Stories 1 and 2 work together without changing the live document or persisting
page content.

## Phase 5: Polish and Validation

- [X] T015 [P] Update the `read_page` contract comments and API documentation in `src/main/mcp/tools.ts` and `src/shared/types.ts`
- [X] T016 Run `npm test` and fix regressions in `src/main/page/read.ts`, `src/main/mcp/tools.ts`, or affected tests
- [X] T017 Run the scenarios in `specs/023-read-page-ancestor-escalation/quickstart.md`

## Dependencies and Execution Order

- T001 → T002 → T003 → T004
- T002–T004 block both user stories.
- T005/T006 precede T007/T008; T009 can complete alongside implementation once the schema exists.
- T010/T011 precede T012–T014.
- T015–T017 follow both stories.

## Parallel Opportunities

- T005 and T006 can run in parallel.
- T010 and T011 can run in parallel.
- T015 can run alongside final test execution once implementation is stable.

## Implementation Strategy

1. Complete the shared type/schema threading.
2. Deliver User Story 1 as the MVP and run its focused tests.
3. Add User Story 2, then run the full suite and quickstart scenarios.
