---

description: "Task list for feature 006 — Choose an Option in a Dropdown"
---

# Tasks: Choose an Option in a Dropdown

**Input**: Design documents from `specs/006-select-dropdown-option/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/choose-option.md, quickstart.md

**Tests**: Included — the spec defines an Independent Test per story and SC-001…SC-007, and
quickstart.md §1–§5 are unit + integration suites. Same convention as features 004 / 005.

**Branch**: `clarify-plan-004-006` · **Feature dir**: `specs/006-select-dropdown-option`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run in parallel — different file, no dependency on an incomplete task
- **[Story]**: US1 / US2 / US3 / US4 (Setup, Foundational, Polish carry no story label)
- Every task names an exact file path

## Serial spines (no `[P]` between tasks that touch the same file)

- `src/main/page/choose-option.ts` — T006 → T009 → T013 → T014 → T016 → T017 → T019 → T023
- `src/main/page/interact.ts` — T008 → T028
- `tests/unit/choose-option.test.ts` — T007 → T020
- `tests/integration/choose-option.spec.ts` — T015 → T018 → T021 → T022 → T023
- `src/main/mcp/tools.ts` — T011 → T028
- `tests/fixtures/form.html` — T002 only

---

## Phase 1: Setup

**Purpose**: config + fixture scaffolding every later phase needs.

- [ ] T001 [P] Add `chooseOptionWaitMs` to `src/main/config.ts`: read the existing default wait once (`const dw = numFromEnv("HYPPO_DEFAULT_WAIT_MS", 10_000)`) and add `chooseOptionWaitMs: numFromEnv("HYPPO_CHOOSE_OPTION_WAIT_MS", dw)` beside `defaultWaitMs`, with a one-line comment (bounded wait for a custom combobox's options to render and for the read-back check — FR-010/FR-013).
- [ ] T002 [P] Extend `tests/fixtures/form.html` with the controls quickstart.md "Prerequisites" lists: (a) a **closed** react-select-style combobox (`role="combobox"`, `aria-expanded="false"`) whose `[role="option"]` elements are inserted into its listbox only when it is opened by click; (b) a combobox with a filter `<input>` narrowing a ≥4-option list; (c) a combobox whose options are appended after a delay well over the test-env `HYPPO_CHOOSE_OPTION_WAIT_MS` (never within budget); (d) an id-carrying combobox that renders an option but whose option `click` handler is a no-op (read-back sabotage — US4); (e) a `<select id="marketingSelect">` whose associated `<label>` reads "I agree to receive marketing email"; (f) a `<select id="otherSelect">` with two `<option>`s both showing "Other" (distinct `value`s); (g) a `<select id="pronounSelect">` with a `disabled` `<option>` "Prefer not to say"; (h) a `<select id="skillsSelect" multiple>`; (i) a combobox that exposes its listbox via `aria-owns="ownedListbox"` rather than a descendant; (j) a "creatable" combobox whose typed label is not among its rendered options. Keep the existing `#country` and `#locationCombobox`. Extend the fixture's `<script>` so opened menus insert their options and the sabotage option records nothing.

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: shared types, error code, blocklist coverage, the two pure helpers, and the
operation plumbing through `interact` / MCP / e2e — with per-kind mechanics still stubbed.

