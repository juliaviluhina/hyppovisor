# Contract: `interact` MCP tool (revised for feature 003)

The only interface change in this feature is to the existing `interact` tool. No new tool.
Tool count stays at six (constitution Architecture Constraints).

## Input schema

```
interact({
  tabId:     string,                                  // required
  operation: "click" | "fill" | "scroll" | "space",   // "space" is new
  selector?: string,                                  // required for click/fill; ignored for space; scroll optional
  value?:    string,                                   // fill: the text to enter; scroll: pixels; ignored otherwise
})
```

- `operation: "space"` takes **no** `selector` and **no** `value`. If a `selector` is
  supplied it is ignored (the target is always `document.activeElement`).
- `operation: "fill"` still requires `selector`; `value` is the full replacement string.

## Output — success

```
{ "tabId": "...", "operation": "click|fill|scroll|space", "outcome": "permitted", "queueDepth": <n> }
```

## Output — refusal (unchanged shape)

```
{ "error": {
    "code": "REFUSED_EXTERNAL_ACT",
    "message": "Refused <operation> on <target>: <ruleDescription> The app never performs an external act (constitution Principle I).",
    "ruleId": "<rule id | unsafe-fill-type>",
    "ruleDescription": "<text>"
} }
```

Plus `isError: true` on the tool result.

## Behavioral contract

### `fill`

| Case | Result |
|------|--------|
| Target inside a `<form>`, plain input of a safe type (`text`/`email`/`tel`/`url`/`search`/`number`), `<textarea>`, or `contenteditable`, matching no blocklist rule | **permitted** — field cleared then set to `value`; `input`+`change` dispatched; no navigation/submit |
| Target is a react-select-style combobox **typed-text input** (`role="combobox"`/`"textbox"` on an `<input>`) | **permitted** — filters the option list only; no option selected; no submit |
| Target matches `credential-field` (password / `current-password` / `new-password` / `one-time-code`) | refused, `ruleId: "credential-field"` |
| Target matches `external-act-label` (name reads "apply"/"submit"/"send"/…) | refused, `ruleId: "external-act-label"` |
| Target is `<input type="file">` | refused, `ruleId: "unsafe-fill-type"`, reason names "file input" |
| Target is a `<select>` element, `role="listbox"`, or a combobox **container** (`<div>`) | refused, `ruleId: "unsafe-fill-type"` |
| Target is a checkbox / radio / hidden / button | refused, `ruleId: "unsafe-fill-type"` (or `consent-toggle` if the label reads as consent — that rule is evaluated first) |
| Blocklist rule evaluated **before** the safe-type check | yes (FR-005) — a dangerous field gets its own `ruleId`, not `unsafe-fill-type` |
| Repeated `fill` on the same field | idempotent — value replaced, not appended (FR-017) |
| `in-form` rule | **never** fires on `fill` (FR-001) |

### `space`

| Case | Result |
|------|--------|
| `document.activeElement` is `null` / `<body>` / `<html>` | refused, reason "no focused target", `ruleId: null` |
| Focus on a plain checkbox / `role="option"` / non-submit `<button>` with a benign label | **permitted** — element activated as a `click` would activate it |
| Focus on a plain non-submit `<button>` **inside a `<form>`** | **permitted** — `in-form` does not gate `space` (FR-009), even though `click` on it would be refused |
| Focus in a text input / `<textarea>` / `contenteditable` | **permitted** — inserts one space character; no submit (FR-010) |
| Focus on `button[type="submit"]` or `<button>` with no `type` inside a form | refused, `ruleId: "submit-control"` |
| Focus on a consent checkbox/switch ("I agree", "accept terms") | refused, `ruleId: "consent-toggle"` |
| Focus on an element whose name reads as an outward action | refused, `ruleId: "external-act-label"` |
| Focus on a password / one-time-code field | refused, `ruleId: "credential-field"` (FR-009) |
| Verdict parity | for `submit-control` / `consent-toggle` / `external-act-label` / `credential-field`, `space` and `click` return the identical verdict + `ruleId` for the same target (SC-003) |

## Audit obligation

Every `fill` and every `space` call — permitted, refused, or errored — appends exactly one
line to `interaction-log.jsonl` with `operation`, `target` (selector for `fill`; resolved
descriptor summary for `space`), `outcome`, and `ruleId` (when refused by a rule).
(FR-013, SC-004.)

## Non-goals (unchanged by this contract)

- No Enter key operation.
- No `<select>` / combobox option **selection** via `fill` (only filter text).
- No file upload.
- No batch fill — one field per call.
