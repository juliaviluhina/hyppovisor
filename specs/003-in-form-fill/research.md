# Phase 0 Research: Fill Form Fields and the Space Key

No open `NEEDS CLARIFICATION` markers — the spec's `## Clarifications` session resolved the
three ambiguities (in-form does not gate `space`; `fill` permitted on a combobox filter
input; `fill` replaces rather than appends). The items below record the design decisions the
plan depends on.

## R1 — Where `in-form` stops applying

**Decision**: Change the `in-form` rule's `appliesTo` from `"both"` to `"click"` in
`BLOCKLIST_RULES` (`src/main/safety/blocklist.ts`). No change to `matchBlocklist` — it
already skips a rule when `rule.appliesTo !== "both" && rule.appliesTo !== op`.

**Rationale**: One-field change, keeps first-match-wins precedence intact, and every other
rule that can fire on a `fill` (`external-act-label`, `credential-field`) still runs first.
`listBlocklistRules()` output stays truthful (the `appliesTo` value it reports changes).

**Alternatives considered**: Deleting the rule entirely — rejected, it still protects
`click` inside forms (the whole point of US2 / SC-002). A new `in-form-fill` rule that
permits by returning `{blocked:false}` — rejected, rules are refusals, not allowances;
adding an "allow rule" breaks the permit-by-default model.

## R2 — Safe fill type allowlist

**Decision**: Add `export const SAFE_FILL_TYPES` (a `readonly string[]` or `Set`) and
`export function listSafeFillTypes()` beside `listBlocklistRules()`. Members:
`text`, `email`, `tel`, `url`, `search`, `number`, plus the element kinds `textarea` and
`contenteditable`. A helper `isSafeFillTarget(d: TargetDescriptor): { ok: boolean; reason?: string }`
maps a descriptor to allow/deny:

- `tagName === "textarea"` → ok
- `isContentEditable === true` → ok
- `tagName === "input"` and effective `type ∈ SAFE_FILL_TYPES` (treat missing `type` as
  `"text"`) → ok
- `role === "combobox"` or `role === "textbox"` on an element that accepts typed text → ok
  (combobox filter input, per clarification / FR-004)
- everything else (`input[type=file]`, `select`, `role="listbox"`, combobox container,
  `checkbox`/`radio`, `hidden`, `button`) → deny with a reason naming the kind

**Rationale**: Enumerable and inspectable (Principle III), mirrors the existing blocklist
accessor pattern. The allowlist is consulted *after* the blocklist rules (FR-003, FR-005),
so a dangerous-wording or credential field is refused with its own `ruleId`, not a generic
"type not allowed".

**Alternatives considered**: An inline `switch` in `interact.ts` — rejected, not
inspectable and not unit-testable in isolation. Allowing any `<input>` whose `type` is not
explicitly dangerous — rejected, permit-by-default on fill targets is exactly the hole the
allowlist closes (`date`/`color`/`range`/`file` etc. would slip through).

## R3 — Detecting the combobox typed-text input

**Decision**: Rely on `role` (`"combobox"` / `"textbox"`) already captured by
`targetDescriptorScript`, plus `tagName === "input"` with a text-ish or absent `type`.
react-select renders its filter field as `<input role="combobox">` (or an inner
`<input type="text">` inside a `role="combobox"` container). The container itself (a `<div>`)
has no text-input tag and is denied by R2. No new descriptor field is required; if e2e shows
a gap, add a boolean `acceptsTypedText` to the descriptor script (element is `<input>`/
`<textarea>`/contenteditable) — noted as a contingency, not planned work.

**Rationale**: Keeps `targetDescriptorScript` stable; the distinction we need (typed-text
input vs. `<div>` container vs. `<select>`) is already expressible from `tagName` + `role`.

**Alternatives considered**: Sniffing for `class*="select__"` — rejected, library-specific,
that is interpretation (Principle II).

## R4 — The `space` operation semantics

**Decision**: `interact(wc, log, tabId, "space", undefined, undefined)`:

1. Resolve the target in-page: read `document.activeElement`. If it is `null`,
   `document.body`, or `document.documentElement`, refuse with a `TARGET_NOT_FOUND`-style
   "no focused target" reason (FR-008) and log `outcome: "refused"`, `ruleId: null`.
2. Build a `TargetDescriptor` for that element. Extend `targetDescriptorScript` with an
   overload / sibling script `activeElementDescriptorScript()` that runs the same
   name-assembly logic on `document.activeElement` instead of `querySelector(selector)`.
