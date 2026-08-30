# Quickstart / Validation: Form-Filling Robustness

Runnable checks that prove the feature end-to-end. Assumes `npm run build` is green and the
Electron binary is installed. The integration suite runs offline against local fixtures.

## Prerequisites

```bash
npm install
npm run build
```

New fixtures this feature adds:

- `tests/fixtures/combobox.html` — a scripted dropdown whose `[role="option"]` nodes are
  injected only after the control is clicked, backed by a hidden `<input type="hidden"
  name="q_role">` value-mirror. Also a native `<select>` and a `<select multiple>`.
- `tests/fixtures/form.html` — extended with: a `maxlength=20 pattern="[0-9]*"
  inputmode="numeric"` field; a set of `required` fields left empty; a plain
  `<button type="button">`.

## 1. Bounded, scoped form reads (US2 / SC-003, SC-004)

```bash
npx playwright test tests/integration/read-form-fields.spec.ts
```

Expect:

- A whole-page read of `form.html` returns `truncated: false` and a payload whose
  `JSON.stringify` length is ≤ 64 KB (assert with a lowered `HYPPO_FORM_FIELD_READ_MAX_BYTES`
  to force `truncated: true` and confirm tail records drop in document order).
- A read with `fields: ["#first_name", "#email", "#q_role"]` returns exactly three records,
  in that document order, and `#q_role` (the hidden mirror) IS present because it was named.
- A default read does **not** contain the plain `<button type="button">` or the hidden
  mirror; the same read with `includeNonInteractive: true` contains both, the mirror tagged
  `interactive: false` + `mirrors`.
- A read with `only: "required-unfilled"` returns only the empty required set.
- Every text record for the constrained field carries `maxLength: 20`, `pattern: "[0-9]*"`,
  `inputMode: "numeric"`.

## 2. Enumerate a scripted dropdown's options (US1 / SC-001, SC-005, SC-008, SC-009)

```bash
npx playwright test tests/integration/list-options.spec.ts
```

Expect:

- `interact { operation: "list_options", selector: <combobox.html scripted widget> }`
  returns every injected option label with `disabled` flags; afterward the control's shown
  value is unchanged, the menu is closed, and `list_open_tabs` / the audit log show **no new
  entry** (assert the `interaction-log.jsonl` line count is identical before/after).
- The native `<select>` returns its options with `optionsPresent: true` and no open/close.
- The `<select multiple>` and a plain `<div>` both return `CHOOSE_OPTION_FAILED` /
  `reason: "not-a-dropdown"`; page unchanged.
- A widget wired to never inject options returns `options: []`, `optionsPresent: false`, no
  error (lower `HYPPO_CHOOSE_OPTION_WAIT_MS` to keep it fast).
- Pointed at a submit button / a consent checkbox / a password field, `list_options` is
  refused `REFUSED_EXTERNAL_ACT` with the same `ruleId` `choose_option` gives there
  (parity assertion, control-by-control).

## 3. Selector + operation hygiene (US3 / SC-005)

Within `read-form-fields.spec.ts`:

- `combobox.html`'s scripted widget appears as **one** record; its `selector` fed straight
  into `interact { operation: "choose_option" }` succeeds on the **first** try (no
  `not-a-dropdown`).
- Each record's `operation` matches its kind (`text`→`fill`, the combobox→`choose`, the
  checkbox→`activate`, the file input→`none`).
- The file input's `chooseVerdict.allowed` is `false`; a plain in-form text field's
  `chooseVerdict` is irrelevant but its `operation` is `fill` and `fillVerdict.allowed` is
  `true`.

## 4. Invalid-selector feedback (US5 / SC-006)

Within `interaction.spec.ts` and `read-form-fields.spec.ts`:

- `interact { operation: "click", selector: "a:has-text('Apply')" }` →
  `INVALID_SELECTOR`, message names the unsupported forms. Not `TARGET_NOT_FOUND`.
- Same for `operation: "list_options"`, for `wait_for_selector`, for
  `read_form_fields { containerSelector: "div:has-text('x')" }`, and for a bad entry inside
  `read_form_fields { fields: [...] }`.
- `interact { selector: "#definitely-not-here" }` (valid CSS, no match) still →
  `TARGET_NOT_FOUND`.

## 5. Screenshot (US4 / SC-007, SC-008, SC-010)

```bash
npx playwright test tests/integration/screenshot.spec.ts
```

Expect:

- `screenshot { tabId }` returns an image content block + metadata with `width`/`height`
  > 0, `scale: 1`, `format: "jpeg"`, and a byte length ≤ 256 KB.
- `screenshot { tabId, maxBytes: 20000 }` returns `scale < 1` and/or a lower effective
  quality, `limitNotMet` set truthfully, and a payload at or near the floor.
- `screenshot { tabId, selector: "#first_name" }` returns an image whose dimensions match
  that input's bounding box (± rounding); `element` echoes the selector.
- `screenshot { tabId, selector: "#hidden-zero-size" }` → `SCREENSHOT_FAILED` ("not
  renderable").
- `screenshot { tabId, fullPage: true }` on a tall fixture returns `height` >> viewport
  height and `fullPage: true`.
- Before/after: the `userData` dir gains no file and `interaction-log.jsonl` is unchanged.

## 6. Consistency guard (SC-010)

```bash
npx vitest run tests/unit/connection-snippets.test.ts
```

The About-text guard already iterates `TOOL_NAMES`; it fails if `screenshot` is missing from
the panel's copyable description. Manually confirm the README tool table and
`specs/001-open-any-url/contracts/mcp-tools.md` list `screenshot`.

## 7. Full gate

```bash
npm run build && npm run lint && npm test && npm run test:e2e
```

`test:e2e` needs local port 7357 free (unrelated connection-panel tests bind it).

## Acceptance run (SC-001, SC-002)

Drive `tests/fixtures/combobox.html` + the extended `form.html` as a stand-in for the
60-control application form: one `read_form_fields` (default, bounded), one `list_options`
per scripted dropdown, one batch `fill` for the text fields, one `choose_option` per
dropdown using the selector from the read, one scoped `fields` re-read to confirm, one
`screenshot` to eyeball state. Assert: no response spilled to a file, no blind option
guess, no `not-a-dropdown` refusal, total call count materially below the captured baseline.