- [x] T003 [P] `src/shared/types.ts`: add `"choose_option"` to `InteractOperation`; add `type ChooseOptionReason = "not-a-dropdown" | "no-option-match" | "ambiguous-option" | "option-disabled" | "option-not-appeared" | "multi-select"`; add `interface ChosenOption { label: string; value: string }`; add optional `chosenOption?: ChosenOption` to `InteractResult`; add optional `reason?: string` to `InteractionLogEntry` (per data-model.md §4–§6).
- [x] T004 [P] `src/main/errors.ts`: add `"CHOOSE_OPTION_FAILED"` to `ErrorCode`; add `reason?: string` and `candidates?: string[]` to `ErrorDetails` (data-model.md §8). No change to `HyppoError` / `toResult()`.
- [x] T005 `src/main/safety/blocklist.ts`: in `ruleCovers()` add `|| op === "choose_option"` to the `"activation"` and `"fill-or-space"` arms; update the `appliesTo` JSDoc and the `ruleCovers` comment so `activation` = "click, space, or choose_option" and `fill-or-space` = "fill, space, or choose_option". Do **not** touch `BLOCKLIST_RULES`, `matchBlocklist`, `isSafeFillTarget`, `TargetDescriptor`, or the descriptor scripts.
- [x] T006 Create `src/main/page/choose-option.ts` with: internal `type ChooserKind = "native-select" | "custom-combobox" | "listbox"`; internal `interface OptionRecord { label: string; value: string; disabled: boolean }`; `norm(s)` (`.trim().replace(/\s+/g," ").toLowerCase()`); pure `chooserKindFor(x)` per research.md R3 (returns `ChooserKind | null`; a `<select multiple>` / `aria-multiselectable` widget yields `null` **plus** a `multiple: true` signal the caller reads); pure `matchOption(options, want)` per research.md R5 / contract matching table (label-only, value-only, both, `ambiguous-option` + `candidates`, `option-disabled` checked last). No DOM, no imports from Electron.
- [x] T007 [P] Create `tests/unit/choose-option.test.ts` (vitest): `matchOption` across every branch (value hit/miss/duplicate-first; label exact hit case+whitespace-insensitive / miss / two-match `ambiguous-option` with verbatim `candidates`; both-supplied agree/contradict; matched-disabled → `option-disabled`); `chooserKindFor` for `<select>` / `<select multiple>` / `role=combobox` / `role=listbox` / `<div aria-owns>`→listbox / plain `<div>`; `ruleCovers(appliesTo, "choose_option")` true for `activation` / `fill-or-space` / `both`, false for `click`, and `matchBlocklist(d, "choose_option")` blocked for `submit-control` / `consent-toggle` / `external-act-label` / `credential-field` descriptors and not blocked for a plain in-form `<select>` descriptor.
- [x] T008 `src/main/page/interact.ts`: add trailing `label?: string` to `interact()`; change its return type to `Promise<{ chosenOption?: ChosenOption } | void>`; after the existing `if (!selector)` guard add `if (operation === "choose_option") return chooseOption(wc, log, tabId, selector, label, value);`; import `chooseOption` and `ChosenOption`; update the file header comment to list `choose_option` and note it never submits / never presses Enter.
- [x] T009 `src/main/page/choose-option.ts`: add `chooseOptionProbeScript(selector)` (isolated-world expression returning `{ tagName, role, multiple, optionsInDom: OptionRecord[], optionSource, hasFilterInput, filterSelector, listboxPresent, menuOpen, preCallValue }`, resolving `aria-controls`/`aria-owns` to a `role="listbox"` and reading `<option>`s for a `<select>`); implement the `chooseOption()` orchestration skeleton — reject when neither `label` nor `value` is given (`CHOOSE_OPTION_FAILED` / `no-option-match`, message "choose_option requires `label` or `value`"); run `targetDescriptorScript` + `matchBlocklist(d, "choose_option")` (blocked → one `refused` log entry with `ruleId` + throw `REFUSED_EXTERNAL_ACT`); run the probe; `chooserKindFor` → `null` non-multiple → `refused` `not-a-dropdown`; `multiple` → `refused` `multi-select`; then `switch (kind)` dispatch to `applyNativeSelect` / `applyCustomCombobox` (both `throw new HyppoError("CHOOSE_OPTION_FAILED", …, { reason: "option-not-appeared" })` placeholders for now). One audit entry on every path via the `logged`-flag pattern copied from `interact()`.
- [x] T010 [P] `src/main/index.ts` (`HYPPO_E2E` block): extend the `interact` handle to `(tabId, operation, selector?, value?, label?)`, pass `label` through to `interact(...)`, and spread `chosenOption` from the resolved value into the returned object when present (data-model.md §11).
- [x] T011 [P] `src/main/mcp/tools.ts`: change the `interact` `operation` enum to `["click","fill","scroll","space","choose_option"]`; add `label: z.string().optional()` to the input schema; capture `interact(...)`'s return and merge `chosenOption` into the `ok({...})` payload when present; rewrite the tool description to name `choose_option` (valid targets `<select>` / `role=combobox` / `role=listbox` / owner of a `role=listbox`; exact match; read-back verification; whole-operation refusal for non-choosers and rule matches; never submits, never Enter) — FR-018.
- [x] T012 Regression checkpoint: `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e` all green. `choose_option` is registered and reachable but every kind still throws `CHOOSE_OPTION_FAILED`; no existing operation's behaviour changed.

