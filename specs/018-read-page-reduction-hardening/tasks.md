---

description: "Task list for feature implementation"
---

# Tasks: Read Page Reduction Hardening

**Input**: Design documents from `/specs/018-read-page-reduction-hardening/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/read-page-reduction-hardening.md, quickstart.md

**Tests**: Included. User Story 2 of the spec is itself about test-coverage gaps (the existing
suite would not catch a regression of the bug User Story 1 fixes), so tests are load-bearing
deliverables here, not optional scaffolding.

**Organization**: Tasks are grouped by user story (spec.md priorities: US1 P1, US2 P1, US3 P2,
US4 P3) so each can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files/regions, no dependency on an incomplete task)
- **[Story]**: US1–US4, per spec.md
- File paths are exact; there are only three touched files in this feature:
  `src/main/page/read.ts`, `tests/fixtures/dom-noise-repro.html`,
  `tests/integration/read-page.spec.ts`.

## Phase 1: Setup

Not applicable. This is a hardening pass on an already-shipped feature (017) in an existing
TypeScript/Electron project — no new dependency, build config, or scaffolding is needed.

## Phase 2: Foundational (Blocking Prerequisites)

Not applicable. The four fixes touch independent code regions of the same existing files
(`__reduceDom`'s root check vs. `readPageScript`'s `includeDom` gating vs. test/fixture
additions vs. the PR description) and share no blocking prerequisite beyond what's already
built and merged. Each user story below can start immediately.

---

## Phase 3: User Story 1 - A selector matching a removable node itself is actually reduced (Priority: P1) 🎯 MVP

**Goal**: Fix the root-element exclusion bug — `__reduceDom` strips a selector-matched root
the same way it already strips a matching descendant (issue 010; spec FR-001/FR-002).

**Independent Test**: `read_page({ selector: "script", includeDom: true })` (and the `<style>`
/ decorative-`<svg>` equivalents) against a fixture containing such a root returns `dom: ""`;
`reduceDom: false` still returns the markup verbatim.

### Tests for User Story 1 ⚠️

> Write these first; they must FAIL against the current `read.ts` before the fix in T003.

- [ ] T001 [P] [US1] Add a root-removable-node fixture region to `tests/fixtures/dom-noise-repro.html`: a directly-addressable `<script id="root-script-case">`, `<style id="root-style-case">`, and `<svg id="root-svg-case" aria-hidden="true">` (each independently selectable, per spec Acceptance Scenarios 1–3)
- [ ] T002 [US1] Add integration tests in `tests/integration/read-page.spec.ts` asserting `read_page({ selector: "#root-script-case", includeDom: true })` (and the `#root-style-case` / `#root-svg-case` equivalents) return `dom: ""` and `domReduced: true` under default reduction, and unchanged markup under `reduceDom: false` (spec Acceptance Scenario 4) — depends on T001

### Implementation for User Story 1

- [ ] T003 [US1] In `src/main/page/read.ts`, extend `__reduceDom` (`DOM_REDUCTION_HELPER`) to check the root node itself against the same removal predicates (`script`/`style` tag name, `svg[aria-hidden="true"]`) before the descendant `querySelectorAll` sweep, returning `""` immediately when the root matches (FR-001, FR-002; research.md R1)
- [ ] T004 [US1] Run `npm run test:e2e -- read-page` and confirm the T002 tests now pass and no existing `read-page.spec.ts` case regresses

**Checkpoint**: User Story 1 is fully functional and independently testable — issue 010's repro case is fixed.

---

## Phase 4: User Story 2 - Reduction test coverage actually proves reduction works (Priority: P1)

**Goal**: Close the test-coverage gaps that let User Story 1's bug ship unnoticed and that
leave several of feature 017's stronger claims unverified (issue 011; spec FR-003–FR-008).

**Independent Test**: Deleting script/style/comment removal from `__reduceDom` causes at least
one test in `read-page.spec.ts` to fail (it currently would not).

### Tests / Implementation for User Story 2

