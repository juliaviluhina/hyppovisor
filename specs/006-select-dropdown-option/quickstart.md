# Quickstart: Validate "Choose an Option in a Dropdown"

Proves: one `choose_option` call makes a native `<select>` and a custom combobox hold a
named option, firing the change events a real choice makes and submitting nothing; wrong or
dangerous targets each refuse with their own `code`/`reason` and change no control; `in-form`
never refuses a real chooser while a raw `click` on the same option element still does; every
call — permitted or refused — writes exactly one interaction-log entry; and the constitution
carries the 1.3.0 clarifying amendment.

## Prerequisites

- `npm install`; Node ≥ 22.
- `npm run build` clean after the type, config, and `errors.ts` additions.
- `tests/fixtures/form.html` extended with:
  - a **closed** react-select-style combobox whose `[role="option"]` elements are inserted
    only when it is opened (US2 scenario 1);
  - a combobox with a filter `<input>` that narrows a longer option list (US2 scenario 2);
  - a combobox whose option list is populated after a delay longer than
    `HYPPO_CHOOSE_OPTION_WAIT_MS` in the test env, i.e. never within budget (US2 scenario 3);
  - a `<select>` whose accessible name reads as consent/outward action ("I agree to receive
    marketing email") (US3 scenario 2);
  - a `<select>` with two `<option>`s sharing the visible label "Other" (US3 scenario 5);
  - a `<select>` with a `disabled` `<option>` "Prefer not to say" (US3 scenario 6);
  - a `<select multiple>` (Edge Cases / FR-020);
  - a combobox that exposes its listbox via `aria-owns` rather than a descendant
    (FR-002 clause 3);
  - a "creatable" combobox whose typed label is not among its options (FR-008).
  The existing `#country` `<select>` and `#locationCombobox` (already an open listbox) cover
  US1 and part of US2.

## 1. Unit — matching, classification, rule coverage, reason mapping (`tests/unit/choose-option.test.ts`)

```
npm run test -- choose-option
```

Expected:

- `matchOption(options, want)` — every branch of [research.md](./research.md) R5 / the
  contract's matching table:
  - `value` only: hit, miss (`no-option-match`), duplicate values → first in order.
  - `label` only: exact hit (case/whitespace-insensitive), miss, two matches →
    `{ ok: false, reason: "ambiguous-option", candidates: ["Other", "Other"] }`.
  - both: `value` hit whose label agrees → ok; `value` hit whose label disagrees →
    `no-option-match`.
  - matched option `disabled` → `{ ok: false, reason: "option-disabled" }`.
- `chooserKindFor(x)` — `<select>` → `native-select`; `<select multiple>` → `null` (+ the
  caller's `multi-select`); `role="combobox"` → `custom-combobox`; `role="listbox"` →
  `listbox`; a `<div aria-owns>`→listbox → `custom-combobox`; a plain `<div>` → `null`.
- `ruleCovers(appliesTo, "choose_option")` — `true` for `activation`, `fill-or-space`,
  `both`; `false` for `click`. Hence `matchBlocklist(d, "choose_option")` is blocked for a
  `submit-control` / `consent-toggle` / `external-act-label` / `credential-field` descriptor
  and **not** blocked for a plain in-form `<select>` descriptor.
- Each `ChooseOptionReason` maps to `code: "CHOOSE_OPTION_FAILED"`; a rule match maps to
  `code: "REFUSED_EXTERNAL_ACT"` with `ruleId`.

Ref: [data-model.md](./data-model.md) §2–§9, [contracts/choose-option.md](./contracts/choose-option.md).

## 2. Integration — US1: native `<select>` inside a form (`tests/integration/choose-option.spec.ts`)

Load `form.html`, then via the e2e `interact` handle:

- `interact(tab, "choose_option", "#country", undefined, "United States")` → result
  `outcome: "permitted"`, `chosenOption: { label: "United States", value: "us" }`.
  `probe` `document.querySelector("#country").value === "us"`; `window.__submitted === false`;
  the tab URL is unchanged (SC-002, SC-006).
- `interact(tab, "choose_option", "#country", "us")` (by value) → same result, idempotent on
  a repeat call (FR-012).
- The interaction log grew by exactly one line per call, `operation: "choose_option"`,
  `outcome: "permitted"`, `target: "#country"` (FR-015, US1 scenario 4).

## 3. Integration — US2: custom combobox

- **Closed react-select combobox**: `choose_option` with a valid label → the option menu
  opens, the matching `[role="option"]` is activated, the menu **closes**
  (`aria-expanded === "false"` / listbox gone), and the widget's displayed value is that
  option. `window.__submitted === false` (SC-006).
- **Filter combobox**: `choose_option` with a label present only after filtering → the app
  types the label into the filter input, waits, activates the single exact match; a label
  that only *prefixes* an option is **not** matched (`no-option-match`).
- **Async-never-render combobox** (test env sets `HYPPO_CHOOSE_OPTION_WAIT_MS=300`):
  `choose_option` → `CHOOSE_OPTION_FAILED` / `reason: "option-not-appeared"`; the control's
  displayed value is unchanged; the widget is left closed (US2 scenario 3, FR-010).
- `#locationCombobox` (already-open listbox in the fixture) with "Berlin, Germany" →
  permitted, `chosenOption.label === "Berlin, Germany"`, `window.__chosenOption ===
  "locationOptionBerlin"`.

## 4. Integration — US3: wrong / dangerous targets refuse, control unchanged

From `form.html`:

- `choose_option` on `#first_name` (text input) → `CHOOSE_OPTION_FAILED` /
  `reason: "not-a-dropdown"`.
- `choose_option` on `#submitBtn` → `REFUSED_EXTERNAL_ACT` / `ruleId: "submit-control"`.
- `choose_option` on the consent-worded `<select>` → `REFUSED_EXTERNAL_ACT` /
  `ruleId: "external-act-label"` (a consent-worded `role="checkbox"` combobox → `ruleId:
  "consent-toggle"`).
- `choose_option` on `#password` → `REFUSED_EXTERNAL_ACT` / `ruleId: "credential-field"`.
- `choose_option` on `#country` with label `"Atlantis"` → `CHOOSE_OPTION_FAILED` /
  `reason: "no-option-match"`; `#country.value` unchanged.
- `choose_option` on the duplicate-"Other" `<select>` with label `"Other"` →
  `CHOOSE_OPTION_FAILED` / `reason: "ambiguous-option"`, `candidates` lists both; control
  unchanged. Supplying the disambiguating `value` → permitted.
- `choose_option` on the disabled-option `<select>` with label `"Prefer not to say"` →
  `CHOOSE_OPTION_FAILED` / `reason: "option-disabled"`.
- `choose_option` on the `<select multiple>` → `CHOOSE_OPTION_FAILED` /
  `reason: "multi-select"`.
- `choose_option` on the creatable combobox with an unknown label → `CHOOSE_OPTION_FAILED` /
  `reason: "no-option-match"` (no option created) (FR-008).
- **SC-004 cross-check**: `choose_option` on `#country` (in `#theform`) is **permitted** —
  `in-form` did not refuse it — while `interact(tab, "click", "#locationOptionBerlin")` (the
  option element inside the form) is still `REFUSED_EXTERNAL_ACT` / `ruleId: "in-form"`.

Every refusal above: the log grew by exactly one line with `outcome: "refused"` and the
right `ruleId` **or** `reason` (SC-003, SC-005); no control changed.

## 5. Integration — US4: audited and verifiable

- One permitted `choose_option` + one refused `choose_option` → the interaction log grew by
  exactly **two** lines, outcomes `permitted` then `refused`, the refused line carrying its
  `reason`/`ruleId` (SC-005).
- After the permitted call, `probe` reports the control's current value equal to the chosen
  option (SC-002). (When `005` is merged, a `read_form_fields` follow-up reports the same —
  assert via `probe` until then.)

## 6. MCP surface

- The `interact` tool's `operation` enum includes `choose_option`; its input schema accepts
  `label`. Still six tools total (`read_page` unchanged).
- The tool description names `choose_option`: valid targets (`<select>` / `role=combobox` /
  `role=listbox` / an owner of a `role=listbox`), exact-match semantics, read-back
  verification, whole-operation refusal for non-choosers and rule matches, never submits,
  never presses Enter (FR-018).

## 7. Docs / constitution / final gate

- `.specify/memory/constitution.md`: Principle I carries the one-line "choosing an option is
  preparation" clause; Amendment History has the **1.3.0** entry; the version header reads
  `1.3.0` / Last Amended `2026-08-30` (FR-017).
- `README.md`: the `interact` operations list includes `choose_option`; "What the app will
  not do" still accurate (adds no external act).
- `specs/001-open-any-url/contracts/mcp-tools.md`: `interact` operation enum lists
  `choose_option` (doc-parity sweep).
- `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e` all clean.
- **SC-001**: on `form.html`, all single-select dropdowns (`#country`, the combobox
  variants) are each set in one `choose_option` call with `window.__submitted === false`.
- **SC-007** chain: read options (`005`, when merged) → `choose_option` each → `004` batch
  `fill` the plain fields → a complete draft, nothing submitted. Until `004`/`005` merge,
  assert the `choose_option` half in isolation.

## Done when

§1–§5 pass, §6 verified, §7 docs + `build`/`lint`/`test`/`test:e2e` clean, and SC-001…SC-007
are each demonstrated by one of the checks above.
