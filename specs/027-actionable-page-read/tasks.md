# Tasks: Actionable Page Read

**Input**: Design documents from `/specs/027-actionable-page-read/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included as unit/contract tasks per repo convention (every feature ships `tests/unit/` coverage; live Jev stays manual-only per research.md R6).

**Organization**: Tasks grouped by user story; each story independently implementable and testable after Foundational.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align on collector precedents and fixtures before writing code

- [X] T001 Survey `src/main/page/form-fields.ts` collector + `src/main/safety/blocklist.ts` verdict functions and record reuse points in `specs/027-actionable-page-read/research.md` (append, don't rewrite)
- [X] T002 [P] Add local fixture pages for snapshot scenarios in `tests/fixtures/actionable/` (content-heavy page, form with submit + credential controls, pure-article page, oversized page)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, caps, and generation token that all stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Add `ActionableElement`, `VisibleTextExtract`, `RelevanceRanking`, `RankingStatus`, `OmissionRecord`, `ActionableSnapshot` types in `src/shared/types.ts`
- [X] T004 [P] Add env-overridable caps (`HYPPO_ACTIONABLE_ELEMENT_CAP`, `HYPPO_ACTIONABLE_TEXT_BYTES`, `HYPPO_ACTIONABLE_MAX_BYTES`) in `src/main/config.ts`
- [X] T005 Implement atomic snapshot generation token (URL + DOM fingerprint) in `src/main/page/actionable.ts` (token helper only; collector follows in US1)
- [X] T006 [P] Unit tests for types/caps/token defaults in `tests/unit/actionable.test.ts` (skeleton extended per story)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Compact actionable snapshot (Priority: P1) 🎯 MVP

**Goal**: `read_actionable` without `goal` returns the indexed table + budgeted text in one call

**Independent Test**: Quickstart Scenario 1 + 4 (single call replaces two reads at ≤ half size; determinism 10/10; empty and oversized pages handled with explicit omissions)

### Tests for User Story 1

- [X] T007 [P] [US1] Contract test for unranked `read_actionable` shape in `tests/unit/mcp-tools.test.ts`
- [X] T008 [P] [US1] Unit tests for visibility/viewport filtering, accessible-name labels, omission accounting in `tests/unit/actionable.test.ts`

### Implementation for User Story 1

- [X] T009 [P] [US1] Implement isolated-world snapshot collector (controls + visible text + omission counts) in `src/main/page/actionable.ts`
- [X] T010 [US1] Implement payload assembly (table, text extract, truncation markers, generation token) in `src/main/page/actionable.ts` (depends on T009)
- [X] T011 [US1] Register `read_actionable` tool + extend `TOOL_NAMES` in `src/main/mcp/tools.ts` (unranked path only; `goal` rejected as unknown-for-now or ignored per contract)
- [X] T012 [US1] Document the tool row in `docs/tools.md` ("Eight" → nine)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Goal-ranked targets (Priority: P2)

**Goal**: With `goal` + `TYPESAFE_API_KEY`, the same call adds Jev relevance ordering; failures stay in-payload, never thrown

**Independent Test**: Quickstart Scenario 2 (first-rank accuracy sample, unsatisfiable-goal low-confidence ordering, missing-key and network-blocked statuses, no throws)

### Tests for User Story 2

- [X] T013 [P] [US2] Unit tests for ranking-status mapping (missing key / 401 / 429-then-success / retries-exhausted / malformed response) with stubbed network in `tests/unit/actionable.test.ts`
- [X] T014 [P] [US2] No-throw guarantee test (every ranking failure returns a success payload with status) in `tests/unit/actionable.test.ts`

### Implementation for User Story 2

- [X] T015 [P] [US2] Implement single-Choice Jev ranking call with bounded 429/529/503 retries in `src/main/ranking/jev.ts`
- [X] T016 [US2] Wire `goal` through `read_actionable` to ranking with status mapping in `src/main/mcp/tools.ts` (depends on T015)
- [X] T017 [US2] Document `TYPESAFE_API_KEY` in `docs/configuration.md`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Draft-safe preparation flow (Priority: P3)

**Goal**: Snapshot indices work with `interact` under unchanged refusals; stale indices reject safely

**Independent Test**: Quickstart Scenario 3 (refused markers refuse, credential values omitted, post-navigation stale rejection, zero bypasses)

### Tests for User Story 3

- [X] T018 [P] [US3] Unit tests for index→target resolution and stale-generation rejection in `tests/unit/interact.test.ts`
- [X] T019 [P] [US3] Refused-marker verdict agreement test (snapshot markers vs `interact` verdicts) in `tests/unit/actionable.test.ts`

### Implementation for User Story 3

- [X] T020 [US3] Implement index resolution with live re-validation (connected, visible, enabled, same role/label) in `src/main/page/interact.ts` (depends on T005)
- [X] T021 [US3] Attach refused markers via shared blocklist verdicts in `src/main/page/actionable.ts` (depends on T009)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Contract registration ripple, docs, and end-to-end validation

- [X] T022 [P] Amend `specs/001-open-any-url/contracts/mcp-tools.md` with the `read_actionable` contract
- [X] T023 [P] Update tool list in `skills/hyppovisor/SKILL.md` and connection-panel About text + `tests/unit/connection-snippets.test.ts`
- [X] T024 [P] Clarify refused-marker semantics in `docs/safety.md` if the safety review asks for it
- [X] T025 Run `npm test`, `npm run lint`, and `quickstart.md` Scenarios 1–4; fix fallout
- [X] T026 Manual live-Jev ranking check once (paid API, unrecorded) per research.md R6 — done 2026-09-21 vs test-027 instance: status ok, correct top pick (conf 0.95), stale rejection verified
- [X] T027 Integration spec `tests/integration/actionable.spec.ts` (4 tests: atomic snapshot, sensitive markers, edge pages, index addressing + stale) plus `readActionable`/`snapshotRef` e2e handles in `src/main/index.ts`; fixed content-addressed generation (SC-003) found by the determinism test

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Integrates with US1's tool registration (T011/T016) but independently testable via stubbed ranking
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Integrates with US1's collector (T009/T021) but independently testable

### Within Each User Story

- Tests SHOULD be written and FAIL before implementation (repo convention)
- Collector/types before wiring; wiring before docs
- Story complete before moving to next priority

### Parallel Opportunities

- T002 runs in parallel with T001 (different files)
- T004 + T006 run in parallel with T003/T005
- T007 + T008 run in parallel (different test files)
- T009 runs in parallel with T007/T008 (implementation vs tests)
- T013 + T014 run in parallel; T015 runs in parallel with both
- T018 + T019 run in parallel
- T022 + T023 + T024 run in parallel (different docs)

---

## Parallel Example: User Story 1

```bash
# Launch tests + collector implementation together (different files):
Task: "Contract test for unranked read_actionable in tests/unit/mcp-tools.test.ts" (T007)
Task: "Unit tests for filtering/labels/omissions in tests/unit/actionable.test.ts" (T008)
Task: "Snapshot collector in src/main/page/actionable.ts" (T009)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently (quickstart Scenario 1 + 4)
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
- Live Jev calls stay manual-only (T026); CI uses stubbed ranking throughout
