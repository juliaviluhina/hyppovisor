---

description: "Task list for feature 017: Read Page DOM Noise Reduction"
---

# Tasks: Read Page DOM Noise Reduction

**Input**: Design documents from `/specs/017-read-page-dom-noise-reduction/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/read-page-noise-reduction.md, quickstart.md

**Tests**: Included — `plan.md`'s Project Structure names specific new/extended test files
(`tests/unit/read-page-noise-reduction.test.ts`, `tests/integration/read-page.spec.ts`), so
test tasks are generated.

**Organization**: Tasks are grouped by user story (US1/US2/US3 from spec.md), preceded by a
Foundational phase since all three stories share one small, non-severable code path
(`readPageScript()`'s reduction pass + `readPage()`'s new parameter + the MCP schema field).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Single-project layout (existing repo structure): `src/`, `tests/` at repository root.

---

## Phase 1: Setup

No new dependencies, no new modules, no scaffolding needed — this feature extends four
existing files (research.md: "no new runtime dependency"). Nothing to do in this phase.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The reduction pass, the new `reduceDom` parameter, and the `domReduced` result
field are one indivisible unit of work — `readPageScript()` cannot emit a reduced `dom` for
US1 without `readPage()` accepting the opt-out for US2 and setting the indicator for US3
simultaneously (they're the same code path, per data-model.md's 5-step algorithm and
contracts/read-page-noise-reduction.md's Behaviour section). Building them one story at a time
would mean re-touching the same three functions three times for no benefit.

**⚠️ CRITICAL**: No user-story task can be verified until this phase is complete.

- [ ] T001 Add `domReduced?: boolean` to `PageReadResult` in `src/shared/types.ts`, alongside
  the existing `scopedTo?: string` field (data-model.md: present only when `dom` is present
  and reduction was applied; mirrors `scopedTo`'s absent-when-inapplicable convention).
- [ ] T002 In `src/main/page/read.ts`, add a `stripDom(html: string): string` — no, add the
  reduction logic **inside** `readPageScript(selector, reduceDom)`'s returned in-page script
  string (not as a separate main-process function — research.md R1 requires the strip to run
  in the isolated-world script, on the live DOM, before `outerHTML` is read). Change
  `readPageScript`'s signature to `readPageScript(selector: string | undefined, reduceDom: boolean)`.
  When `reduceDom` is `true`: after resolving the target element (`document.documentElement`
  for the unscoped case, or the `__querySafe` match for the scoped case), clone it with
  `cloneNode(true)`, then on the clone: remove every `<script>` and `<style>` element
  (`clone.querySelectorAll("script, style").forEach(el => el.remove())`), remove every comment
  node via `document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT)` (collect into an array
  first, then `.remove()` each — research.md R3), then remove `class` and `style` attributes
  from every element in the clone including the clone root itself
  (`[clone, ...clone.querySelectorAll("*")].forEach(el => { el.removeAttribute("class"); el.removeAttribute("style"); })`).
  Serialize `clone.outerHTML` as `dom`. When `reduceDom` is `false` (or the element has no
  clone path, e.g. unscoped with no `document.documentElement`), `dom` stays exactly the
  existing `el.outerHTML` / `document.documentElement.outerHTML` expression — byte-for-byte
  unchanged from today (FR-002). `text` (`innerText`) is computed from the **original**,
  unreduced element in both cases (data-model.md: reduction never touches the plain-text path).
- [ ] T003 In `src/main/page/read.ts`, update `readPage()`'s signature to
  `readPage(wc, tabId, includeDom, queueDepth, selector?, reduceDom = true)`, pass `reduceDom`
  through to `readPageScript(selector, reduceDom)` (only meaningful when `includeDom` is true —
  contracts/read-page-noise-reduction.md Behaviour step 2), and after the existing
  `if (includeDom) { ... }` block, set `result.domReduced = true` iff `includeDom && reduceDom`
  (never set it, not even to `false`, otherwise — FR-008, research.md R4).
- [ ] T004 In `src/main/mcp/tools.ts`, add `reduceDom: z.boolean().optional().default(true).describe(...)`
  to the `read_page` tool's input schema (near the existing `includeDom`/`selector` fields,
  line ~118-122) and thread it through the handler
  (`async ({ tabId, includeDom, selector, reduceDom }) => ... readPage(wc, tabId, includeDom, depth, selector, reduceDom)`,
  around line 124-129).
- [ ] T005 In `src/main/index.ts`, extend the `__hyppo.read` e2e test handle (~line 530) to
  `read: (tabId: string, includeDom = false, selector?: string, reduceDom = true) => ...`,
  forwarding `reduceDom` into `readPage(...)` (contracts/read-page-noise-reduction.md Test
  hooks section).

**Checkpoint**: Foundation ready — `readPageScript`/`readPage`/the MCP schema/the test handle
all carry `reduceDom` end to end. All three user stories can now be verified.

---

## Phase 3: User Story 1 - Get a page's structure without paying for its decoration (Priority: P1) 🎯 MVP

**Goal**: A DOM read (with reduction on, the default) excludes script/style/comment nodes and
`class`/`style` attributes while preserving all visible text, non-presentational attributes,
and structural elements.

**Independent Test**: Open `tests/fixtures/dom-noise-repro.html`, read `#job-list`'s DOM with
reduction requested (the default), confirm no `<script>`/`<style>`/comment/`class`/`style` in
the result while every card's title and company text is present.

