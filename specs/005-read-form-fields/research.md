# Phase 0 Research: Structured Form-Field Reader

No open `NEEDS CLARIFICATION`. The spec's `## Assumptions` locked the load-bearing choices:
caps 200 / 200, selector preference `#id` → `[name]` → synthesised, whole-page default scope
with an optional container selector, "combobox options only when their option elements are in
the DOM", read-only with no constitution amendment, and reuse of `003`'s accessible-name
assembly + blocklist / safe-fill-type verdicts unchanged. The items below record the design
the plan depends on.

## R1 — New MCP tool vs. a mode on `read_page`

**Decision**: A new, seventh tool `read_form_fields({ tabId, containerSelector? })`.
`read_page` is untouched (FR-015). `tools.ts`'s header comment goes from "Six tools" to
"Seven tools". The tool runs inside `queue.run` like every other (Principle V — one
interaction/read in flight app-wide).

**Rationale**: The spec frames this as an *explicitly derived* view — filtered to form
controls, reordered to document order, annotated with verdicts and options. `read_page`'s
contract is "verbatim visible text / raw DOM, no parsing" (Principle V, FR-015); a
"structured" flag would make one tool name cover two incompatible payload shapes and one of
them would not be verbatim. A separate tool with its own contract keeps each guarantee
legible.

**Alternatives considered**: `read_page({ structured: true })` — rejected, dual contract
under one name. A client-side helper library — rejected, that *is* the "dump 163 KB and
regex it locally" status quo this feature exists to delete.

## R2 — Where the logic lives, and the collector-script shape

**Decision**: New module `src/main/page/form-fields.ts`, beside `read.ts` / `interact.ts`:

```
readFormFields(wc, tabId, containerSelector: string | undefined, )
  : Promise<FormFieldMap>
```

1. One isolated-world script (`FORM_FIELDS_SCRIPT`) is injected via
   `wc.executeJavaScript(…, true)`. It:
   - resolves the scope root: `document.querySelector(containerSelector)` or
     `document` when omitted; a given-but-unresolved container → returns a sentinel
     `{ containerFound: false }` so the main side can throw `TARGET_NOT_FOUND`.
   - collects candidate controls in document order: `input, select, textarea, button,
     [contenteditable], [role]` filtered to the form-ish roles of FR-003
     (`combobox, listbox, textbox, checkbox, radio, switch, button`).
   - for each, builds a **raw** record: `tagName`, `type`, `role`, `hasFormAncestor`,
     `isContentEditable`, the verbatim `label` (R8), `required`, `group` (R3a),
     `visible` (R7a), `currentValue` (R7), `options` + `optionsAvailable` +
     `optionsTruncated` (R5), and `selector` + `selectorSynthesised` +
     `duplicateId` (R3).
   - applies the control cap (R6) in document order, setting a top-level `truncated` flag.
   - returns `{ containerFound: true, observedAt: <ISO>, records: RawRecord[], truncated }`.
2. Back in the main process, `readFormFields` maps each raw record through the **pure**
   `fillVerdictFor(d)` / `clickVerdictFor(d)` (R8/verdicts) to attach `fillVerdict` and
   `clickVerdict`, assembles `FormFieldMap` (`tabId`, `url`, `observedAt`, `truncated`,
   `records`, `queueDepth`), and returns it. No `log.record` call (R10).

**Rationale**: The DOM walk is large and page-side; `read.ts` must stay a ~50-line verbatim
reader and `tools.ts` is registration only. Computing verdicts in the main process (not
in-page) lets them come from the exact same `blocklist.ts` functions `interact` uses
(SC-004) rather than a re-implementation in injected JS.

**Alternatives considered**: Do everything in the injected script including verdicts —
rejected, that forces a second copy of the rule logic in a string. Extend `read.ts` —
rejected, opposite of its contract.

## R3 — Selector synthesis

**Decision**: Per control, in the collector script, choose the first that is **unique**
within the scope root:

1. `#<id>` when `el.id` is set, contains no CSS-special chars needing escape beyond
   `CSS.escape`, and `root.querySelectorAll('#'+CSS.escape(id)).length === 1`.
