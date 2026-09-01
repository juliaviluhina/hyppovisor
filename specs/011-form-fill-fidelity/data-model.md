# Phase 1 Data Model: Form-Fill Fidelity

Deltas only. Every shape not listed is unchanged from features 003–008.

---

## `TargetDescriptor` (`src/shared/types.ts`, built in `src/main/safety/blocklist.ts`)

| Field | Change | Notes |
|---|---|---|
| `name` | **semantics narrowed** | For a **value-bearing** control (`<textarea>`, `isContentEditable`, `<input>` of a `SAFE_FILL_TYPES` / bare-text type) `name` is now built from the accessible-name sources only — associated `<label>`, `aria-label`, `aria-labelledby`, `placeholder`, `title`. The element's own `innerText` / `value` / `textContent` fallback are **excluded**. For every other element (`<button>`, `<input type=submit\|button\|reset\|image>`, links, toggles) `name` is unchanged — `innerText` / `value` stay in, because there they are the caption the safety rules must read. |
| `formAction` | **new** — `string \| null` | `el.getAttribute("formaction")`, lowercased. `null` when absent. Read by the narrowed `in-form` rule only. |

`name` remains a single lowercased, whitespace-collapsed string. The
`ACCESSIBLE_NAME_SOURCES_BODY` snippet is unchanged; `DESCRIPTOR_BODY` gains the
value-bearing branch and the `formAction` field. Both `interact` (`targetDescriptorScript`)
and `read_form_fields` (`descriptorFor`) consume the same snippet, so `fillVerdictFor` /
`clickVerdictFor` / `chooseVerdictFor` stay in lock-step (feature 005 SC-004).

### Blocklist rule changes

| Rule | Change |
|---|---|
| `external-act-label` | No code change to the rule body (`hasExternalActWord(d.name)`). Its behaviour changes only because `d.name` no longer carries a value-bearing control's own draft. |
| `in-form` | `matches` becomes `d.hasFormAncestor && !(d.tagName === "button" && d.type === "button" && d.formAction === null)`. `description` updated to name the carve-out. **Depends on constitution 1.4.0.** |

`fillVerdictFor`, `clickVerdictFor`, `chooseVerdictFor` — unchanged bodies; pure; verdict is
a function of the descriptor at call time (US3).

---

## `FillResult` — new return shape for the single-`fill` path

`interact(wc, log, tabId, "fill", selector, value)` currently resolves `void`. It now
resolves:

```ts
interface FillResult {
  /** el.value (or el.innerText for contentEditable) read back after the write,
   *  post-formatting. Omitted for a credential-field target (FR-007). */
  currentValue?: string;
}
```

On a lost write the path **throws** `HyppoError("WRITE_NOT_APPLIED", …, { currentValue })`
instead of resolving — see contract. The batch path (`fillBatch`) is unchanged in shape:
it already reports one entry per field with an `outcome` of `written` / `error` / `refused`;
a `WRITE_NOT_APPLIED` thrown for one entry is caught and recorded as that entry's `error`
outcome with the reason, and the remaining entries still run (existing mid-write behaviour,
`interact.ts:552`).

### `WRITE_NOT_APPLIED` — new error code (`src/main/errors.ts`)

```
"WRITE_NOT_APPLIED"
```

`ErrorDetails` gains one optional field:

| Field | Type | Set when |
|---|---|---|
| `currentValue` | `string` | Always, for `WRITE_NOT_APPLIED` — the value read back after the failed write (empty string if the field is empty). For a credential target, omitted; the message states only that the field did not accept the value. |

---

## `FormFieldRecord` (`src/main/page/form-fields.ts`, `src/shared/types.ts`)

Default (unscoped, no `includeNonInteractive`) record — the **options triplet** becomes
optional and is dropped from a non-dropdown record:

| Field | Default record | `includeNonInteractive: true` |
|---|---|---|
| `options` | present only for a dropdown kind (`select` / `combobox` / `listbox`); omitted otherwise | present for every record |
| `optionsAvailable` | dropdown kinds only | present for every record |
| `optionsTruncated` | dropdown kinds only | present for every record |

**Scope note (revised during implementation).** research R6 first proposed also moving
`selectorSynthesised` and `duplicateId` behind `includeNonInteractive`. They stayed in the
default record: they are ~50 bytes, they flag a fragile suggested selector (core to the
fill workflow, not a rarely-read diagnostic), and existing `read_form_fields` tests depend
on them in the default read. The bulk saving on a big form is the ~3-field options triplet
removed from every non-dropdown control; that is enough to keep a ~60-control form's
unprojected read inside the 64 KB budget without trimming.

Always present in every record, unchanged: `selector`, `selectorSynthesised`, `duplicateId`,
`kind`, `type`, `label`, `required`, `group`, `inFormAncestor`, `visible`, `currentValue`
(credential omitted), `operation`, `fillVerdict`, `clickVerdict`, `chooseVerdict`, and the
feature-008 optionals `maxLength` / `pattern` / `inputMode` when the control declares them.

`interactive: false` on a plain button and the value-mirror cluster fields
(`mirrorsField` / `mirrorOfSelector`) are unchanged — already gated behind
`includeNonInteractive`.

A read that passes `fields` or `only` returns the same records it does today (the moved
fields are still included for a scoped read, so an existing scoped caller sees no diff) —
**or**, simpler and preferred: the projection is identical everywhere and `fields` / `only`
responses also carry the lean record. To confirm in `/speckit-tasks`: FR-024 only requires
that a caller *already passing* `fields` / `only` is "unaffected" in the sense of same
records / same scope; dropping four diagnostic booleans from a scoped record is acceptable
if the contract delta says so. **Decision: lean record everywhere; `includeNonInteractive`
restores the diagnostics for any read.**

---

## `ReadFormFieldsOptions`

No new field. `includeNonInteractive` gains a second effect (documented in the contract):
it now also restores `selectorSynthesised` / `duplicateId` / `optionsTruncated` /
`optionsAvailable` and the empty `options` arrays.

---

## Fixtures

| Fixture | Purpose |
|---|---|
| `tests/fixtures/masked.html` (new) | An `MM/YYYY` text input with a JS mask that rebuilds `.value` from `keydown` and drops a bulk `.value` set; a `(###) ###-####` phone mask. Drives US1 acceptance. |
| `tests/fixtures/form.html` (+) | A `<textarea>` whose *initial* value is empty and whose intended draft contains the word "apply", to prove a re-fill is still permitted (US2). A block of required-empty controls for the budget test (US5). |
| `tests/fixtures/expander.html` (+) | An `<button type="button">Add Experience</button>` **inside a `<form>`** that reveals a hidden `<fieldset>` of text inputs; plus a real `<button type="submit">` in the same form that must stay refused (US4). |
