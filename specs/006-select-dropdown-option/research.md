# Phase 0 Research: Choose an Option in a Dropdown

No open `NEEDS CLARIFICATION`. The spec's `## Clarifications` (Session 2026-08-30) and
`## Assumptions` locked every load-bearing choice: operation name `choose_option`; the
chooser is exactly a `<select>` / `role="combobox"` / `role="listbox"` / an element owning a
`role="listbox"` via `aria-controls`/`aria-owns`; one new `ErrorCode`
`CHOOSE_OPTION_FAILED` with a `reason` discriminator; read-back verification is enforced;
when both `label` and `value` are given, `value` is the primary key and `label` is a
cross-check. The items below record the design the plan depends on.

## R1 — A new `interact` operation, not a new tool

**Decision**: Add `"choose_option"` to the `interact` tool's `operation` enum and to the
`InteractOperation` type. `interact` stays one tool; the MCP surface stays six tools. The
operation runs inside `queue.run` like every other (Principle V).

**Rationale**: FR-001 frames it as "`interact` MUST accept a new operation." It shares
`interact`'s contract — a `tabId` + `selector`, one audit entry per call, a permitted result
or a named refusal — and differs only in the mechanics and the `{label,value}` result. A
seventh tool (as `005` justifiably adds for a *read* with a different payload shape) is not
warranted for a fifth sibling of `click`/`fill`/`scroll`/`space`.

**Alternatives considered**: a dedicated `select_option` tool — rejected, it would duplicate
`interact`'s queue/audit/refusal plumbing for no contract benefit. Overloading `fill` —
rejected (see plan Complexity Tracking): `fill` on a `<select>` is deliberately refused and
the result shapes differ.

## R2 — Module boundary and orchestration

**Decision**: New module `src/main/page/choose-option.ts`:

```
chooseOption(wc, log, tabId, selector, label: string | undefined, value: string | undefined)
  : Promise<{ chosenOption: ChosenOption }>
```

`interact()` gains a trailing `label?: string` parameter and returns
`Promise<{ chosenOption?: ChosenOption } | void>` (was `void`). On
`operation === "choose_option"` it delegates to `chooseOption(...)` and returns its result;
every other operation returns `void` as today. The single-audit-entry `logged`-flag pattern
and the outer `try/catch` in `interact()` are reused — `chooseOption` throws `HyppoError`
and records its own log line on every exit path, exactly like the `space` and `fill`
branches.

`chooseOption` orchestration:

1. `descriptorFor(wc, selector)` (existing helper) → `matchBlocklist(descriptor,
   "choose_option")`. Blocked → record `refused` (operation `choose_option`, `ruleId` set) →
   throw `REFUSED_EXTERNAL_ACT` with the existing `{ ruleId, ruleDescription }` shape.
2. `wc.executeJavaScript(chooseOptionProbeScript(selector), true)` → a raw probe record:
   `{ chooserKind, multiple, optionsInDom: OptionRecord[], hasFilterInput, filterSelector,
   listboxPresent, menuOpen }`.
   - `chooserKind === null` (not a chooser) → record `refused` (`reason:"not-a-dropdown"`) →
     throw `CHOOSE_OPTION_FAILED`.
   - `multiple` (a `<select multiple>` or `aria-multiselectable="true"`) → record `refused`
     (`reason:"multi-select"`) → throw `CHOOSE_OPTION_FAILED`.
3. Kind-specific mechanics (R6), then `matchOption` (R5), then read-back (R7).
4. Success → record `permitted` (operation `choose_option`, `target` = selector) → return
   `{ chosenOption: { label, value } }`.

**Rationale**: keeps `interact.ts` legible (Principle III); computing the blocklist verdict
from the *same* `matchBlocklist` the other operations use means `choose_option` cannot
diverge from `fill`/`click` on submit/consent/credential/wording targets (SC-003). The probe
is one isolated-world round-trip; the DOM walk is page-side where it belongs.

**Alternatives considered**: do the blocklist check in-page — rejected, forces a second copy
of the rule logic into a string. One giant combined script — rejected, the probe and the
per-kind mutation are cleaner as separate injected expressions.

## R3 — Chooser classification

**Decision**: a pure `chooserKindFor(x): ChooserKind | null` where `x` is the probe's raw
shape (`tagName`, `role`, `multiple`, `ariaControlsListbox`, `ariaOwnsListbox`). First match
wins:

| Condition | `ChooserKind` |
|-----------|---------------|
| `tagName === "select"` and not `multiple` | `native-select` |
| `tagName === "select"` and `multiple` | `null` → caller refuses `multi-select` |
| `role === "listbox"` and not multiselectable | `listbox` |
| `role === "combobox"` | `custom-combobox` |
| `role !== "combobox"/"listbox"` **but** the element's `aria-controls` or `aria-owns` id resolves to a node with `role="listbox"` | `custom-combobox` |
| anything else | `null` → caller refuses `not-a-dropdown` |