2. `[name="<name>"]` when `el.name` is set and
   `root.querySelectorAll('[name="'+CSS.escape(name)+'"]').length === 1` — scoped with the
   tag (`input[name="…"]`) when that is needed for uniqueness.
3. A structural path: walk ancestors to the root building
   `tag:nth-of-type(k)` segments; stop as soon as the partial path is unique in the root.

Set `selectorSynthesised: true` for case 3. Set `duplicateId: true` when `el.id` is set but
case 1 failed uniqueness (invalid HTML — duplicate ids), and fall through to case 2/3.
Every emitted selector is re-checked `=== 1` against the root before being returned; a
control for which no unique selector can be built (extremely rare) is emitted with
`selector: null` and `selectorSynthesised: true` so the caller sees it exists (it still
counts toward the control cap).

**Rationale**: Matches the spec's stated preference order and the "verified unique at call
time" requirement (Edge Cases). `nth-of-type` paths survive minor re-renders better than
`nth-child`.

**R3a — `group`**: for a radio (`input[type=radio]` or `role=radio`), `group` is
`el.name` when set, else the `id` of the nearest `<fieldset>`, else a synthesised
`"group:<n>"` shared by co-located radios. `null` for non-radio controls.

**Alternatives considered**: XPath — rejected, `interact` takes CSS selectors.
Always-structural selectors — rejected, `#id` is what a human-written batch uses and is the
most stable when present and unique.

## R4 — `kind` mapping

**Decision**: A pure `kindFor(tagName, type, role, isContentEditable)` (in `form-fields.ts`,
unit-tested), first match wins:

| Condition | `kind` |
|-----------|--------|
| `isContentEditable` | `richtext` |
| `tagName === "textarea"` | `textarea` |
| `tagName === "select"` | `select` |
| `tagName === "button"` or `role === "button"` or `input[type in submit,button,reset,image]` | `button` |
| `input[type === "file"]` | `file` |
| `input[type === "checkbox"]` or `role in checkbox,switch` | `checkbox` |
| `input[type === "radio"]` or `role === "radio"` | `radio` |
| `role in combobox,listbox` (any tag), or `input` carrying `role="textbox"` | `combobox` |
| `input` with `type in text,email,tel,url,search,number,password` (or no type) | `text` |
| anything else reached | `other` |

The raw `type` attribute is carried separately (`type` field) so `password` is still
visible even though its `kind` is `text`.

**Rationale**: The small named set the spec lists, mapped mechanically. `combobox` groups
`<select>`-alternatives so `006` has one kind to look for alongside `select`.

## R5 — Options extraction

**Decision** (collector script, per control):

- **`<select>`**: `options` = `[...el.options].map(o => ({ label: o.label || o.text,
  value: o.value }))` in document order. `optionsAvailable: true`.
- **combobox / listbox** (`role`): find the option elements — `[role="option"]` inside the
  element, or inside `document.getElementById(el.getAttribute("aria-controls"))` /
  `aria-owns`, or inside a `[role="listbox"]` that is a descendant/sibling. If any are
  found: `options` = each `{ label: opt.innerText.trim() || opt.textContent.trim(), value:
  opt.getAttribute("data-value") ?? opt.getAttribute("value") ?? opt.id ?? "" }`,
  `optionsAvailable: true`. If none are in the DOM: `options: []`,
  `optionsAvailable: false` (the reader never opens a menu — that is `006`).
- Every other kind: `options: []`, `optionsAvailable: false`.
- **Options cap** (R6): if the collected list exceeds `formFieldOptionCap`, truncate to the
  cap in document order and set that record's `optionsTruncated: true`.

**Rationale**: `<select>` options are always in the DOM; react-select options exist only
while the menu is open. FR-008 / SC-006 want exactly this split. Labels/values verbatim
(FR-011).

**Alternatives considered**: Opening the menu to enumerate — rejected, that is an
interaction (Principle I) and is `006`'s job.

## R6 — Config caps

**Decision**: In `src/main/config.ts`, beside the existing limits:

```
formFieldControlCap: numFromEnv("HYPPO_FORM_FIELD_CONTROL_CAP", 200),
formFieldOptionCap:  numFromEnv("HYPPO_FORM_FIELD_OPTION_CAP", 200),
```

