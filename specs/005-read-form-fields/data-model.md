# Phase 1 Data Model: Structured Form-Field Reader

No persistent data. In-memory structures, two config values, and one shared pure-function
addition. Nothing is written to disk (FR-013) and no audit-log entry is produced (FR-014).

## 1. `FieldVerdict`

`src/shared/types.ts` — identical in shape and meaning to what `interact` returns for a
refused or permitted target.

| Field | Type | Notes |
|-------|------|-------|
| `verdict` | `"permitted" \| "refused"` | |
| `ruleId` | `string?` | present iff `refused` — `submit-control` / `consent-toggle` / `external-act-label` / `credential-field` / `unsafe-fill-type` |
| `ruleDescription` | `string?` | present iff `refused` — the same human text `interact` puts in its refusal |

## 2. `FieldOption`

| Field | Type | Notes |
|-------|------|-------|
| `label` | `string` | verbatim option text (FR-011) |
| `value` | `string` | `<option>.value`, or a combobox option's `data-value` / `value` / `id`, or `""` |

## 3. `FormFieldRecord` (one per control)

`src/shared/types.ts`. Order in the map matches document order (FR-001, FR-011).

| Field | Type | Notes |
|-------|------|-------|
| `selector` | `string \| null` | usable by `interact`; `null` only when no unique selector could be built |
| `selectorSynthesised` | `boolean` | `true` when a structural `nth-of-type` path was used (not `#id` / `[name]`) |
| `duplicateId` | `boolean` | `true` when the element has an `id` that is not unique on the page (invalid HTML) |
| `kind` | `"text" \| "textarea" \| "select" \| "combobox" \| "checkbox" \| "radio" \| "file" \| "button" \| "richtext" \| "other"` | R4 mapping |
| `type` | `string \| null` | raw `type` attribute, lowercased, when applicable (so `password` stays visible under `kind: "text"`) |
| `label` | `string` | verbatim accessible name from the shared sources (R8); `""` when none |
| `required` | `boolean` | `required` / `aria-required="true"` / a literal `*` in the label |
| `group` | `string \| null` | radios only — shared group id (`name`, else `<fieldset>` id, else synthesised) |
| `inFormAncestor` | `boolean` | `!!el.closest("form")` |
| `visible` | `boolean` | R7a — `false` for `display:none` / `hidden` / zero-size; the record is still returned |
| `currentValue` | `string \| boolean \| string[] \| null` **or omitted** | R7. **Key omitted entirely** for a credential field (never `null`, never a placeholder) |
| `options` | `FieldOption[]` | `<select>` options, or an in-DOM combobox menu's options; `[]` otherwise |
| `optionsAvailable` | `boolean` | `true` for `<select>` and for a combobox whose option elements are in the DOM; `false` otherwise |
| `optionsTruncated` | `boolean` | `true` when `options` was cut to `formFieldOptionCap` |
| `fillVerdict` | `FieldVerdict` | `fillVerdictFor(descriptor)` — matches `interact`'s `fill` result exactly (SC-004) |
| `clickVerdict` | `FieldVerdict` | `clickVerdictFor(descriptor)` — matches `interact`'s `click` result exactly |

## 4. `FormFieldMap` (the result)

`src/shared/types.ts`. A single payload (FR-012) — never spills to file (SC-003).

| Field | Type | Notes |
|-------|------|-------|
| `tabId` | `string` | |
| `url` | `string` | `wc.getURL()` at call time |
| `observedAt` | `string` | ISO 8601, set in the collector script |
| `truncated` | `boolean` | `true` when the control list was cut to `formFieldControlCap` |
| `records` | `FormFieldRecord[]` | document order; length ≤ `formFieldControlCap` |
| `queueDepth` | `number` | as other queued results |

Empty page → `records: []`, `truncated: false` (not an error — spec Edge Cases).

## 5. `config` additions

`src/main/config.ts`

```
formFieldControlCap: numFromEnv("HYPPO_FORM_FIELD_CONTROL_CAP", 200),
formFieldOptionCap:  numFromEnv("HYPPO_FORM_FIELD_OPTION_CAP", 200),
```

## 6. `blocklist.ts` additions (pure, shared with `interact`)

```
fillVerdictFor(d: TargetDescriptor): FieldVerdict
  // 1. matchBlocklist(d, "fill").blocked → { verdict:"refused", ruleId, ruleDescription }
  // 2. else isSafeFillTarget(d).ok === false
  //        → { verdict:"refused", ruleId:"unsafe-fill-type",
  //            ruleDescription:`Not a safe value field: ${reason}.` }
  // 3. else → { verdict:"permitted" }

clickVerdictFor(d: TargetDescriptor): FieldVerdict
  // matchBlocklist(d, "click") → refused (+ruleId/description) | permitted
```

Also: extract the accessible-name **source parts** currently inline in `DESCRIPTOR_BODY`
into a shared in-page snippet so the collector's verbatim `label` and the safety layer's
lowercased `name` draw from one list (R8). No behaviour change to `name`.

`interact.ts` MAY be refactored to call `fillVerdictFor` / `clickVerdictFor` instead of
inlining the two-step check — optional, behaviour-preserving, and covered by the existing
interaction tests.

## 7. MCP tool: `read_form_fields`

`src/main/mcp/tools.ts` — the 7th tool. Header comment updated ("Six tools" → "Seven
tools").

| Field | Type | Notes |
|-------|------|-------|
| input `tabId` | `z.string()` | required |
| input `containerSelector` | `z.string().optional()` | scope to controls inside this element; omitted → whole page |
| output | `FormFieldMap` | via `ok(...)` |
| errors | `TAB_NOT_FOUND` (unknown tab), `TARGET_NOT_FOUND` (container selector given but resolves to nothing) | serialised as `{ error: { code, message } }` |

No new `ErrorCode` value — `TAB_NOT_FOUND` and `TARGET_NOT_FOUND` already exist.

## 8. e2e handle

`src/main/index.ts` (`HYPPO_E2E` block): `readFormFields(tabId, containerSelector?)` →
`queue.run` → `readFormFields(...)` → `.value`. Mirrors the `read` handle.

## 9. `TargetDescriptor` reuse

The collector emits every field a `TargetDescriptor` needs (`tagName`, `type`, `role`,
`hasFormAncestor`, `name` (lowercased, for the verdict fns), `autocomplete`,
`isContentEditable`). `readFormFields` constructs the descriptor from the raw record and
passes it to `fillVerdictFor` / `clickVerdictFor`. The verbatim `label` is a separate field
computed alongside — the descriptor's `name` stays lowercased so the verdict logic is
byte-identical to `interact`'s.
