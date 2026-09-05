# Tasks: Checked-In Changelog for Future Releases

**Input**: Design documents from `/specs/024-checked-in-changelog/`

## Phase 1: Setup

- [X] T001 Create the root Keep a Changelog document in `CHANGELOG.md` with `Unreleased`, feature-018 compatibility notes, and the current release-history format.

## Phase 2: Foundational

- [X] T002 [P] Define the changelog parsing and release-entry contract in `specs/024-checked-in-changelog/contracts/release-changelog.md`.
- [X] T003 [P] Document changelog maintenance and release publication steps in `docs/development.md`.

## Phase 3: User Story 1 - Reviewable Release History (Priority: P1) 🎯 MVP

**Goal**: Maintain a consistent, human-readable changelog with future-release and compatibility notes.

**Independent Test**: Inspect `CHANGELOG.md` and verify its headings, Unreleased section, and reduceDom notes.

- [X] T004 [US1] Add the Keep a Changelog format and feature-018 reduceDom default/opt-out note to `CHANGELOG.md` without creating a historical release entry.

## Phase 4: User Story 2 - Changelog-Backed Published Release (Priority: P2)

**Goal**: Fail releases missing the current version entry and publish the checked-in entry.

**Independent Test**: Run the verifier against valid, missing, duplicate, and empty version entries and inspect extracted output.

- [X] T005 [P] [US2] Write unit tests for release-entry validation and extraction in `tests/unit/check-release-changelog.test.ts`.
- [X] T006 [US2] Implement fail-closed version validation and entry extraction in `scripts/check-release-changelog.js`.
- [X] T007 [US2] Invoke the release changelog verifier in `.github/workflows/release.yml` before build/publication and pass the extracted entry to the published release body.

## Phase 5: User Story 3 - Clear Maintenance Workflow (Priority: P3)

**Goal**: Make the contributor and release-maintainer workflow discoverable.

**Independent Test**: Follow `docs/development.md` from adding an Unreleased note through versioned release verification.

- [X] T008 [US3] Update `docs/development.md` with manual maintenance rules, current-version requirements, and publication behavior.

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T009 [P] Run formatting and lint checks on changed JavaScript, TypeScript, Markdown, and workflow files.
- [X] T010 Run `npm test` and validate the quickstart in `specs/024-checked-in-changelog/quickstart.md`.

## Dependencies & Execution Order

- Setup and foundational documentation precede implementation.
- T005 is written before T006; T007 depends on T006; T008 may follow T003 but touches the same file and should be applied after it.
- T009 and T010 run after all implementation tasks.
- MVP is User Story 1; release enforcement requires User Story 2.

## Parallel Opportunities

- T002 and T003 can run in parallel.
- T005 can be prepared independently before T006; T009 and T010 are final validation tasks.

## Implementation Strategy

1. Establish the changelog and format (T001/T004).
2. Add the tested verifier and release wiring (T005–T007).
3. Document the operating workflow (T008), then run validation (T009–T010).
