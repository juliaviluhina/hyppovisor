# Phase 1 Data Model: Fill Form Fields and the Space Key

This feature adds no persistent data. The "entities" below are in-memory / code-level
structures and one governance document change.

## 1. `InteractOperation` (extended)

`src/shared/types.ts`

| Before | After |
|--------|-------|
| `"click" \| "fill" \| "scroll"` | `"click" \| "fill" \| "scroll" \| "space"` |

- `InteractResult.operation` union likewise gains `"space"`.
- `InteractionLogEntry.operation` is already `string` — no change, but `"space"` is now a
  legal value.

## 2. `BlocklistRule.appliesTo` (widened)

`src/main/safety/blocklist.ts`

| Field | Before | After |
|-------|--------|-------|
| `appliesTo` | `"click" \| "fill" \| "both"` | `"click" \| "fill" \| "space" \| "activation" \| "both"` |

`"activation"` = "matches a `click` or a `space`". Rule assignments after this change:

| Rule id | `appliesTo` before | `appliesTo` after | Fires on `fill`? | Fires on `space`? | Fires on `click`? |
|---------|--------------------|--------------------|------------------|-------------------|-------------------|
| `submit-control` | `click` | `activation` | no | **yes** | yes |
| `in-form` | `both` | **`click`** | **no** (was yes) | **no** | yes |
| `consent-toggle` | `click` | `activation` | no | **yes** | yes |
| `external-act-label` | `both` | `both` (+ space) | yes | **yes** | yes |
| `credential-field` | `fill` | `fill-or-space` | yes | **yes** | no |

`matchBlocklist(d, op)` gate updated so:

- `appliesTo === "both"` → matches any `op` (incl. `space`)
- `appliesTo === "activation"` → matches `op ∈ {"click", "space"}`
- `appliesTo === "fill-or-space"` → matches `op ∈ {"fill", "space"}`
- otherwise exact match as today

**Invariant (SC-003 / FR-012)**: for `submit-control`, `consent-toggle`,
`external-act-label`, `credential-field`, a given target yields the identical verdict and
`ruleId` under `op="click"` and `op="space"`. `in-form` is the sole rule that differs
(`click` only).

## 3. Safe fill type allowlist (new)

`src/main/safety/blocklist.ts`

```
SAFE_FILL_TYPES: readonly string[]
  = ["text", "email", "tel", "url", "search", "number"]
```

Plus two element-kind rules not expressed as `type` strings: `<textarea>` and any
`isContentEditable` element.

**Accessor**: `listSafeFillTypes(): { types: readonly string[]; elementKinds: readonly string[] }`
— mirrors `listBlocklistRules()`; used by unit tests (SC-006) and available for inspection.

**Evaluator**: `isSafeFillTarget(d: TargetDescriptor): { ok: boolean; reason?: string }`

| Descriptor shape | Result |
|------------------|--------|
| `tagName === "textarea"` | ok |
| `isContentEditable === true` | ok |
| `tagName === "input"`, effective type (`type ?? "text"`) ∈ `SAFE_FILL_TYPES` | ok |
| `role ∈ {"combobox","textbox"}` **and** `tagName === "input"` (or contenteditable) | ok — combobox filter input (FR-004) |
| `tagName === "input"`, `type === "file"` | deny — `reason: "file input"` |
| `tagName === "select"` | deny — `reason: "select element"` |
| `role === "listbox"` or combobox container (`tagName` not an input/textarea) | deny — `reason: "listbox / combobox container"` |
| `type ∈ {"checkbox","radio","hidden","button","submit","image","reset"}` | deny — `reason: "<type> input"` |
| anything else | deny — `reason: "unsupported fill target: <tagName>/<type>"` |

Consulted **after** `matchBlocklist` in the `fill` path (FR-003, FR-005). A deny here
produces a `REFUSED_EXTERNAL_ACT`-style refusal whose message names the disallowed kind and
whose `ruleId` is a sentinel such as `"unsafe-fill-type"` (not one of the blocklist rule
ids) so the audit trail distinguishes "matched a danger rule" from "not an allowed field".

## 4. `TargetDescriptor` (unchanged, one contingency)

No field added in the planned path. Contingency (R3): add
`acceptsTypedText: boolean` (`el` is `<input>` / `<textarea>` / contenteditable) if e2e shows
`tagName`+`role` cannot separate a combobox's text input from its container. Recorded, not
scheduled.

## 5. `space` target resolution

Not a stored entity — a runtime lookup:

| Step | Value |
|------|-------|
| Source | `document.activeElement` in the target tab at execution time |
| Empty case | `null`, `<body>`, or `<html>` → refuse, reason `"no focused target"`, `ruleId: null`, `outcome: "refused"` |
| Descriptor | same assembly as `targetDescriptorScript`, run against `activeElement` |
| Logged `target` | the resolved element's descriptor summary (e.g. `tagName#id` or `tagName[type]`), since there is no caller selector |

## 6. Audit log entry (unchanged shape)

`InteractionLogEntry` — no field change. New rows:

- permitted in-form `fill` (previously always `refused` via `in-form`)
- every `space` call: `operation: "space"`, `target` = resolved descriptor summary,
  `outcome ∈ {permitted, refused, error}`, `ruleId` set when refused by a rule (`null` for
  the "no focused target" refusal).

## 7. Constitution Principle I (amended document)

`.specify/memory/constitution.md`

| Change | Detail |
|--------|--------|
| Principle I body | + one clause: value entry into a non-credential, non-consent field is permitted *preparation*, not an external act; submit/send/apply/connect/authenticate remain human-only |
| Amendment History | + entry dated 2026-08-29, MINOR bump `1.1.1 → 1.2.0`, one-line rationale |
| Footer | `**Version**: 1.2.0 … **Last Amended**: 2026-08-29` |

## 8. MCP `interact` tool declaration

`src/main/mcp/tools.ts`

| Change | Detail |
|--------|--------|
| `operation` zod enum | `["click", "fill", "scroll"]` → `["click", "fill", "scroll", "space"]` |
| description string | state `fill` works on plain value fields (and combobox filter inputs) inside a form; `space` activates the focused element gated by submit/consent/external-act/credential rules; submit/consent/credential targets and the Enter key remain unavailable (FR-016) |