### Tests for User Story 1

- [ ] T006 [P] [US1] In `tests/unit/read-page-noise-reduction.test.ts` (new file, mirroring
  `tests/unit/read-page-selector.test.ts`'s structure), unit-test `readPageScript(selector, true)`
  textually: contains the script/style removal, `TreeWalker`/`SHOW_COMMENT` comment removal,
  and `class`/`style` attribute removal logic; `readPageScript(selector, false)` is textually
  equivalent to the pre-017 script (no clone/strip logic present).
- [ ] T007 [P] [US1] In `tests/integration/read-page.spec.ts`, add a scenario against
  `tests/fixtures/dom-noise-repro.html`: `read(tabId, true, "#job-list")` (reduction on by
  default) returns `dom` containing no `<script>`, `<style>`, HTML comment, or `class="..."`/`style="..."`
  attribute, while `"Example Role One"`, `"Example Co"`, and the other cards' text are present
  (acceptance scenarios 1-3 and 5).
- [ ] T008 [P] [US1] In the same spec file, add a scenario asserting a meaningful,
  non-presentational attribute in the fixture (e.g. an `id`, `data-*`, or `aria-*` attribute
  present on a card element) survives reduction unchanged (acceptance scenario 4, FR-004,
  SC-004).

### Implementation for User Story 1

Implementation is already complete from the Foundational phase (T002) — this phase is
verification-only. No additional implementation tasks.

- [ ] T009 [US1] Run `npx vitest run tests/unit/read-page-noise-reduction.test.ts` and
  `npx playwright test tests/integration/read-page.spec.ts`; confirm T006-T008 pass.

**Checkpoint**: User Story 1 is independently verified — reduced DOM reads strip noise while
preserving text, structure, and meaningful attributes.

---

## Phase 4: User Story 2 - A caller can still get the full, verbatim DOM on request (Priority: P1)

**Goal**: `reduceDom: false` reproduces the exact pre-feature-017 `includeDom: true` output,
byte-for-byte, and reads without `includeDom` are entirely unaffected by `reduceDom`.

**Independent Test**: Read `dom-noise-repro.html` with `reduceDom: false` and confirm the
result is byte-for-byte identical to this feature's pre-existing unreduced output.

### Tests for User Story 2

- [ ] T010 [P] [US2] In `tests/integration/read-page.spec.ts`, add a scenario:
  `read(tabId, true, "#job-list", false)` returns `dom` containing `<script>`, `<style>`, the
  HTML comment, and `class="..."` attributes (i.e. unreduced) — byte-for-byte equal to the raw
  `outerHTML` of `#job-list` as captured directly from the fixture (acceptance scenario 1,
  FR-002, SC-002).
- [ ] T011 [P] [US2] In the same spec file, add a scenario: `read(tabId)` (no `includeDom`)
  produces no `dom` and no `domReduced` field regardless of `reduceDom`'s value, and `text` is
  identical with `reduceDom` true or false (acceptance scenario 2 sibling case in Edge Cases;
  contracts/read-page-noise-reduction.md Behaviour step 2).

### Implementation for User Story 2

Implementation is already complete from the Foundational phase (T002-T003) — this phase is
verification-only. No additional implementation tasks.

- [ ] T012 [US2] Run `npx playwright test tests/integration/read-page.spec.ts`; confirm T010-T011
  pass and that no existing (pre-017) `read-page.spec.ts` scenario regressed (SC-002's "100% of
  cases" compatibility guarantee).

**Checkpoint**: User Story 2 is independently verified — the verbatim escape hatch is exact and
the no-`includeDom` path is untouched.

---

## Phase 5: User Story 3 - Caller can tell a reduced DOM read apart from a verbatim one (Priority: P2)

**Goal**: `domReduced: true` is present iff reduction was actually applied; absent in every
other case.

**Independent Test**: A reduced read's result carries `domReduced: true`; an opted-out or
DOM-less read's result carries no `domReduced` field.

### Tests for User Story 3

- [ ] T013 [P] [US3] In `tests/integration/read-page.spec.ts`, add a scenario:
  `read(tabId, true, "#job-list")` (default reduction) → result includes `domReduced: true`;
  `read(tabId, true, "#job-list", false)` → result has no `domReduced` key at all (not
  `false`); `read(tabId)` (no DOM) → result has no `domReduced` key (acceptance scenarios 1-2,
  FR-007/FR-008, SC-003).

### Implementation for User Story 3

Implementation is already complete from the Foundational phase (T003) — this phase is
verification-only. No additional implementation tasks.

- [ ] T014 [US3] Run `npx playwright test tests/integration/read-page.spec.ts`; confirm T013
  passes.

**Checkpoint**: All three user stories independently verified.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T015 [P] Byte-size assertion in `tests/integration/read-page.spec.ts`: the reduced
  `dom` from T007 is at least 50% smaller than the unreduced `dom` from T010, matching SC-001's
  measured real-world proportion.
- [ ] T016 [P] Edge-case test in `tests/integration/read-page.spec.ts` or
  `tests/unit/read-page-noise-reduction.test.ts`: a subtree with no script/style/comment nodes
  or presentation-only attributes at all reduces to content identical to the verbatim read
  (modulo `domReduced`) — Edge Cases bullet 3.
- [ ] T017 [P] Edge-case test: an element emptied by attribute stripping (no remaining
  attributes) is still present in reduced output, not removed — Edge Cases bullet 1, FR-005.
- [ ] T018 Composability test in `tests/integration/read-page.spec.ts`: `selector` (016) +
  `reduceDom` (017) together reduce only the selector-scoped subtree, matching Edge Cases
  bullet 2 / FR-009 / research.md R6.
- [ ] T019 Run `npm run build` (or equivalent typecheck) and the full test suite
  (`npx vitest run` + `npx playwright test`) to confirm no regression outside this feature's
  files.
- [ ] T020 Execute `quickstart.md`'s manual validation steps 1-5 end to end against
  `tests/fixtures/dom-noise-repro.html` and confirm the observed byte-size reduction and content
  match its expectations.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — empty.
- **Foundational (Phase 2)**: No dependencies — BLOCKS all user stories (T001-T005 touch the
  same three functions every story's tests exercise).
- **User Stories (Phase 3-5)**: All depend on Phase 2 completion. Once Phase 2 is done, US1/US2/US3
  test-writing (T006-T008, T010-T011, T013) can proceed in parallel — they touch different
  scenarios in the same two test files, so within a file keep them as sequential edits even
  though they're logically independent.
- **Polish (Phase 6)**: Depends on Phases 3-5 being complete.

### Within Each Phase

- T001 (types) has no dependency and can run before/parallel with T002.
- T002 (reduction pass in `readPageScript`) must complete before T003 (`readPage` threading
  `reduceDom`/`domReduced`), which must complete before T004 (MCP schema) and T005 (test
  handle) — T004 and T005 can run in parallel with each other once T003 is done.
- Test tasks (T006-T008, T010-T011, T013) can be written before Phase 2 lands (TDD), but can
  only be run (T009, T012, T014) after Phase 2 completes.

### Parallel Opportunities

- T004 and T005 (different files, both depend only on T003).
- T006 [P] alongside T007/T008 (different files: unit test file vs. integration spec file).
- T010, T011 [P] with each other only if edited as independent hunks; T013 similarly.
- T015, T016, T017 [P] with each other (independent assertions); T018 depends on the same
  fixture/selector setup so keep it after T015-T017 if sharing a `describe` block.

---

## Parallel Example: Foundational Phase

```bash
# T001 can run alongside starting T002 (different files):
Task: "Add domReduced?: boolean to PageReadResult in src/shared/types.ts"
Task: "Add reduction pass to readPageScript() in src/main/page/read.ts"

# After T003 lands, T004 and T005 are independent:
Task: "Add reduceDom input to read_page schema in src/main/mcp/tools.ts"
Task: "Extend __hyppo.read test handle in src/main/index.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001-T005) — this is most of the feature's actual code.
2. Complete Phase 3: User Story 1 (T006-T009) — proves reduction works and preserves content.
3. **STOP and VALIDATE**: US1 alone is a demoable MVP (reduced-by-default DOM reads).

### Incremental Delivery

1. Foundational (T001-T005) → all three stories' code exists simultaneously (they share one
   code path — see Phase 2's rationale).
2. US1 tests (T006-T009) → validates the reduction itself.
3. US2 tests (T010-T012) → validates the compatibility escape hatch.
4. US3 tests (T013-T014) → validates the self-describing indicator.
5. Polish (T015-T020) → SC-001 byte-size proof, edge cases, composability, full-suite run,
   manual quickstart walkthrough.

## Notes

- Because Foundational (T001-T005) implements all three stories' behavior at once (per Phase 2's
  rationale), each story's "Implementation" subsection is verification-only — this is expected
  for a feature this size, not a template deviation.
- [P] tasks = different files or independent scenarios; verify tests fail before Phase 2 lands
  if following strict TDD.
- Commit after each phase (matches this session's established "commit after each Spec Kit
  phase" pattern).