**Checkpoint**: types, errors, blocklist, pure helpers, and plumbing are in place. Stories can proceed.

---

## Phase 3: User Story 1 — native `<select>` inside a form (Priority: P1) 🎯 MVP

**Goal**: one `choose_option` call sets a native `<select>`'s value by label or by value,
fires `input`/`change`, verifies the read-back, submits nothing, writes one audit entry.

**Independent Test**: on `form.html`, `choose_option` `#country` "United States" → `#country.value === "us"`, `window.__submitted === false`, tab URL unchanged, one `permitted` log line.

- [ ] T013 [US1] `src/main/page/choose-option.ts`: implement `applyNativeSelect(wc, selector, want, probe)` — run `matchOption(probe.optionsInDom, want)`; on failure return the mapped `ChooseOptionReason` (+`candidates` for `ambiguous-option`) to the caller; on success inject a script that sets `el.value = option.value` (fall back to `option.selected = true`) and dispatches bubbling `input` + `change`; then read back `el.value` and the selected option's text and compare to the chosen option; mismatch → revert `el.value` to `probe.preCallValue` and signal `option-not-appeared`.
- [ ] T014 [US1] `src/main/page/choose-option.ts`: wire `switch` case `"native-select"` → `applyNativeSelect`; on its failure signal, write one `refused` log entry (`ruleId: null`, `reason: <ChooseOptionReason>`, plus `candidates` in the thrown `HyppoError` details for `ambiguous-option`) and throw `CHOOSE_OPTION_FAILED`; on success write one `permitted` entry (`operation: "choose_option"`, `target: selector`) and return `{ chosenOption: { label, value } }` up through `interact()` → `tools.ts` / e2e handle.
- [ ] T015 [P] [US1] Create `tests/integration/choose-option.spec.ts` (`_electron`): load `form.html`; `interact(tab,"choose_option","#country",undefined,"United States")` → `outcome:"permitted"`, `chosenOption:{label:"United States",value:"us"}`, `probe` `#country.value==="us"`, `window.__submitted===false`, URL unchanged; `interact(tab,"choose_option","#country","us")` (by value) → same; a repeated identical call is idempotent; the interaction log grew by exactly one line per call with `operation:"choose_option"`, `outcome:"permitted"`, `target:"#country"`.

**Checkpoint**: native `<select>` selection works end-to-end and is independently testable.

---

## Phase 4: User Story 2 — react-select / ARIA combobox inside a form (Priority: P1)

**Goal**: `choose_option` opens a custom combobox, optionally types into its filter input,
activates the one exactly-matching `role="option"`, closes the widget, verifies the
read-back; a bounded async wait then refuses `option-not-appeared`.

**Independent Test**: on a react-select-style combobox, `choose_option` with a valid label → the control shows that value, the menu is closed, `window.__submitted === false`.

