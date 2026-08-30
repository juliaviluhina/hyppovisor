# Contract: `read_form_fields` (feature 005)

A new, seventh MCP tool. Read-only. `read_page` is unchanged (FR-015). The tool performs no
interaction, writes nothing to the shared data directory (FR-013), and appends no
interaction-audit-log entry (FR-014).

## Input schema

```
read_form_fields({
  tabId:             string,    // required
  containerSelector: string?,   // optional — scope to controls inside this element
})
```

- `containerSelector` omitted → every form control on the page, in document order.
- `containerSelector` given and resolves to one element → only controls inside it.
- `containerSelector` given and resolves to nothing → `TARGET_NOT_FOUND`.
- unknown / closed `tabId` → `TAB_NOT_FOUND`.

## Output — `FormFieldMap`

```
{
  "tabId": "...",
  "url": "https://...",
  "observedAt": "2026-08-30T12:34:56.000Z",
  "truncated": false,
  "records": [
    {
      "selector": "#first_name",
      "selectorSynthesised": false,
      "duplicateId": false,
      "kind": "text",
      "type": "text",
      "label": "First Name",
      "required": true,
      "group": null,
      "inFormAncestor": true,
      "visible": true,
      "currentValue": "",
      "options": [],
      "optionsAvailable": false,
      "optionsTruncated": false,
      "fillVerdict": { "verdict": "permitted" },
      "clickVerdict": { "verdict": "refused", "ruleId": "in-form",
                        "ruleDescription": "Target is a clickable control inside a <form> element; clicking it risks a submission." }
    },
    {
      "selector": "#password",
      "selectorSynthesised": false, "duplicateId": false,
      "kind": "text", "type": "password",
      "label": "Password",
      "required": false, "group": null, "inFormAncestor": true, "visible": true,
      "options": [], "optionsAvailable": false, "optionsTruncated": false,
      "fillVerdict": { "verdict": "refused", "ruleId": "credential-field",
                       "ruleDescription": "Target is a credential input; the app never fills credentials." },
      "clickVerdict": { "verdict": "refused", "ruleId": "in-form", "ruleDescription": "..." }
    }
  ],
  "queueDepth": 0
}
```

Note the `#password` record has **no `currentValue` key at all** (FR-005 / SC-005) — not
`null`, not `""`, not a placeholder.

### Field reference

See [data-model.md](../data-model.md) §3 (`FormFieldRecord`), §2 (`FieldOption`),
§1 (`FieldVerdict`), §4 (`FormFieldMap`).

## Behavioural contract

### Selection (FR-002, FR-003)

- Controls covered: `<input>` (every type), `<select>`, `<textarea>`, `<button>`,
  `contenteditable` regions, and elements with a form-ish ARIA role (`combobox`, `listbox`,
  `textbox`, `checkbox`, `radio`, `switch`, `button`).
- Order: document order, always.
- Hidden controls are **included** with `visible: false` (spec Edge Cases — Greenhouse's
  real file input is hidden).
- Empty result (no controls) → `records: []`, not an error.
- Shadow DOM / cross-origin `<iframe>` controls are not traversed (out of scope).

### Selector (FR-004, Assumptions)

Preference, first that is unique within the scope root: `#id` → `[name="…"]` (tag-qualified
if needed) → synthesised `nth-of-type` path. Every emitted selector is verified to resolve
to exactly one element at call time. `selectorSynthesised` / `duplicateId` flag the
fallbacks.

### `currentValue` (FR-005)

Text value / `checked` boolean / selected option value(s) / `null` for file & button.
**Omitted entirely** for a credential field (`type="password"` or a credential
`autocomplete`).

### Verdicts (FR-006, FR-007, SC-004)

`fillVerdict` and `clickVerdict` are computed from the **same** `blocklist.ts` functions
`interact` uses (`matchBlocklist` + `isSafeFillTarget`). For any control, passing its
`selector` to `interact` with the matching operation MUST produce the same
permitted/refused + `ruleId` outcome. `in-form` appears in `clickVerdict` (it gates
`click`) and never in `fillVerdict` (it does not gate `fill`).

### Options (FR-008, SC-006)

- `<select>` → all `(label, value)` pairs in document order, `optionsAvailable: true`.
- combobox / listbox with option elements in the DOM → those options,
  `optionsAvailable: true`.
- combobox with no option elements in the DOM → `options: []`,
  `optionsAvailable: false`. The reader never opens a menu.
- More than `formFieldOptionCap` options → truncated to the cap in document order,
  `optionsTruncated: true`.

### Truncation (FR-010)

More than `formFieldControlCap` controls → the first cap-many in document order,
result-level `truncated: true`.

### Storage & audit (FR-013, FR-014)

- Nothing written to the shared data directory; the payload is the only copy.
- No interaction-audit-log entry — the interaction log's line count is unchanged by this
  call.

## Non-goals (unchanged by this contract)

- No interaction of any kind — no menu open/close, option select, fill, or click.
- No value inference or field ranking.
- No non-form page content (that is `read_page`).
- No Shadow DOM / cross-origin iframe traversal.
- No change watching / streaming — a point-in-time snapshot.
- No persistence or caching of the map.
- No new `ErrorCode`; no constitution amendment (FR-016).
