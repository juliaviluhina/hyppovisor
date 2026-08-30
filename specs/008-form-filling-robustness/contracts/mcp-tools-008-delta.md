# Contract Delta — Feature 008 (Form-Filling Robustness)

> **Folded in.** Every change below is now part of the canonical contract,
> `specs/001-open-any-url/contracts/mcp-tools.md` (the `interact` `list_options`
> operation, the `INVALID_SELECTOR` error, the `read_form_fields` params/records,
> the new `screenshot` tool, and the `fill` non-goals). This file is retained for
> traceability of the feature-008 delta only.

Exact changes to the MCP tool surface. Nothing here removes or renames an existing
parameter, field, or error.

---

## `interact` — new operation `list_options`

`operation` enum: `click | fill | scroll | space | choose_option | **list_options**`.

### Request

| Param | Type | Notes |
|---|---|---|
| `tabId` | string | required |
| `operation` | `"list_options"` | |
| `selector` | string | required — the dropdown control |

`value`, `label`, `fields` are ignored for `list_options`.

### Response (success)

```json
{
  "tabId": "tab-4",
  "selector": "#input_QA_11650537_input",
  "options": [
    { "label": "Daily", "value": "opt-1", "disabled": false },
    { "label": "Weekly", "value": "opt-2", "disabled": false },
    { "label": "Never", "value": "opt-3", "disabled": true }
  ],
  "optionsPresent": true,
  "optionsTruncated": false,
  "queueDepth": 0
}
```

- `options` in document order; `label` verbatim except surrounding whitespace; `value`
  precedence `data-value` → `value` → `id` → `""`.
- A native `<select>`: `optionsPresent` always `true`, returned without opening anything.
- A scripted menu that never populates within the option-wait window: `options: []`,
  `optionsPresent: false` (NOT an error).
- `options` capped at the form-field option cap; `optionsTruncated: true` when it bit.

### Behaviour guarantees

- Read-only: the control's value is unchanged, the menu is left closed, **no
  interaction-audit entry is written** on any path.
- Blocklist-gated identically to `choose_option`: `submit-control`, `consent-toggle`,
  `credential-field`, `external-act-label` → `REFUSED_EXTERNAL_ACT` (with `ruleId`).
  `in-form` does not gate it.

### Errors

| Code | When |
|---|---|
| `INVALID_SELECTOR` | `selector` is not valid CSS |
| `TARGET_NOT_FOUND` | `selector` matches nothing |
| `CHOOSE_OPTION_FAILED` (`reason: "not-a-dropdown"`) | target is not a `<select>` / `role=combobox\|listbox` / listbox-owner, or is `<select multiple>` |
| `REFUSED_EXTERNAL_ACT` | target hits a refusing blocklist rule |

---

## `interact`, `wait_for_selector`, `read_form_fields` — new error `INVALID_SELECTOR`

Any caller-supplied selector that is not valid CSS now returns:

```json
{
  "error": {
    "code": "INVALID_SELECTOR",
    "message": "Invalid CSS selector. Only standard CSS selectors are supported — text-matching pseudo-selectors (:has-text(), :text()), and combinators like >> or the text= / xpath= prefixes, are not. Call read_form_fields or read_page to get a concrete #id or [name=\"…\"] selector."
  }
}
```

Applies to: `interact.selector` (every operation), `wait_for_selector.selector`,
`read_form_fields.containerSelector`, and every entry in `read_form_fields.fields`.
A **valid** selector that matches nothing still returns `TARGET_NOT_FOUND` — unchanged.

---

## `read_form_fields` — new parameters

