# Tasks: Copy Instance Settings

**Input**: Design documents from `/specs/028-copy-instance-settings/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included throughout per standing user requirement (automated coverage for all new functionality; manual-only where automation is impossible). Unit via `vitest run`, e2e via `playwright test`.

**Organization**: Tasks grouped by user story; each story independently implementable and testable after Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align on panel/registry precedents before writing code

- [X] T001 Survey `src/renderer/panel.ts` instance list rendering + `src/renderer/snippets.ts` builders and record per-row reuse points in `specs/028-copy-instance-settings/research.md` (append, don't rewrite)
- [X] T002 [P] Survey `src/main/instances/registry.ts` discovery and `src/main/settings.ts` token/port resolution; note sibling-settings read points in the same research appendix

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types and per-row settings assembly that all stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Add `RowSettings` / `SettingsBlocks` types in `src/shared/types.ts`
- [X] T004 Implement sibling settings read (runtime + settings files, unreadable ⇒ unavailable) in `src/main/instances/registry.ts` (or adjacent module per plan)
- [X] T005 Implement per-row `SnippetState` assembly (server-name derivation, auth-off omission, stdio variant) reusing `src/renderer/snippets.ts` builders
- [X] T006 [P] Unit tests for assembly: HTTP+auth, auth-off, stdio, server names, corrupt/unreadable files in `tests/unit/instance-settings-copy.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Copy a background instance's connection settings (Priority: P1) 🎯 MVP

**Goal**: Copy command + JSON from a background instance's list row; pasted settings connect verbatim

**Independent Test**: Quickstart Scenario 1 (two instances, register copied blocks in a fresh client, reach the background instance first try)

### Tests for User Story 1

- [X] T007 [P] [US1] Unit tests for block contents (endpoint URL, header presence, server-name match, JSON parses) in `tests/unit/instance-settings-copy.test.ts`
- [X] T008 [P] [US1] E2E: copy sibling row blocks and prove the JSON reaches the sibling instance in `tests/integration/instance-settings-copy.spec.ts`

### Implementation for User Story 1

- [X] T009 [P] [US1] Add per-row copy buttons (command + JSON) to the instance list in `src/renderer/panel.ts`
- [X] T010 [US1] Wire row buttons to clipboard via the assembled blocks in `src/renderer/panel.ts` (depends on T005, T009)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Copy settings for any listed instance (Priority: P2)

**Goal**: Every row (self, foreground, background siblings) copies correctly; own row matches the panel

**Independent Test**: Quickstart Scenario 2 (3 instances, distinct server names/ports, own row byte-identical to panel)

### Tests for User Story 2

- [X] T011 [P] [US2] Unit test: own-row assembly equals panel assembly for identical input in `tests/unit/instance-settings-copy.test.ts`
- [X] T012 [P] [US2] E2E: three instances, each row's blocks reach the right instance in `tests/integration/instance-settings-copy.spec.ts`

### Implementation for User Story 2

- [X] T013 [US2] Generalize row assembly beyond background rows (self + foreground siblings) in `src/main/instances/registry.ts` (or adjacent module)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Honest state for unreachable instances (Priority: P3)

**Goal**: Not-responding rows offer marked last-known settings; unreadable rows offer no copy

**Independent Test**: Quickstart Scenario 3 (killed process ⇒ marked unreachable + fast failure; unreadable profile ⇒ settings-unavailable row)

### Tests for User Story 3

- [X] T014 [P] [US3] Unit tests for unreachable marking and unavailable rows in `tests/unit/instance-settings-copy.test.ts`
- [X] T015 [P] [US3] E2E: killed sibling shows marked last-known blocks that fail fast in `tests/integration/instance-settings-copy.spec.ts`

### Implementation for User Story 3

- [X] T016 [US3] Render unreachable/unavailable row states with marked blocks (or no copy) in `src/renderer/panel.ts`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Docs, consistency, and end-to-end validation

- [X] T017 [P] Document per-row copy in the connection-panel docs (`docs/` connection guide) and the instance-management contract amendment
- [X] T018 [P] Extend `tests/unit/connection-snippets.test.ts` if new builder variants were added
- [X] T019 Run `npm test`, `npm run lint`, `npx playwright test instance-settings-copy`, and quickstart.md Scenarios 1–4; fix fallout
- [X] T020 Checksum side-effect proof (quickstart Scenario 4) as an automated e2e assertion if feasible, else documented manual run

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Generalizes US1's row assembly but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Adds row states to US1/US2 surfaces but independently testable

### Within Each User Story

- Tests SHOULD be written and FAIL before implementation (repo convention)
- Assembly/types before panel wiring
- Story complete before moving to next priority

### Parallel Opportunities

- T002 runs in parallel with T001 (append-only research notes)
- T006 runs in parallel with T003–T005 (test file vs source files)
- T007 + T008 run in parallel; T009 runs in parallel with both
- T011 + T012 run in parallel
- T014 + T015 run in parallel
- T017 + T018 run in parallel (different files)

---

## Parallel Example: User Story 1

```bash
# Launch tests + panel work together (different files):
Task: "Unit tests for block contents in tests/unit/instance-settings-copy.test.ts" (T007)
Task: "E2E sibling-row proof in tests/integration/instance-settings-copy.spec.ts" (T008)
Task: "Per-row copy buttons in src/renderer/panel.ts" (T009)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently (quickstart Scenario 1)
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Demo (MVP!)
3. Add User Story 2 → Test independently → Demo
4. Add User Story 3 → Test independently → Demo
5. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Standing rule: automated tests for all new functionality (T020 must first attempt automation; documented manual run only if infeasible)