- [ ] T005 [P] [US2] Add `<script>`, `<style>`, and an HTML comment *inside* `#job-list` in `tests/fixtures/dom-noise-repro.html`, so the existing scoped-reduction fixture region genuinely contains removable nodes (FR-003)
- [ ] T006 [US2] Update the "US1: a reduced DOM read strips script/style/comment/class/style, keeps card text" test in `tests/integration/read-page.spec.ts` (currently around line 158) to assert against the newly-added in-subtree nodes from T005, not just the pre-existing out-of-subtree ones — depends on T005
- [ ] T007 [P] [US2] Add a dedicated unscoped reduced-read test case (`read_page({ includeDom: true })`, no `selector`) to `tests/integration/read-page.spec.ts`, asserting script/style/comment removal on the whole-document path (FR-004)
- [ ] T008 [P] [US2] Extend the existing single-attribute spot-check (`read-page.spec.ts:212`, `aria-roledescription`) into a full attribute-set diff of a representative node — capture and compare all non-`class`/`style` attributes before and after a reduced read (FR-006)
- [ ] T009 [P] [US2] Add a page-side marker/counter element to `tests/fixtures/dom-noise-repro.html` and a test in `tests/integration/read-page.spec.ts` confirming it is unaffected after a reduced read, proving the live DOM was never mutated (FR-007)
- [ ] T010 [P] [US2] Add a reduced-DOM truncation test in `tests/integration/read-page.spec.ts`: a reduced read whose output exceeds `config.maxDomBytes` still truncates correctly and sets `truncated.dom: true` (FR-008)
- [ ] T011 [US2] Run `npm run test:e2e -- read-page` and confirm all US2 tests pass; temporarily revert T003's fix locally and confirm at least one test now fails (SC-002 spot-check), then restore the fix

**Checkpoint**: User Stories 1 AND 2 both work independently — the fix is now regression-proof.

---

## Phase 5: User Story 3 - A text-only read doesn't pay for DOM reduction it never returns (Priority: P2)

**Goal**: Stop `readPageScript` from computing `dom` (clone/`TreeWalker`/attribute-strip) when
`includeDom` is `false` (issue 013; spec FR-009/FR-010).

**Independent Test**: A text-only read's response is byte-for-byte unchanged while its
execution no longer performs the clone/reduce work — verified by a relative regression check,
no meaningful cost difference between `reduceDom: true` and `reduceDom: false` when
`includeDom` is `false`.

### Tests for User Story 3 ⚠️

- [ ] T012 [P] [US3] Add a regression test in `tests/integration/read-page.spec.ts` confirming `read_page({ tabId })` (no `includeDom`) returns identical `text`/`url`/`title` regardless of `reduceDom`'s value (FR-010) — should already pass today; keep as a pre-fix baseline
- [ ] T013 [P] [US3] Add a regression test in `tests/integration/read-page.spec.ts` against a large-DOM fixture confirming no meaningful timing difference between `reduceDom: true` and `reduceDom: false` when `includeDom` is `false` (SC-003) — should FAIL or be marginal before T014/T015

### Implementation for User Story 3

- [ ] T014 [US3] In `src/main/page/read.ts`, add an `includeDom` parameter to `readPageScript(selector, reduceDom, includeDom)` with a fourth script-generation branch: when `includeDom` is `false`, emit a script computing only `url`/`title`/`text` — no `__reduceDom` call, no `outerHTML` reference (FR-009; research.md R2)
- [ ] T015 [US3] Update `readPage()` in `src/main/page/read.ts` to pass `includeDom` into `readPageScript(...)` at the call site — depends on T014
- [ ] T016 [US3] Run `npm run test:e2e -- read-page` and confirm T012/T013 pass and no existing case regresses (response shape unchanged per SC-004)

**Checkpoint**: User Stories 1, 2, and 3 all work independently.

---

## Phase 6: User Story 4 - Existing integrators learn about the default-on behavior change (Priority: P3)

**Goal**: Close the communication gap around feature 017's already-decided `reduceDom`
default-on behavior (issue 012; spec FR-011).