- [ ] T016 [US2] `src/main/page/choose-option.ts`: implement `applyCustomCombobox(wc, selector, want, probe)` — resolve the option source (descendant `[role="option"]`, or the `aria-controls`/`aria-owns` listbox, or a descendant/sibling `[role="listbox"]`; same list as `005` R5); if no options are in the DOM, open the menu with `el.click()`; wait up to `config.chooseOptionWaitMs` for `[role="option"]` via one `MutationObserver` (mirror `waitForSelector`); if the widget has a filter input (`probe.hasFilterInput`), set `want.label` into it using `fillScript`'s event set (`input` + `change`, no `blur`) and re-wait; run `matchOption` over the currently-rendered options; nothing rendered in budget → `option-not-appeared`, rendered but no match → `no-option-match`, `ambiguous-option` / `option-disabled` as usual (`aria-disabled==="true"` counts as disabled); activate the single match with `pointerdown`→`mousedown`→`mouseup`→`click` (no key events); close the widget (`Escape` keydown/keyup to the filter input, else re-`click` the chooser) and assert it is closed (`aria-expanded!=="true"` / listbox gone); read back the displayed value (`filterInput.value` / `[aria-selected="true"]` option label / `aria-activedescendant` target text / container `innerText`) and compare to the chosen option; mismatch → `option-not-appeared`.
- [ ] T017 [US2] `src/main/page/choose-option.ts`: wire `switch` cases `"custom-combobox"` and `"listbox"` → `applyCustomCombobox`, reusing the same single-audit-entry success/refusal handling as T014.
- [ ] T018 [P] [US2] Extend `tests/integration/choose-option.spec.ts`: closed react-select combobox + valid label → menu opens, option activated, menu **closes** (`aria-expanded==="false"` / listbox gone), displayed value is the option, `window.__submitted===false`; filter combobox → app types the label, narrows, activates the single exact match, and a label that only *prefixes* an option → `CHOOSE_OPTION_FAILED` / `no-option-match`; async-never-render combobox with `HYPPO_CHOOSE_OPTION_WAIT_MS=300` in the launch env → `CHOOSE_OPTION_FAILED` / `reason:"option-not-appeared"`, displayed value unchanged, widget left closed; `#locationCombobox` + "Berlin, Germany" → `permitted`, `chosenOption.label==="Berlin, Germany"`, `window.__chosenOption==="locationOptionBerlin"`.

**Checkpoint**: native and custom dropdowns both selectable through one operation.

---

## Phase 5: User Story 3 — wrong or dangerous targets are refused (Priority: P1)

**Goal**: a non-chooser, a chooser matching a submit/consent/credential/wording rule, a
no-match label, an ambiguous label, a disabled option, a creatable unknown label, and a
multi-select control each refuse with their own `code`/`reason`/`ruleId`, change no control,
and write exactly one audit line. `in-form` never refuses a real chooser.

**Independent Test**: call `choose_option` against a text input, `#submitBtn`, a consent-worded `<select>`, `#country` with a nonexistent option, and a duplicate-label `<select>` — each refused with its own reason, none changes a control.

- [ ] T019 [US3] `src/main/page/choose-option.ts`: harden refusal paths — confirm every refusal (blocklist gate, `not-a-dropdown`, `multi-select`, `no-option-match`, `ambiguous-option`, `option-disabled`, `option-not-appeared`) writes exactly one `refused` entry (rule → `ruleId`, non-rule → `reason`), sets no value in any probe/mutation script before the verdict is known, includes `candidates` in the `ambiguous-option` `HyppoError` details, and leaves a native `<select>` at `probe.preCallValue`.
- [ ] T020 [P] [US3] Extend `tests/unit/choose-option.test.ts`: assert each `ChooseOptionReason` maps to `code:"CHOOSE_OPTION_FAILED"` and a rule match maps to `code:"REFUSED_EXTERNAL_ACT"` with `ruleId`; assert `ambiguous-option` carries a `candidates: string[]`; add descriptor cases proving `matchBlocklist(d,"choose_option")` is blocked for all four rule categories and not for a plain in-form `<select>`.
- [ ] T021 [P] [US3] Extend `tests/integration/choose-option.spec.ts`: `#first_name` → `not-a-dropdown`; `#submitBtn` → `REFUSED_EXTERNAL_ACT` / `ruleId:"submit-control"`; `#marketingSelect` → `REFUSED_EXTERNAL_ACT` / `ruleId:"external-act-label"`; `#password` → `REFUSED_EXTERNAL_ACT` / `ruleId:"credential-field"`; `#country` + "Atlantis" → `no-option-match`, `#country.value` unchanged; `#otherSelect` + "Other" → `ambiguous-option` with both labels in `candidates`, control unchanged, then the same call with the disambiguating `value` → `permitted`; `#pronounSelect` + "Prefer not to say" → `option-disabled`; `#skillsSelect` → `multi-select`; creatable combobox + unknown label → `no-option-match` (no option created); SC-004 cross-check — `choose_option` on `#country` (inside `#theform`) is `permitted` while `interact(tab,"click","#locationOptionBerlin")` stays `REFUSED_EXTERNAL_ACT` / `ruleId:"in-form"`; every refusal above grows the log by exactly one `refused` line with the right `ruleId` **or** `reason` and changes no control.