Control cap → top-level `truncated: true`. Option cap → per-record `optionsTruncated: true`.

**Rationale**: Config is the established home for limits (`maxTextBytes`, `defaultWaitMs`).
Env overrides let a test hit the boundary without a 201-control fixture.

## R7 — `currentValue` and credential omission

**Decision** (collector script):

- text-ish (`text/textarea/richtext/combobox` text input): `el.value` (or
  `el.innerText` for contenteditable).
- `checkbox` / `radio` / `switch`: `el.checked` (boolean).
- `select`: `el.value` (the selected option's value; `select-multiple` → array of values).
- `file` / `button`: `null`.
- **Credential omission**: if `fillVerdictFor(d)` would match `credential-field` — i.e.
  `type === "password"` or `autocomplete ∈ {current-password, new-password, one-time-code}`
  — the `currentValue` key is **omitted from the record entirely** (not set to `null`, not a
  placeholder), so payload length cannot leak the secret's length.

**R7a — `visible`**: `false` when the element or an ancestor has `display:none` /
`visibility:hidden` / the `hidden` attribute, or `el.getClientRects().length === 0`, or
zero width+height; `true` otherwise. Hidden controls are still listed (Greenhouse's real
file input is hidden) so the caller knows they exist.

**Rationale**: FR-005, SC-005, and the spec Edge Case ("never redacted-in-place with a
placeholder that could leak length").

## R8 — Shared accessible-name sources; verbatim label

**Decision**: Factor the source list currently inlined in `DESCRIPTOR_BODY` (associated
`<label for>`, `aria-label`, `aria-labelledby`, wrapping `<label>`, `placeholder`, plus
`title`) into one in-page routine, e.g. `ACCESSIBLE_NAME_PARTS(el) → string[]` (raw parts).
Two consumers:

- `DESCRIPTOR_BODY` (safety): `parts.join(" ").replace(/\s+/g," ").trim().toLowerCase()` →
  `name` (unchanged behaviour).
- reader: first non-empty of `[associated label, wrapping label, aria-label, aria-labelledby
  text, placeholder]`, trimmed but **case preserved** → `label` (FR-011). Fallback to `""`
  when none.

Add to `blocklist.ts` two pure functions over an already-collected descriptor:

```
fillVerdictFor(d: TargetDescriptor): FieldVerdict     // replays interact's fill path:
  //   matchBlocklist(d,"fill").blocked  → refused + ruleId + ruleDescription
  //   else !isSafeFillTarget(d).ok      → refused + ruleId "unsafe-fill-type" + description
  //   else                              → { verdict: "permitted" }
clickVerdictFor(d: TargetDescriptor): FieldVerdict    // matchBlocklist(d,"click")
```

`readFormFields` builds a `TargetDescriptor` for each raw record (it already has every
field) and calls these.

**Rationale**: One source list, one verdict sequence — the reader and `interact` cannot
disagree (SC-004). Keeping the safety `name` lowercased and the reader `label` verbatim is
the only intentional difference, and it is localised to the two join sites.

**Alternatives considered**: A wholly separate label assembly in the collector — rejected,
drifts from `DESCRIPTOR_BODY`. Reusing the lowercased `name` as the label — rejected,
violates FR-011 (verbatim).

## R9 — e2e test handle

**Decision**: Add to `globalThis.__hyppo` (the `HYPPO_E2E` block in `src/main/index.ts`):

```
readFormFields: (tabId, containerSelector) =>
  withCode(() => queue.run((d) =>
    readFormFields(tabs.webContentsFor(tabId), tabId, containerSelector, d)).then(r => r.value)),
```

mirroring the existing `read` handle. The MCP `tools.ts` registration is exercised
separately by asserting the tool is listed and its schema accepts `{ tabId }` and
`{ tabId, containerSelector }`.

## R10 — No interaction-audit-log entry

**Decision**: `readFormFields` never calls `InteractionLog.record` (FR-014 — it is a read,
not an interaction). Whether a separate read-log exists is out of scope; none is added here.
The integration test asserts the interaction log line count is unchanged across a
`read_form_fields` call.

**Rationale**: Parity with `read_page`, which also produces no interaction-log entry.
