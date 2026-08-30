# Contract: `interact` operation `choose_option` (feature 006)

A new operation on the **existing** `interact` tool. Not a new tool. `click` / `fill` /
`scroll` / `space` are unchanged (FR-019). `read_page` and the six-tool surface are
unchanged.

## Input schema

```
interact({
  tabId:     string,           // required
  operation: "choose_option",  // required
  selector:  string,           // required — the chooser control
  label?:    string,           // option's visible label (case-insensitive, whitespace-collapsed)
  value?:    string,           // option's value (exact match, no trim/case)
})
```

- At least one of `label` / `value` MUST be present. Neither → `CHOOSE_OPTION_FAILED` /
  `reason: "no-option-match"`, message "choose_option requires `label` or `value`", nothing
  touched.
- `label` and `value` both present → `value` selects the option and its label must also
  match `label` (else `no-option-match`).
- unknown / closed `tabId` → `TAB_NOT_FOUND`.
- `selector` resolves to nothing, or the control is removed mid-operation → `TARGET_NOT_FOUND`.

## Valid targets (FR-002)

A *chooser*, defined exactly as:

1. a `<select>` that is **not** `[multiple]`;
2. an element with `role="combobox"` or `role="listbox"`;
3. an element whose `aria-controls` or `aria-owns` resolves to a node with `role="listbox"`.

Anything else → `CHOOSE_OPTION_FAILED` / `reason: "not-a-dropdown"`. No class-name,
framework-name, or structural guessing. A `<select multiple>`, an
`aria-multiselectable="true"` combobox/listbox, or a multi-value widget →
`CHOOSE_OPTION_FAILED` / `reason: "multi-select"` (FR-020).

## Blocklist gate (FR-003)

`matchBlocklist(descriptor, "choose_option")` runs first. A match on `submit-control`,
`consent-toggle`, `external-act-label`, or `credential-field` → the whole operation is
refused with `REFUSED_EXTERNAL_ACT`, `ruleId`, `ruleDescription` — the existing refusal
shape. **`in-form` does NOT gate `choose_option`** (SC-004): a real chooser inside a
`<form>` proceeds.

## Success output

Through the `interact` tool:

```
{
  "tabId": "…",
  "operation": "choose_option",
  "outcome": "permitted",
  "chosenOption": { "label": "United States", "value": "us" },
  "queueDepth": 0
}
```

`chosenOption` is the **matched option's** verbatim label and value (FR-014). A permitted
result is returned only after read-back confirms the control holds that option (FR-013).

## Refusal output

Existing shape — `{ error: { code, message, ...details } }`:

| Scenario (spec ref) | `code` | `details` |
|---------------------|--------|-----------|
| chooser matches `submit-control` / `consent-toggle` / `external-act-label` / `credential-field` (US3-2, FR-003) | `REFUSED_EXTERNAL_ACT` | `ruleId`, `ruleDescription` |
| target is not a chooser (US3-1, FR-002) | `CHOOSE_OPTION_FAILED` | `reason: "not-a-dropdown"` |
| no option matches `label`/`value`; creatable combobox unknown label; both-supplied contradiction (US3-4, FR-004/005/008) | `CHOOSE_OPTION_FAILED` | `reason: "no-option-match"` |
| >1 option matches the label, no `value` (US3-5, FR-006) | `CHOOSE_OPTION_FAILED` | `reason: "ambiguous-option"`, `candidates: string[]` |
| matched option is disabled (US3-6, FR-007) | `CHOOSE_OPTION_FAILED` | `reason: "option-disabled"` |
| async option list never renders the match in budget, or read-back mismatch (US2-3, FR-010/013) | `CHOOSE_OPTION_FAILED` | `reason: "option-not-appeared"` |
| `<select multiple>` / multi-value combobox (Edge Cases, FR-020) | `CHOOSE_OPTION_FAILED` | `reason: "multi-select"` |
| control removed mid-operation (Edge Cases) | `TARGET_NOT_FOUND` | `cause?` |

Every refusal leaves the control unchanged.

## Behavioural contract

### Matching (FR-004–FR-008)

`norm(s) = s.trim().replace(/\s+/g," ").toLowerCase()` on labels only; `value` is compared
exactly.

- `value` only → option with `opt.value === value` (first, in document order, if duplicates).
- `label` only → options with `norm(opt.label) === norm(label)`; exactly one → chosen;
  zero → `no-option-match`; two+ → `ambiguous-option` + `candidates`.
- both → the `value` match, then require `norm(option.label) === norm(label)`.
- No fuzzy, prefix, or substring matching. No option creation.
- A matched-but-disabled option → `option-disabled`.

### Mechanics (FR-009–FR-012)

- **native `<select>`**: set the value, dispatch `input` + `change` (bubbling). No open/close.
- **custom combobox / listbox**: MAY open the menu (click the chooser) and MAY type `label`
  into the widget's own filter input to narrow the list; MUST activate only the single
  exactly-matching `role="option"`; MUST leave the widget **closed** afterward.
- Bounded wait ≤ `config.chooseOptionWaitMs` (default = `defaultWaitMs`) for an async option
  list to render.
- The app dispatches only the events a real option choice produces. It never presses Enter,
  never navigates, never submits (FR-011). A page's own `onchange`/jump-menu handler that
  submits is a documented residual risk (Edge Cases), not something the app can prevent from
  a selector.
- Selecting on a control that already holds a value replaces it; repeating the same
  `choose_option` call is idempotent (FR-012).

### Read-back verification (FR-013)

After activation the app re-reads the control (`<select>.value` + selected option text; or
the combobox's displayed value / `aria-selected` option / `aria-activedescendant`). If it
does not match the chosen option → `CHOOSE_OPTION_FAILED` / `reason: "option-not-appeared"`,
control reported unchanged (native `<select>` value is reverted; a custom widget is left
closed and uncommitted).

### Audit (FR-015)

Exactly one `interaction-log.jsonl` entry per call:

- permitted → `operation: "choose_option"`, `target: <selector>`, `outcome: "permitted"`,
  `ruleId: null`, `error: null`.
- rule refusal → `outcome: "refused"`, `ruleId: <id>`.
- non-rule refusal → `outcome: "refused"`, `ruleId: null`, `reason: <ChooseOptionReason>`.
- mid-op failure → `outcome: "error"`, `error: <message>`.

## Non-goals (unchanged by this contract)

- Deselecting or clearing a selection.
- Multi-select / multi-value controls (refused `multi-select`).
- Creating options in creatable comboboxes (refused `no-option-match`).
- Date / colour / file pickers — not choosers here.
- Cascading dependent dropdowns beyond the caller issuing separate calls in order.
- Any change to `click` / `fill` / `scroll` / `space`, to submit/consent/credential
  handling, or to `in-form`'s effect on `click`.
- No new tool; no persistence; no change to `read_page`.