| Param | Type | Default | Effect |
|---|---|---|---|
| `fields` | `string[]` | — | Return records only for controls matching these selectors, document order. An explicit selector here is returned even if it is a non-interactive element (overrides the default exclusion). Mutually exclusive with `containerSelector` (supplying both is an argument error). A non-matching entry is silently absent; all-miss ⇒ empty `records`. |
| `includeNonInteractive` | `boolean` | `false` | When `false`, plain buttons and hidden value-mirror inputs are omitted. When `true`, they are included (mirrors carry `interactive: false` + `mirrors`). |
| `only` | `"required-unfilled"` | — | Return only records that are `required` and whose current value is empty (empty string / unchecked / no option chosen / placeholder-only). |

### `read_form_fields` — new record fields

Every record gains `operation` (`"fill"｜"choose"｜"activate"｜"none"`) and `chooseVerdict`
(`{ allowed, ruleId?, description? }`, same shape as `fillVerdict`). Non-interactive records
that are surfaced also carry `interactive: false`; a value-mirror additionally carries
`mirrors: "<combobox selector>"`. Text-like records carry `maxLength` / `pattern` /
`inputMode` when the element declares them.

For a scripted dropdown backed by a hidden same-named input, the read now emits **one**
interactive record whose `selector` is the one `choose_option` / `list_options` accept (the
`role=combobox` element), not the hidden `[name]` input.

### `read_form_fields` — response

`truncated` (existing boolean) is now also set when a 64 KB byte budget dropped tail
records. Still a single flag covering count-cap + option-cap + byte-budget.

---

## New tool: `screenshot`

### Request

| Param | Type | Default | Notes |
|---|---|---|---|
| `tabId` | string | — | required |
| `selector` | string | — | clip to this element's on-screen box; wins over `fullPage` |
| `fullPage` | boolean | `false` | capture the full scroll height, not just the viewport |
| `format` | `"jpeg" \| "png"` | `"jpeg"` | |
| `maxBytes` | integer | `262144` | scale/compress until the image fits; caller may only lower it meaningfully |

### Response

An MCP **image** content block (`{ type: "image", data: <base64>, mimeType }`) followed by a
**text** content block:

```json
{
  "tabId": "tab-4",
  "width": 1280,
  "height": 720,
  "scale": 1,
  "format": "jpeg",
  "fullPage": false,
  "limitNotMet": false
}
```

- `scale` = returned width ÷ natural width (`1` = not downscaled).
- `limitNotMet: true` ⇒ the image is still above `maxBytes` at the compression floor; the
  smallest achievable image is returned anyway.
- `element` echoes `selector` when an element clip was used.

### Behaviour guarantees

- Retrieval only. **Nothing written to disk, no interaction-audit entry** (matches
  `read_page`).
- Captures only what is rendered. Credential inputs render masked and stay masked.
  Privacy note: a screenshot may show a signed-in identity or a partly-drafted value — this
  is not a new disclosure class, page text is already retrievable via `read_page`.
- Runs through the app-wide action queue (one page op in flight).

### Errors

| Code | When |
|---|---|
| `INVALID_SELECTOR` | `selector` not valid CSS |
| `TAB_NOT_FOUND` | unknown `tabId` |
| `SCREENSHOT_FAILED` | element resolves but is zero-size / fully off-viewport; or the capture/encode pipeline failed (`cause` set) |

### `TOOL_NAMES`

`open_url, list_open_tabs, read_page, navigate, interact, read_form_fields,
wait_for_selector, **screenshot**` — 8 tools. The About-text tool list, the contract's tool
table, and the README tool table update in the same change (SC-010; the About-text guard
test enforces it).

---

## Unchanged / explicit non-goals

- `fill` on `<input type="file">` stays **refused**. README "What the app will not do" gains:
  attaching files is not supported and is a human step.
- `fill` gains **no** autocomplete suggestion-picking. Its description gains: choosing among
  address / place autocomplete suggestions is a human step; `fill` types the literal text.
- `open_url`, `navigate`, `list_open_tabs`, `read_page`, `scroll`, `space`, `click`,
  `choose_option`, the blocklist refusal set, and the interaction-audit format are
  untouched.