**Independent Test**: A release note / PR description entry exists naming the `reduceDom`
default-on change and the `reduceDom: false` opt-out.

### Implementation for User Story 4

- [ ] T017 [US4] When drafting this feature's PR description (per the `pr-description` skill), include a "Notable decisions" line naming the `reduceDom` default-on behavior and pointing to `reduceDom: false` as the opt-out — no file changes; release notes are auto-generated from PR titles at tag time (`.github/workflows/release.yml`, research.md R3)

**Checkpoint**: All four user stories are independently functional and delivered.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T018 [P] Run `npm test` (vitest) and `npm run test:e2e` (playwright) for the full suite and confirm 100% pass, including all T001–T016 additions (SC-004)
- [ ] T019 Run `specs/018-read-page-reduction-hardening/quickstart.md`'s manual/exploratory validation steps end-to-end against a running `npm start` instance

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup / Foundational (Phases 1–2)**: N/A — no blocking prerequisites.
- **User Story 1 (Phase 3)**: No dependencies on other stories. Recommended first (MVP —
  fixes the live correctness bug).
- **User Story 2 (Phase 4)**: No hard dependency on US1's implementation (T005–T010 touch the
  fixture and spec file, not `read.ts`), but its SC-002 spot-check in T011 is most meaningful
  once T003 exists — do US1 before US2 in practice even though they're independently testable.
- **User Story 3 (Phase 5)**: Fully independent of US1/US2 — different branch of the same
  file, different test cases.
- **User Story 4 (Phase 6)**: Fully independent — no code, just the PR description.
- **Polish (Phase 7)**: Depends on all four stories being complete.

### Within Each User Story

- Fixture changes before the tests that read them (T001→T002, T005→T006, T009).
- Tests before the implementation they validate (TDD): T001–T002 before T003; T012–T013
  before T014–T015.
- Implementation before the "confirm passing" run task in each phase.

### Parallel Opportunities

- T001 (US1 fixture) and any US3/US4 task can run in parallel (different files/stories).
- T007, T008, T009, T010 (US2) can all run in parallel — independent test cases in the same
  file, no shared state between them.
- T012 and T013 (US3 tests) can run in parallel.
- Once Phase 3 (US1) lands, Phases 4, 5, and 6 can all proceed in parallel if staffed;
  sequentially, the recommended order is US1 → US2 → US3 → US4 (spec priority order).

---

## Parallel Example: User Story 2

```bash
# After T005/T006 land, these four are independent test cases in the same file:
Task: "Add unscoped reduced-read test case (FR-004) in tests/integration/read-page.spec.ts"
Task: "Add full attribute-set diff test (FR-006) in tests/integration/read-page.spec.ts"
Task: "Add live-DOM-not-mutated test (FR-007) in tests/integration/read-page.spec.ts"
Task: "Add reduced-DOM truncation test (FR-008) in tests/integration/read-page.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 3 (US1): fix the root-exclusion bug and its two dedicated tests.
2. **STOP and VALIDATE**: `npm run test:e2e -- read-page` green, issue 010's repro case fixed.
3. This alone closes the live correctness bug — everything else is hardening on top.

### Incremental Delivery

1. Phase 3 (US1) → the correctness fix, independently shippable.
2. Phase 4 (US2) → the test-coverage gap that let US1's bug through, now closed.
3. Phase 5 (US3) → the perf fix, independent of the above.
4. Phase 6 (US4) → the release-note line, a PR-description task, not code.
5. Phase 7 → full-suite confirmation and quickstart validation.

## Notes

- All four user stories touch only three files total — no new modules, services, or MCP
  parameters (per plan.md's Project Structure and Constitution Check: PASS, no violations).
- Tests are Playwright integration tests (`tests/integration/read-page.spec.ts`), matching how
  feature 017 itself was tested — no new test framework or harness is introduced.
- Commit after each checkpoint (end of each phase), not after every individual task, to keep
  the branch's history aligned with the four source issues (010/011/013/012) this feature
  bundles.
