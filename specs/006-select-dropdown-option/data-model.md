# Phase 1 Data Model: Choose an Option in a Dropdown

No persistent data. In-memory structures, one config value, three `errors.ts` additions, one
`blocklist.ts` behaviour change, and one optional field on the audit-log entry. Nothing is
written to the shared data directory; one line is appended to `interaction-log.jsonl` per
call (FR-015).

## 1. `ChooseOptionRequest` (input, not a declared type)

The `interact` tool input for this operation. At least one of `label` / `value` MUST be
present.

| Field | Type | Notes |
|-------|------|-------|
| `tabId` | `string` | required |
| `operation` | `"choose_option"` | required |
| `selector` | `string` | required — the chooser control |
| `label` | `string?` | option's visible label; matched case-insensitive + whitespace-collapsed |
| `value` | `string?` | option's value; matched **exactly** (no trim/case) |

`label` and `value` both absent → refused before probing: `CHOOSE_OPTION_FAILED` /
`reason: "no-option-match"` with message "choose_option requires `label` or `value`".

## 2. `ChooserKind` (internal to `src/main/page/choose-option.ts`)

```
type ChooserKind = "native-select" | "custom-combobox" | "listbox";
```

`chooserKindFor(x)` returns `ChooserKind | null`; `null` means "not a dropdown". A
`<select multiple>` / `aria-multiselectable="true"` widget also yields the caller's
`multi-select` refusal (see R3). Never crosses the MCP boundary.

## 3. `OptionRecord` (internal)

One per option the probe finds (`<option>` elements for a `<select>`; `[role="option"]`
elements for a custom widget).

| Field | Type | Notes |
|-------|------|-------|
| `label` | `string` | verbatim visible text (`o.label \|\| o.text` for `<option>`; `opt.innerText.trim()` for a role option) |
| `value` | `string` | `<option>.value`; or `data-value` / `value` / `id` / `""` for a role option (same precedence as `005` R5) |
| `disabled` | `boolean` | `o.disabled`, or `aria-disabled === "true"` |

## 4. `ChooseOptionReason` (`src/shared/types.ts`)

```
type ChooseOptionReason =
  | "not-a-dropdown"      // target is not a chooser (FR-002)
  | "no-option-match"     // no option matches label/value, incl. both-supplied contradiction (FR-004/005/008)
  | "ambiguous-option"    // >1 label match, no disambiguating value (FR-006)
  | "option-disabled"     // matched option is disabled (FR-007)
  | "option-not-appeared" // async list never rendered the option in budget, OR read-back mismatch (FR-010/013)
  | "multi-select";       // <select multiple> / multi-value combobox (FR-020)
```

## 5. `ChosenOption` (`src/shared/types.ts`)

```
interface ChosenOption { label: string; value: string }
```

Returned by a permitted `choose_option` (FR-014). `label` and `value` are the *matched
option's* verbatim label and value, not the caller's input.

## 6. `InteractOperation` + `InteractResult` + `InteractionLogEntry` (`src/shared/types.ts`)

```
type InteractOperation = "click" | "fill" | "scroll" | "space" | "choose_option";
```

`InteractResult` gains `chosenOption?: ChosenOption` (present only for `choose_option`).

`InteractionLogEntry` gains **one optional field**:

| Field | Type | Notes |
|-------|------|-------|
| `reason` | `string?` | set only on a non-rule `choose_option` refusal — one of `ChooseOptionReason`. Absent otherwise. `ruleId` stays `null` in that case. |

All other `InteractionLogEntry` fields unchanged. Rule refusals still use `ruleId`; errors
still use `error`.

## 7. `config` addition (`src/main/config.ts`)

```
defaultWaitMs:      numFromEnv("HYPPO_DEFAULT_WAIT_MS", 10_000),          // existing
chooseOptionWaitMs: numFromEnv("HYPPO_CHOOSE_OPTION_WAIT_MS", 0) || <defaultWaitMs>,
```

Bounded wait for a custom combobox's options to render (FR-010) and for the read-back check.
Defaults to `defaultWaitMs`; env override exists so a test hits `option-not-appeared`
quickly. (Concretely: `const dw = numFromEnv("HYPPO_DEFAULT_WAIT_MS", 10_000); … chooseOptionWaitMs:
numFromEnv("HYPPO_CHOOSE_OPTION_WAIT_MS", dw)`.)

## 8. `errors.ts` additions