A multiselectable custom widget (`aria-multiselectable="true"` on the combobox/listbox, or
the owned listbox) is treated as `multiple` and refused `multi-select` (FR-020).

**Rationale**: exactly the FR-002 definition, mapped mechanically — no class-name or
framework-name heuristics (the `/speckit-clarify` answer). Aligns with how `005`'s
`read_form_fields` classifies a chooser (`kind: "select" | "combobox"`).

**Alternatives considered**: sniff for `react-select` / `downshift` class prefixes —
rejected by clarify decision (untestable, unbounded). Accept any element with a descendant
`[role="option"]` — rejected, that is "activate anything in a form" through the back door.

## R4 — Blocklist gate and the `ruleCovers` change

**Decision**: `matchBlocklist(descriptor, "choose_option")` gates the operation. In
`ruleCovers()`:

```
case "activation":     return op === "click" || op === "space" || op === "choose_option";
case "fill-or-space":  return op === "fill"  || op === "space" || op === "choose_option";
```

Resulting coverage for `choose_option`:

| Rule | `appliesTo` | Gates `choose_option`? |
|------|-------------|------------------------|
| `submit-control` | `activation` | **yes** (FR-003) |
| `consent-toggle` | `activation` | **yes** (FR-003) |
| `external-act-label` | `both` | **yes** — already, no change (FR-003) |
| `credential-field` | `fill-or-space` | **yes** (FR-003) |
| `in-form` | `click` | **no** — already, no change (FR-003, SC-004) |

The `BLOCKLIST_RULES` array itself is unchanged. The `ruleCovers` doc-comment is updated:
the `activation` / `fill-or-space` groups now mean "operations that activate a control or
commit a value, `choose_option` included."

**Rationale**: smallest change that satisfies FR-003. Re-tagging every rule with a new
`appliesTo` bucket is a larger, riskier diff. `external-act-label` and `in-form` already
resolve correctly by their existing `appliesTo`, so only two `switch` arms move.

**Alternatives considered**: a hand-maintained list of rule ids that gate `choose_option`,
checked in `choose-option.ts` — rejected, it re-implements rule iteration and drifts from
`BLOCKLIST_RULES`.