**Checkpoint**: the operation cannot become "activate anything in a form" and never leaves a control in a surprising state.

---

## Phase 6: User Story 4 — selection is audited and verifiable (Priority: P2)

**Goal**: every call appends exactly one log entry; a permitted call's read-back is
enforced; a follow-up read shows the chosen value.

**Independent Test**: one permitted + one refused call → the log grew by exactly two entries with the right outcomes; a follow-up read reports the chosen value for the permitted one.

- [ ] T022 [P] [US4] Extend `tests/integration/choose-option.spec.ts`: run one permitted `choose_option` then one refused `choose_option`; assert the interaction log grew by exactly two lines, outcomes `["permitted","refused"]` in order, the refused line carrying its `reason` or `ruleId` and the permitted line carrying `operation:"choose_option"` + `target`; after the permitted call, `probe` reports the control's current value equal to the chosen option (SC-002). Add a comment that the `read_form_fields` cross-check (SC-007) is asserted once `005` is merged.
- [ ] T023 [US4] Extend `tests/integration/choose-option.spec.ts` with the read-back-sabotage case: `choose_option` on the fixture combobox from T002(d) (renders the option, ignores its `click`) → `CHOOSE_OPTION_FAILED` / `reason:"option-not-appeared"`, the control's displayed value unchanged, the widget left closed, one `refused` log line (proves FR-013 is enforced, not optional).