```
type ErrorCode =
  | "INVALID_URL" | "SCHEME_NOT_ALLOWED" | "LOAD_FAILED" | "TAB_NOT_FOUND"
  | "TARGET_NOT_FOUND" | "WAIT_TIMEOUT" | "REFUSED_EXTERNAL_ACT"
  | "CHOOSE_OPTION_FAILED";                          // NEW

interface ErrorDetails {
  ruleId?: string;                                    // existing — REFUSED_EXTERNAL_ACT
  ruleDescription?: string;                           // existing — REFUSED_EXTERNAL_ACT
  cause?: string;                                     // existing
  reason?: string;                                    // NEW — CHOOSE_OPTION_FAILED, a ChooseOptionReason
  candidates?: string[];                              // NEW — CHOOSE_OPTION_FAILED / ambiguous-option: the colliding labels
}
```

`HyppoError` and `toResult()` unchanged — `toResult()` already spreads `details`, so
`reason` and `candidates` serialise into `{ error: { code, message, reason, candidates } }`.

| Situation | `code` | details |
|-----------|--------|---------|
| `submit-control` / `consent-toggle` / `external-act-label` / `credential-field` match | `REFUSED_EXTERNAL_ACT` | `ruleId`, `ruleDescription` |
| not a chooser | `CHOOSE_OPTION_FAILED` | `reason: "not-a-dropdown"` |
| no option matches / both-supplied contradiction / creatable unknown label | `CHOOSE_OPTION_FAILED` | `reason: "no-option-match"` |
| >1 label match, no `value` | `CHOOSE_OPTION_FAILED` | `reason: "ambiguous-option"`, `candidates` |
| matched option disabled | `CHOOSE_OPTION_FAILED` | `reason: "option-disabled"` |
| async option never rendered / read-back mismatch | `CHOOSE_OPTION_FAILED` | `reason: "option-not-appeared"` |
| `<select multiple>` / multi-value combobox | `CHOOSE_OPTION_FAILED` | `reason: "multi-select"` |
| control removed mid-operation | `TARGET_NOT_FOUND` | `cause` optional |

## 9. `blocklist.ts` change — `ruleCovers()`

No change to `BLOCKLIST_RULES`, `TargetDescriptor`, `matchBlocklist`, `isSafeFillTarget`, or
the descriptor scripts. **Only** `ruleCovers()`:

```
case "activation":     return op === "click" || op === "space" || op === "choose_option";
case "fill-or-space":  return op === "fill"  || op === "space" || op === "choose_option";
```

Coverage matrix for `op === "choose_option"`:

| Rule | `appliesTo` | Covered | Source |
|------|-------------|---------|--------|
| `submit-control` | `activation` | ✅ (new) | FR-003 |
| `consent-toggle` | `activation` | ✅ (new) | FR-003 |
| `external-act-label` | `both` | ✅ (unchanged) | FR-003 |
| `credential-field` | `fill-or-space` | ✅ (new) | FR-003 |
| `in-form` | `click` | ❌ (unchanged) | FR-003, SC-004 |

Doc-comment on `ruleCovers` / the `appliesTo` JSDoc updated: `activation` = "click, space,
or choose_option — anything that activates a control"; `fill-or-space` = "fill, space, or
choose_option — anything that commits a value".

## 10. MCP tool: `interact` (`src/main/mcp/tools.ts`)

| Field | Change |
|-------|--------|
| `operation` enum | `z.enum(["click", "fill", "scroll", "space", "choose_option"])` |
| input `label` | `label: z.string().optional()` — added |
| description | rewritten to name `choose_option` and its contract (FR-018) |
| success payload | for `choose_option`, merge `chosenOption` into the `ok(...)` object |

No new tool. Header comment "Six tools, no others." stays accurate.

## 11. e2e handle (`src/main/index.ts`, `HYPPO_E2E` block)

```
interact: (tabId, operation, selector?, value?, label?) =>
  withCode(() =>
    queue
      .run(() => interact(tabs.webContentsFor(tabId), log, tabId, operation, selector, value, label))
      .then((r) => ({
        tabId, operation, outcome: "permitted",
        ...(r.value && r.value.chosenOption ? { chosenOption: r.value.chosenOption } : {}),
        queueDepth: r.queueDepth,
      })),
  ),
```

Existing `probe` / `focus` / `blur` handles are enough to read back `select.value`,
`aria-expanded`, `window.__submitted`, and the combobox's displayed value in tests — no new
scaffolding handle required.

## 12. `interact()` signature (`src/main/page/interact.ts`)

```
export async function interact(
  wc, log, tabId,
  operation: InteractOperation,
  selector: string | undefined,
  value: string | undefined,
  label?: string,                                   // NEW — trailing, optional
): Promise<{ chosenOption?: ChosenOption } | void>  // was: Promise<void>
```

`operation === "choose_option"` → `return chooseOption(wc, log, tabId, selector, label, value)`
(after the existing `if (!selector)` guard). All other branches keep returning `void`.
