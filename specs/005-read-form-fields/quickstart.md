# Quickstart: Validate "Structured Form-Field Reader"

Proves: one call returns a working selector + kind + verbatim label for every form control
in document order; each control carries the exact `fill` / `click` verdict `interact` would
give; a credential field's value is never in the payload; `<select>` options are listed and
a closed combobox reports none; a container selector scopes the read; caps truncate with a
flag; nothing spills to a file, nothing is written to the shared data dir, and no
interaction-log entry is produced.

## Prerequisites

- `npm install`; Node ≥ 22.
- `npm run build` clean after the type + config additions.
- `tests/fixtures/form.html` extended with: a **second** `<form id="otherform">` holding one
  text input (US4 scoping), one `<input>` with **neither `id` nor `name`** (selector
  synthesis), and a `<fieldset>` radio group of two radios sharing a `name` (`group`).

## 1. Unit — kind, selector, verdict parity, credential omission, caps (`tests/unit/form-fields.test.ts`)

```
npm run test -- form-fields
```

Expected:

- `kindFor(...)` maps each (tag, type, role, contenteditable) combination to the value in
  [research.md](./research.md) R4's table — `password` input → `kind: "text"` with
  `type: "password"`; `<div contenteditable>` → `richtext`; `<div role="combobox">` →
  `combobox`; `<input type="file">` → `file`.
- `fillVerdictFor(d)` / `clickVerdictFor(d)` return exactly what `interact`'s own path
  returns for the same descriptor, across every rule category: `submit-control`,
  `consent-toggle`, `external-act-label`, `credential-field`, `unsafe-fill-type` (fill),
  `in-form` (click only, never fill), and `permitted` for a plain text field.
- A credential descriptor → the built record has **no `currentValue` own-property**
  (`"currentValue" in record === false`).
- Selector synthesis: given a synthetic DOM, an element with a unique `id` → `#id`; a
  duplicate `id` → `duplicateId: true` and a structural selector; an element with only a
  unique `name` → `[name="…"]`; an element with neither → an `nth-of-type` path that
  resolves to exactly one node, `selectorSynthesised: true`.
- With `HYPPO_FORM_FIELD_CONTROL_CAP=3`, a 5-control root → 3 records + `truncated: true`.
  With `HYPPO_FORM_FIELD_OPTION_CAP=2`, a 4-option `<select>` → 2 options +
  `optionsTruncated: true` on that record.

Ref: [data-model.md](./data-model.md) §1–§3, §6; [contracts/read-form-fields.md](./contracts/read-form-fields.md).

## 2. Integration — US1: the field map in one call (`tests/integration/read-form-fields.spec.ts`)

Load `form.html`, then `readFormFields(tabId)`:

- `records` is non-empty and in document order; every visible control has a non-null
  `selector`, a `kind`, and a non-empty `label` (SC-001).
- Passing each record's `selector` back through `interact` (e.g. a no-op `wait_for_selector`
  or a probe) resolves to exactly one element (SC-002).
- The whole result is one tool payload — assert it is returned inline and the app's
  `userData` grew no `tool-results/*` file (SC-003).
- A control that already holds a value reports it in `currentValue`; the interaction log's
  line count is unchanged by the call (US1 scenario 4, FR-014); no capture/content file in
  the shared data dir (SC-007).

## 3. Integration — US2: verdicts match `interact` exactly

From the same map:

- `#submitBtn` → `fillVerdict`/`clickVerdict` `refused` with `ruleId: "submit-control"`.
- `#password` → `fillVerdict` `refused` `credential-field`, **and** `"currentValue" in
  record === false` (SC-005).
- `#resume` (`<input type="file">`) → `fillVerdict` `refused` `unsafe-fill-type`.
- `#agree` (in-form consent checkbox) → `fillVerdict`/`clickVerdict` `refused`
  `consent-toggle`.
- `#first_name`, `#email`, `#phone`, `#website`, `#age`, `#bio`, `#cover` → `fillVerdict`
  `permitted`; their `clickVerdict` is `refused` `in-form` (they sit in `#theform`).
- Cross-check: for a sample of each, call `interact` with the matching operation and assert
  the same permitted/refused + `ruleId` (SC-004).

## 4. Integration — US3: dropdown options

- `#country` (`<select>`) → `options` has 3 `(label, value)` pairs in document order
  (`""`/"Select…", `de`/"Germany", `us`/"United States"), `optionsAvailable: true`,
  `kind: "select"` (SC-006).
- `#locationCombobox` (`role="combobox"`, menu present in the fixture with two
  `[role="option"]`) → `optionsAvailable: true`, `options` lists "Berlin, Germany" /
  "Munich, Germany" verbatim.
- A combobox variant whose option elements are removed from the DOM → `options: []`,
  `optionsAvailable: false`.

## 5. Integration — US4: scoping and oversized page

- `readFormFields(tabId, "#otherform")` → only `#otherform`'s single control is returned.
- `readFormFields(tabId, "#theform")` → every `#theform` control, none from outside it
  (`#safeBtn`, `#connectLink`, `#saveBtn`, `#tos`, `#remoteOnly` absent).
- `readFormFields(tabId, "#no-such-container")` → `TARGET_NOT_FOUND`.
- With `HYPPO_FORM_FIELD_CONTROL_CAP=4` in the launch env, `readFormFields(tabId)` →
  4 records, `truncated: true`, and the 4 are the first 4 in document order.

## 6. MCP surface

- The MCP tool list includes `read_form_fields` (seven tools total); its schema accepts
  `{ tabId }` and `{ tabId, containerSelector }`.
- The tool description says: read-only, returns form controls with selector/kind/label,
  per-control fill & click verdicts, `<select>`/combobox options, credential values omitted,
  bounded with a truncation flag, `read_page` unchanged.

## 7. Docs / final gate

- `README.md` tool table gains a `read_form_fields` row; the "What the app will not do"
  section still accurate (read-only, adds no permission).
- `npm run build`, `npm run lint`, `npm run test`, `npm run test:e2e` all clean.
- Build a `004` batch `fill` from only this reader's `fillVerdict: "permitted"` controls on
  `form.html` → the batch passes `004`'s pre-write check with zero forbidden-target
  refusals (SC-008). (Run once `004` is merged; until then, assert every `permitted`
  selector individually `fill`s without a refusal.)

## Done when

§1–§5 pass, §6 verified, `build` + `lint` + `test` + `test:e2e` clean, and SC-001…SC-008
are each demonstrated by one of the checks above.