3. `matchBlocklist(descriptor, "space")`. For this to evaluate `submit-control`,
   `consent-toggle`, `external-act-label`, and `credential-field` but **not** `in-form`,
   those four rules must be reachable for `op === "space"`:
   - `external-act-label` is `appliesTo: "both"` → already fires.
   - `submit-control`, `consent-toggle` are `appliesTo: "click"` → widen to a set, e.g.
     `appliesTo: "click" | "fill" | "space" | "both"` and let these two match `click` **or**
     `space`. Cleanest: introduce `appliesTo: "activation"` meaning "click or space" and map
     `matchBlocklist` so `op ∈ {click, space}` matches an `"activation"` rule. `in-form`
     stays `appliesTo: "click"` and so is skipped for `space`.
   - `credential-field` is `appliesTo: "fill"` → also allow it to match `space` (a focused
     password field + space should still be refused per FR-009). Give it
     `appliesTo: "fill-or-space"` or add `space` to its reach.
4. If blocked → same refusal payload shape (`code`, `message`, `ruleId`, `ruleDescription`),
   log `refused`.
5. If permitted:
   - text input / textarea / contenteditable → dispatch a space **character** insertion
     (`keydown`/`keypress`/`beforeinput`/`input` with `" "`, or
     `document.execCommand("insertText", false, " ")` for contenteditable), never a form
     submit (FR-010).
   - control (option / checkbox / non-submit button) → activate as `click` would: dispatch
     `keydown` + `keyup` with `key: " "`, and for elements where that does not natively
     toggle, fall back to `.click()` (FR-011).
   - log `permitted`.

**Rationale**: Space genuinely has no implicit-submit behavior in browsers, so
"activate `activeElement`, gated by the four non-`in-form` rules" is complete and safe
(spec Assumptions). Reusing `matchBlocklist` keeps one enforcement path.

**Alternatives considered**: A separate `pressSpace` tool — rejected, Principle III
(tool count stays fixed; it is an `interact` operation like `click`). Letting `space`
bypass all rules because "space can't submit" — rejected, FR-009/FR-012: a focused submit
button *is* activated by Space, so `submit-control` must still fire.

## R5 — `fill` clear-then-set (FR-017)

**Decision**: Change the fill branch in `interact.ts` from `el.value = value` to:
focus, select-all / set `el.value = ""`, then set `el.value = value`, then dispatch
`input` + `change` (as today). For `contenteditable`, clear `textContent` then insert.
Idempotent by construction; combobox filter strings overwrite.

**Rationale**: Matches the clarification ("Replace — fill clears the field"); makes repeat
calls safe (Edge Cases); prevents a stale react-select filter from concatenating.

**Alternatives considered**: Appending — rejected by clarification. Simulating per-character
keystrokes for the clear — rejected as over-engineered; `value = ""` + `input` event is what
controlled React inputs need and is already the pattern in the file.

## R6 — Audit logging for the new cases

**Decision**: No change to `InteractionLog`. `interact.ts` already calls `log.record({...})`
on every permitted / refused / errored path; the `space` branch and the newly-permitted
in-form `fill` reuse those exact calls. `operation` is a free string in
`InteractionLogEntry`, so `"space"` needs no type change there — but `InteractResult.operation`
and `InteractOperation` in `src/shared/types.ts` gain `"space"`.

**Rationale**: FR-013 is "extends the existing logging obligation" — the infrastructure is
already correct; only the new code path has to call it, which the shared structure of
`interact()` guarantees.

## R7 — Constitution amendment mechanics (FR-015)

**Decision**: Edit `.specify/memory/constitution.md`:

- Principle I, after the "Permitted browser actions are limited to…" bullet, add a clause:
  entering a value into a non-credential, non-consent form field is permitted *preparation*
  and is **not** an external act; submitting, sending, applying, connecting, and
  authenticating remain human-only.
- Add an **Amendment History** entry dated 2026-08-29, bump **MINOR**
  (1.1.1 → 1.2.0): "a new binding clarification materially expands existing guidance;
  invalidates no conforming artifact — `fill` was already listed among permitted actions."
- Update the `**Version**` / `**Last Amended**` footer line.
- Review dependent templates: `README.md` "What the app will not do" list and the `interact`
  tool description string (FR-016). No `.specify/templates/*` reference `in-form` by name
  (verified: only `blocklist.ts`, `README.md`, and the specs mention it).

**Rationale**: Follows the constitution's own Governance section (rationale + version bump +
history entry + template review). MINOR is correct per its versioning policy — a new
clarification that expands guidance, not a redefinition and not a new binding constraint that
invalidates designs.

**Alternatives considered**: PATCH — rejected, this is more than wording; it changes what the
app is permitted to do, however narrowly. MAJOR — rejected, no principle removed or
redefined, no existing design invalidated.