**Note on the descriptor `name` for a `<select>`**: `DESCRIPTOR_BODY` builds `name` from
`innerText` (which for a `<select>` includes every `<option>`'s text) plus `aria-label`,
associated/wrapping `<label>`, `title`, `placeholder`. A `<select>` whose *label* is "I
agree to receive updates" is refused by `consent-toggle`? — no: `consent-toggle` only
matches checkbox/radio/switch. It is caught by `external-act-label` (`appliesTo: "both"`,
matches `"agree"`). US3 scenario 2 asserts `external-act-label` / `REFUSED_EXTERNAL_ACT` for
a consent-worded `<select>`; a consent-worded custom combobox with `role="checkbox"` would
hit `consent-toggle`. Both paths are covered by tests.

## R5 — The matching algorithm

**Decision**: a pure `matchOption(options: OptionRecord[], want: { label?: string; value?:
string }): { ok: true; option: OptionRecord } | { ok: false; reason: ChooseOptionReason;
candidates?: string[] }`.

Normalisation: `norm(s) = s.trim().replace(/\s+/g, " ").toLowerCase()` for **label**
comparison only. `value` comparison is exact (no normalisation, no trim).

| Inputs | Rule |
|--------|------|
| `value` only | options with `opt.value === want.value`. 0 → `no-option-match`. ≥1 → the first (duplicate values are malformed HTML; pick document order). |
| `label` only | options with `norm(opt.label) === norm(want.label)`. 0 → `no-option-match`. exactly 1 → that option. ≥2 → `ambiguous-option`, `candidates = [opt.label, …]` (verbatim). |
| both `label` and `value` | first the `value` rule; if it yields an option, require `norm(option.label) === norm(want.label)` or → `no-option-match`. |
| neither | caller rejects before probing — `CHOOSE_OPTION_FAILED` / `no-option-match` is not used here; this is an input error surfaced as `TARGET_NOT_FOUND`-style "requires label or value". (See contract.) |

After a candidate is chosen: if `option.disabled` → `option-disabled` (checked last, so a
disabled + ambiguous label still reports `ambiguous-option` first — the caller can't act on
either).

**Rationale**: FR-004–FR-008 verbatim. Exact, order-deterministic, no guessing. Returning
`candidates` lets the caller (and the audit line) name the collision (FR-006).

**Alternatives considered**: trimming `value` too — rejected, option values are opaque
tokens and a trailing space could be significant. Case-sensitive label match — rejected,
FR-004 says case-insensitive.

## R6 — Per-kind mechanics

All mechanics run in injected isolated-world scripts. No synthetic Enter anywhere.

### `native-select`

Options are always in the DOM: the probe returns them. `matchOption` runs on the probe list.
On success, an in-page script:

```
el.value = chosen.value;            // or: [...el.options].find(o => o === chosenEl).selected = true
el.dispatchEvent(new Event("input",  { bubbles: true }));
el.dispatchEvent(new Event("change", { bubbles: true }));
```

Then read back `el.value` and the selected option's text; verify against `chosen`.

### `custom-combobox` / `listbox`

1. **Open** if the option elements are not already in the DOM: `el.click()` on the combobox
   (or, for an owner element, on the element itself). This app-initiated click is the
   sanctioned mechanic — `in-form` does not gate `choose_option` (FR-003) and the click is on
   the identified chooser, not an arbitrary element.
2. **Wait** up to `config.chooseOptionWaitMs` for `[role="option"]` to appear in the option
   source (descendant of the element, or of `document.getElementById(aria-controls|aria-owns)`,
   or of a descendant/sibling `[role="listbox"]` — the same source list `005` R5 uses). One
   `MutationObserver`, same shape as `waitForSelector`.
3. **Filter (optional, FR-009)**: if the widget has a filter `<input>` (its own
   `role="combobox"`/`role="textbox"` input, or one with `aria-autocomplete`), set the target
   `label` into it via the `fillScript` events (`input` + `change`, no `blur` — `blur` closes
   the menu, which `fillScript` already special-cases for `role=combobox`/`textbox`). Re-wait
   for the option.
4. **Match**: `matchOption` over the currently-rendered options. If the listbox rendered
   ≥1 option but none matches → `no-option-match`. If no option ever rendered within the
   budget → `option-not-appeared`. `ambiguous-option` / `option-disabled` as R5
   (`opt.getAttribute("aria-disabled") === "true"` or `opt.disabled`).
5. **Activate** the single matching option element: fire `pointerdown` → `mousedown` →
   `mouseup` → `click` on it (react-select commits on `mousedown`; a bare `.click()` is
   enough for most, the full sequence is robust). No key events.
6. **Close**: if the widget is still open (`aria-expanded === "true"` or the listbox is still
   present), send an `Escape` `keydown`/`keyup` to the combobox input, else `el.click()`
   again. FR-009 — "MUST leave the widget closed afterward."
7. **Read back** (R7): the combobox's displayed value — `filterInput.value`, or the
   `[aria-selected="true"]` option's label, or `el.getAttribute("aria-activedescendant")`
   resolved to its option's text, or the container's `innerText`. Verify it contains /
   equals the chosen `label` (normalised) or `value`. Mismatch → `option-not-appeared`.

**Rationale**: mirrors real user mechanics; every step is confined to the one chooser and
its own menu. Reusing `fillScript`'s event set for the filter keeps the "type a value"
behaviour identical to `fill`. The bounded wait is the existing `waitForSelector` mechanism.

**Alternatives considered**: `element.selectedIndex` / `option.selected` without events —
rejected, React-controlled `<select>`s ignore it (same reason `NATIVE_VALUE_SETTER` exists).
Dispatching `KeyboardEvent` "ArrowDown"×n + "Enter" to pick an option — rejected, Enter can
implicitly submit (Principle I) and arrow-count is fragile.

## R7 — Read-back verification (the `/speckit-clarify` answer, FR-013)

**Decision**: after activation, `chooseOption` re-reads the control and only returns a
permitted result when the read value matches the chosen option:

- `native-select`: `el.value === chosen.value` (and the selected option's text `=== chosen.label`).
- `custom-combobox` / `listbox`: the displayed value (R6 step 7) equals/contains the chosen
  `label` (normalised) or `value`.

On mismatch: record `refused` with `reason: "option-not-appeared"`, throw
`CHOOSE_OPTION_FAILED`, and report the control as unchanged (make a best-effort revert for a
native `<select>` only — set `el.value` back to the pre-call value; a custom widget is left
closed and untouched, and the mismatch means nothing committed anyway).

**Rationale**: makes SC-002 ("the control's reported current value equals the requested
option 100% of the time after a permitted call") an enforced post-condition, not a hope. A
half-worked custom widget that swallowed the click never reports false success. Reusing the
`option-not-appeared` reason (rather than adding a seventh) keeps the enum at the six values
the clarify session fixed.

## R8 — Result and audit shape

**Decision**:

- **Permitted result** (through the `interact` tool): `{ tabId, operation: "choose_option",
  outcome: "permitted", chosenOption: { label, value }, queueDepth }`. `chosenOption` is
  present only for `choose_option`; other operations' payloads are unchanged.
- **Audit entry** (`InteractionLogEntry`): exactly one per call.
  - permitted → `{ operation: "choose_option", target: <selector>, outcome: "permitted",
    ruleId: null, reason: null (absent), error: null }`.
  - rule refusal → `outcome: "refused"`, `ruleId: <rule id>`, `error: null`.
  - non-rule refusal → `outcome: "refused"`, `ruleId: null`, `reason: <ChooseOptionReason>`.
  - unexpected throw (control vanished mid-op) → `outcome: "error"`, `error: <message>`.
- **Refusal payload** (FR-016): keeps the existing shape — `{ error: { code, message,
  ...details } }`. Rule match → `code: "REFUSED_EXTERNAL_ACT"`, `ruleId`, `ruleDescription`.
  Non-rule → `code: "CHOOSE_OPTION_FAILED"`, `reason`, and `candidates: string[]` for
  `ambiguous-option`.

**Rationale**: `InteractionLog.record` already takes a structured entry; adding an optional
`reason` field is the `004`-style extension (which added `batch?`). `toResult()` already
spreads `details`, so `reason`/`candidates` serialise with no `toResult` change.

## R9 — Config

**Decision**: `src/main/config.ts`, beside `defaultWaitMs`:

```
chooseOptionWaitMs: numFromEnv("HYPPO_CHOOSE_OPTION_WAIT_MS", 0) || defaultWaitMs,
```

i.e. default to `defaultWaitMs` (Assumptions — "reuse the existing wait-for-selector
budget"), env-overridable so a test can set `HYPPO_CHOOSE_OPTION_WAIT_MS=300` and hit
`option-not-appeared` fast. (Implementation detail: read `defaultWaitMs` first, then
`chooseOptionWaitMs` as its own `numFromEnv(..., config.defaultWaitMs)` call — the snippet
above is shorthand.)

**Rationale**: same env-override-for-tests pattern as `004`'s `batchFillCap` and `005`'s
control/option caps. No new default value to justify — it *is* the existing default.

## R10 — Types

**Decision**: `src/shared/types.ts`:

- `InteractOperation = "click" | "fill" | "scroll" | "space" | "choose_option"`.
- `type ChooseOptionReason = "not-a-dropdown" | "no-option-match" | "ambiguous-option" |
  "option-disabled" | "option-not-appeared" | "multi-select"`.
- `interface ChosenOption { label: string; value: string }`.
- `InteractionLogEntry` gains `reason?: string` (optional; set only on non-rule
  `choose_option` refusals). `InteractResult.operation` already admits `InteractOperation`,
  so `"choose_option"` flows in; add an optional `chosenOption?: ChosenOption` to
  `InteractResult`.

`ChooserKind` and `OptionRecord` are **internal** to `choose-option.ts` (not shared) — they
never cross the MCP boundary.

## R11 — Errors

**Decision**: `src/main/errors.ts`:

- `ErrorCode` gains `"CHOOSE_OPTION_FAILED"`.
- `ErrorDetails` gains `reason?: string` and `candidates?: string[]`.
- No change to `HyppoError` / `toResult()` — details already spread into the serialised
  error.

`REFUSED_EXTERNAL_ACT` is unchanged and still carries `ruleId` + `ruleDescription` for the
four rule matches.

## R12 — Constitution amendment (FR-017)

**Decision**: extend Principle I's "**Value entry is preparation, not an external act**"
bullet with one sentence:

> Choosing an option in a plain, non-credential, non-consent `<select>` or combobox — by the
> option's visible name or its value, with the app locating the option only within that one
> control's own list — is preparation on the same footing: it builds a draft and cannot
> submit.

Add an Amendment History entry and bump the version header:

> - **1.3.0** (2026-08-30) — Principle I: added the "choosing an option is preparation"
>   clause for `<select>` / combobox selection via the `choose_option` operation. MINOR:
>   same reasoning as 1.2.0 — a binding clarification that expands existing guidance
>   (Principle I already blessed "pick a highlighted option" via Space), redefines no
>   principle, and invalidates no conforming artifact. Recorded in feature
>   `006-select-dropdown-option`.

> **Version**: 1.3.0 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-08-30

**Rationale**: FR-017 requires it, and the spec + Assumptions pre-approve the MINOR bump.
Precedent: `003`/1.2.0 handled its boundary the same way. Per the constitution's Governance
note, no Sync Impact Report block — an Amendment History line only.

**Dependent-template review** (Governance requirement): the Spec Kit `plan-template` /
`spec-template` carry no wording that enumerates `interact` operations or a tool count, so no
template edit is needed. `README.md` and `specs/001-open-any-url/contracts/mcp-tools.md` do
mention the operation set and are updated as FR-018 doc-parity tasks.