**Checkpoint**: observability parity with the rest of `interact`; SC-002 / SC-005 demonstrated.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T024 [P] `.specify/memory/constitution.md`: append the one-sentence "choosing an option is preparation" clause to Principle I's "Value entry is preparation" bullet; add the **1.3.0** Amendment History entry; set the version header to `**Version**: 1.3.0 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-08-30` — verbatim wording in research.md R12 (FR-017). No Sync Impact Report block.
- [ ] T025 [P] `README.md`: add `choose_option` to the `interact` operations list with a one-line description (exact-match option selection for `<select>` / combobox; never submits); confirm "What the app will not do" is still accurate.
- [ ] T026 [P] `specs/001-open-any-url/contracts/mcp-tools.md`: add `choose_option` to the documented `interact` operation enum and note it never submits / never presses Enter (doc parity with the code).
- [ ] T027 [P] Grep the repo for "click, fill, scroll" / "click / fill / scroll / space" operation lists (e.g. `src/main/page/interact.ts` header, `src/main/mcp/tools.ts`) and make each include `choose_option`; verify no stray "four operations" / "four interaction primitives" wording remains.
- [ ] T028 `src/main/page/interact.ts` + `src/main/mcp/tools.ts`: final review of the `interact` tool description and file header against FR-018 — valid targets, exact-match semantics, read-back verification, whole-operation refusal for non-choosers and rule matches, never submits, never Enter; tighten wording if T011/T008 left gaps.
- [ ] T029 Full gate: `npm run build && npm run lint && npm run test && npm run test:e2e` all clean.
- [ ] T030 Walk `quickstart.md` §1–§7; confirm SC-001…SC-007 are each demonstrated by a check above (SC-007's `005`→`006`→`004` chain asserted in isolation — `choose_option` half only — until `004`/`005` merge).

---

## Dependencies & Execution Order

### Phase order

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** → **Phases 3–6 (US1–US4)** → **Phase 7 (Polish)**.
- Phase 2 blocks every user story (types, error code, blocklist coverage, pure helpers, plumbing).
- Phase 7 depends on US1–US4 being done (the gate and quickstart walk exercise all four).

### User-story dependencies

- **US1 (P1)** — needs only Phase 2. First real `chooseOption` mechanics land here (`applyNativeSelect` + the shared success/refusal audit wiring in T014).
- **US2 (P1)** — needs Phase 2 and the T014 audit-wiring pattern (T017 reuses it). Otherwise independent of US1; touches the same `choose-option.ts` and `choose-option.spec.ts` so it runs after US1 on the serial spine.
- **US3 (P1)** — needs the refusal branches created in T009 (foundational) and the per-kind failure signals from T013 / T016; T019 hardens them, T020/T021 test them. Independent feature-wise; serial on the shared files.
- **US4 (P2)** — needs a working permitted path (US1 or US2) and at least one refusal path (US3). Pure test additions plus the sabotage case.

### Within the choose-option.ts serial spine

T006 (pure helpers) → T009 (probe + orchestration skeleton) → T013 (`applyNativeSelect`) →
T014 (native wiring) → T016 (`applyCustomCombobox`) → T017 (combobox wiring) → T019
(refusal hardening) → T023 is a test, not this file — spine ends at T019.

---

## Parallel Opportunities

- **Setup**: T001 ∥ T002.
- **Foundational**: T003 ∥ T004 (∥ each other), then T005; T006 after T003; T007 after T006;
  T008 after T006; then T010 ∥ T011 (different files) after T008; T012 last.
- **Polish**: T024 ∥ T025 ∥ T026 ∥ T027 (four different files), then T028, T029, T030.
- Test files: `choose-option.test.ts` (T007, T020) and `choose-option.spec.ts` (T015, T018,
  T021, T022, T023) are each a single-file serial chain; the two chains are `[P]` relative
  to each other.

## Parallel example: Foundational kickoff

```bash
Task: "T003 [P] src/shared/types.ts — InteractOperation + choose_option, ChooseOptionReason, ChosenOption, InteractionLogEntry.reason?"
Task: "T004 [P] src/main/errors.ts — ErrorCode + CHOOSE_OPTION_FAILED, ErrorDetails + reason?/candidates?"
# then serially: T005 (blocklist) → T006 (pure helpers) → T007 (unit) ∥ T008 (interact wiring)
```

---

## Implementation Strategy

### MVP (US1 only)

Phase 1 → Phase 2 → Phase 3, then **stop and validate**: `choose_option` sets `#country` by
label and by value on `form.html`, submits nothing, writes one audit line. That alone
unblocks the three Education `<select>`s on the Legion form (SC-001, partial).

### Incremental delivery

1. Setup + Foundational → operation registered, helpers tested, existing behaviour untouched (T012).
2. + US1 → native `<select>` selection (MVP).
3. + US2 → custom combobox selection (Country / Location on the Legion form).
4. + US3 → refusal surface locked down; `in-form` non-interference proven.
5. + US4 → audit + read-back guarantees demonstrated.
6. + Polish → constitution 1.3.0, docs, full gate, quickstart walk.

### Notes

- `choose-option.ts` is a serial spine — do T006 → T009 → T013 → T014 → T016 → T017 → T019 in order.
- Commit after each task or logical pair. Do not commit with the gate (T029) red.
- The constitution amendment (T024) is a required deliverable of this feature (FR-017), not optional polish.
- No import of feature 004 / 005 code — neither is implemented; only the approach is shared.
