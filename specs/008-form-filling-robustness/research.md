# Phase 0 Research: Form-Filling Robustness

All ten decisions below are settled — no open `NEEDS CLARIFICATION`. Format per decision:
**Decision / Rationale / Alternatives rejected**.

---

## R1 — `list_options` is a new `interact` operation, not a new MCP tool

**Decision**: add `"list_options"` to the `interact` `operation` enum. It takes `tabId` +
`selector`, returns `{ options: [{ label, value, disabled }], optionsPresent, optionsTruncated }`.
It runs through `queue.run`, is gated by the blocklist exactly as `choose_option` is, and
writes **no** `InteractionLog` entry on any path (success, refusal, error).

**Rationale**: reuses `interact`'s queue wrapper, `seen("interact")`, and `HyppoError`
plumbing. The enum already carries `choose_option`; a sibling read verb is the smallest
change. Keeping it off the audit log matches `read_page` / `read_form_fields` (reads don't
log) and keeps the audit log's meaning ("an action was attempted") intact.

**Alternatives rejected**:
- Standalone `list_options` tool → `TOOL_NAMES` grows to 9, the About-text guard and
  contract carry another entry, and `interact`'s queue/error wrapping is duplicated.
- Logging it as a read entry → `read_page` and `read_form_fields` already establish that
  reads produce no entry; a lone logged read would be inconsistent.

---

## R2 — `list_options` mechanics reuse `choose-option.ts` verbatim

**Decision**: extract the probe → (open if `!optionsPresent`) → `gatherScript` (MutationObserver,
bounded by `config.chooseOptionWaitMs`) → `closeReadbackScript` sequence into an exported
`listOptions(wc, selector)` in `choose-option.ts`. `chooseOption` is refactored to call the
same internal steps so there is one copy. No typing into any filter input (that is a
`choose_option`-only step keyed to a target label). `disabled` comes from the existing
`__optionSnap` (`aria-disabled` / `.disabled`).

**Rationale**: the open/observe/close code is the fiddly part and it already exists,
unit-and-e2e-tested for feature 006. `list_options` is that code minus `typeFilterScript`
and `activateScript`.

**Alternatives rejected**: a fresh probe implementation → two copies of the widget-driving
logic to keep in sync.

---

## R3 — native `<select>` support for `list_options`

**Decision**: when the probe classifies the target as `native-select`, return its
`optionsInDom` directly (already collected by `probeScript`), `optionsPresent: true`, no
open/close. A `<select multiple>` is refused `not-a-dropdown` (same as `choose_option`).

**Rationale**: FR-002 asks for both native and scripted; native is a trivial early return.
Consistency with `choose_option`'s classifier means no new refusal semantics.

---

## R4 — option list cap + truncation flag

**Decision**: cap the returned list at `config.formFieldOptionCap` (existing, 200) via the
existing `capList`; set `optionsTruncated` when it bit. When a scripted menu never populates
within `chooseOptionWaitMs`, return `options: []`, `optionsPresent: false`,
`optionsTruncated: false` — never an error (FR-007).

**Rationale**: reuses feature 005/006's cap; one number to reason about. `optionsPresent:
false` is the "did not appear" signal the spec names.

**Alternatives rejected**: a separate `listOptionsCap` → another knob for no reason.

---

## R5 — `read_form_fields` byte budget (FR-011)

**Decision**: new `config.formFieldReadMaxBytes` (default `64 * 1024`, env
`HYPPO_FORM_FIELD_READ_MAX_BYTES`). After the record list is built and capped by count, the
main process measures `Buffer.byteLength(JSON.stringify(payload), "utf8")`; while it exceeds
the budget and at least one record remains, drop the **last** record (document order
preserved) and re-measure; set `truncated: true` if any drop happened. The per-record option
list is already count-capped, so a single pathological record cannot blow the budget beyond
one over-shoot.

**Rationale**: deterministic, order-stable, trivially unit-testable with a stubbed record
list. Tail-drop matches the existing control-count cap's "first N in document order"
behaviour.

**Alternatives rejected**:
- Per-record size estimate + greedy packing → complex, and callers reason about "first N
  fields" not "some subset".
- Streaming/paged responses → a new pagination surface; `fields` projection already covers
  the "I only need a few" case.

---

## R6 — `fields` projection + interaction with `containerSelector` (FR-009)

**Decision**: new optional `fields: string[]` on `read_form_fields`. When present, the
in-page collector is handed the list; for each selector it runs `document.querySelectorAll`,
unions the matched elements (deduped, document order), and emits records **only** for those
— including elements that a default read would exclude as non-interactive (FR-010: an
explicit selector overrides the exclusion). `fields` and `containerSelector` are mutually
exclusive; supplying both is a shape error (`INVALID_ARGS` via the existing zod/validation
path, not a new code). A `fields` entry that is not valid CSS → `INVALID_SELECTOR` (R9). A
`fields` entry that matches nothing is silently absent; all-miss → empty `records`.

**Rationale**: doing the filter *in the collector* (not post-hoc on synthesised selectors)
means the caller's own selector is what's honoured, and it naturally yields the
"explicit-overrides-exclusion" behaviour from the clarify session.

**Alternatives rejected**: filtering `records` in the main process by re-matching the
synthesised `selector` against the `fields` list → the synthesised selector can differ from
what the caller passed (id vs `[name]` vs structural), so matches would be missed.

---

## R7 — non-interactive exclusion + hidden value-mirror suppression (FR-010, FR-015, FR-016)

**Decision**: two categories are "non-interactive" and dropped from a default read:
1. `kind === "button"` records (plain buttons; submit buttons already carry a refusing
   verdict but are still noise for a fill workflow).
2. **Value-mirror inputs**: an `<input>` that is (a) not `visible`, (b) has a `name` or is
   `type="hidden"`, and (c) belongs to the same field cluster as a `combobox`/`listbox`
   record — "same cluster" = shares the `name`, or the combobox is within the mirror's
   nearest `[data-*]`/react-select container. The mirror record is tagged
   `interactive: false` and `mirrors: "<combobox selector>"`.

For each such cluster the **combobox** record is kept, and `synthesizeSelector` is
constrained to prefer the element that `choose_option`'s probe accepts (the
`role="combobox"` / listbox-owner), never the hidden `[name]` input (FR-015).

`includeNonInteractive: true` keeps both categories (mirrors still tagged
`interactive: false`). A `fields`-named selector is always kept (R6).

**Rationale**: the captured session's exact failure was picking the `[name="CA_29872"]`
mirror over `#input_CA_29872_input`. Collapsing the cluster and pinning the selector removes
the trap; keeping the mirror reachable (flag / `fields`) preserves the "what name does this
submit under" information.

**Alternatives rejected**:
- Deleting the mirror entirely → loses the submit-field name, which a careful agent may want
  to report.
- A generic "visible only" filter → would also hide legitimately-hidden-until-expanded
  fields that are not mirrors.

---

## R8 — per-record `operation` hint + `chooseVerdict` (FR-017)

**Decision**: add `operation: "fill" | "choose" | "activate" | "none"` to every record,
derived purely from `kind`: `text` / `textarea` / `richtext` → `fill`; `select` / `combobox`
/ `listbox` → `choose`; `checkbox` / `radio` / `button` → `activate`; `file` → `none`.
Add `chooseVerdict` (same `{ allowed, ruleId?, description? }` shape as `fillVerdict` /
`clickVerdict`), computed by a new `chooseVerdictFor(descriptor)` in `blocklist.ts` that
applies the `choose_option` gate — `submit-control`, `consent-toggle`, `credential-field`,
`external-act-label` refuse; `in-form` does **not**.

**Rationale**: the agent currently has to infer the operation from `kind` and separately
learn that `choose_option` ignores `in-form`. Making both explicit removes a class of
wrong-tool calls. `chooseVerdictFor` reuses the same rule predicates the other two verdict
functions use, so parity with `choose_option`'s actual refusals is by construction (tested
in `blocklist.test.ts`).

**Alternatives rejected**: overloading `clickVerdict` to mean "choose" for dropdowns →
conflates two operations with different gates.

---

## R9 — `INVALID_SELECTOR` detection (FR-018, FR-019, FR-020)

**Decision**: new `ErrorCode "INVALID_SELECTOR"`. A tiny shared module
`src/main/page/selector-syntax.ts` exports the fixed message and a helper the main-process
callers use. Detection is **in-page**: every injected script that resolves a caller-supplied
selector wraps the `document.querySelector(All)` call in
`try { … } catch (e) { if (e instanceof DOMException && e.name === "SyntaxError") return { __invalidSelector: true }; throw e; }`.
The main-process caller checks `__invalidSelector` first and throws
`new HyppoError("INVALID_SELECTOR", INVALID_SELECTOR_MESSAGE)`. Applied at: `interact`'s
`targetDescriptorScript` / `activeElementDescriptorScript` path, `choose-option.ts`
`probeScript`, `form-fields.ts` collector (`containerSelector` and each `fields` entry),
`interact.ts` `waitForSelector`'s poll script. A valid selector that matches nothing is
unchanged → `TARGET_NOT_FOUND` (FR-020).

**Message** (fixed): `"Invalid CSS selector. Only standard CSS selectors are supported —
text-matching pseudo-selectors (:has-text(), :text()), and combinators like >> or the
text= / xpath= prefixes, are not. Call read_form_fields or read_page to get a concrete #id
or [name=\"…\"] selector."`

**Rationale**: there is no dependency-free standalone CSS-selector parser; the DOM's own
`querySelector` is the authority. The `SyntaxError` `DOMException` is exactly what an invalid
selector throws, and it is distinguishable from every other failure. One message constant,
one module, imported everywhere — matches the repo's one-enforcer-per-guarantee rule.

**Alternatives rejected**:
- A hand-rolled selector validator in the main process → duplicates the browser's grammar,
  will drift.
- Only covering `interact` + `list_options` (the issue note's original scope) → the clarify
  session widened it to every entry point for consistency; a bad `containerSelector` giving
  a generic error was itself a papercut.

---

## R10 — `screenshot` tool

**Decision**: new MCP tool `screenshot`:

```
screenshot({ tabId, selector?, fullPage?=false, format?="jpeg"|"png"=jpeg, maxBytes?=262144 })
  -> image content block (base64) + text block { width, height, scale, format, limitNotMet }
```

- **Viewport** (default): `wc.capturePage()` → `NativeImage`.
- **Element** (`selector`): resolve `getBoundingClientRect()` in the tab (isolated world);
  if `width < 1 || height < 1` or fully outside the viewport → `SCREENSHOT_FAILED`
  ("element is not renderable") (FR-026); else `wc.capturePage({ x, y, width, height })`
  with integer rounding.
- **Full page** (`fullPage: true`): `wc.debugger.attach("1.3")`,
  `Page.captureScreenshot({ format, quality, captureBeyondViewport: true })`, detach in a
  `finally`. `selector` + `fullPage` together → the clip wins (element clip, `fullPage`
  ignored), noted in the contract.
- **Size fit** (FR-023): start from the `NativeImage` at natural size. If `format === "jpeg"`,
  encode at `config.screenshotJpegQualityStart` (80). While `bytes > maxBytes` and
  iterations < 6: first walk quality down to `config.screenshotJpegQualityFloor` (30) in
  ~15-point steps; then `resize({ width: round(width * 0.8) })` and reset quality to a mid
  value; re-encode. PNG path skips the quality steps and only downscales. Report
  `scale` = finalWidth / naturalWidth (1.0 when untouched) and `limitNotMet: true` if still
  over budget after the last iteration (return that smallest image anyway).
- **Queue**: wrapped in `queue.run` (Principle V).
- **No persistence, no audit entry** (FR-025).
- **Content block**: a new `okImage(dataBase64, mimeType, meta)` helper in `tools.ts`
  returns `{ content: [{ type: "image", data, mimeType }, { type: "text", text: JSON meta }] }`.

**Config**: `screenshotMaxBytes` (262144), `screenshotJpegQualityStart` (80),
`screenshotJpegQualityFloor` (30) — all env-overridable via the existing `numFromEnv`.

**Rationale**: `capturePage` covers the two common cases with zero new mechanism. CDP is
isolated to the one path that genuinely needs it (see plan Complexity Tracking). The
compress loop is bounded and pure enough to unit-test with stubbed encoders. JPEG default +
256 KB keeps a typical form view to one modest payload.

**Alternatives rejected**:
- `nativeImage` full-page via `WebContentsView` resize → disturbs the tab, races layout.
- Always PNG → a full form view is easily > 1 MB; spills the client to a file, the exact
  problem P1 fixes elsewhere.
- Returning only the image with no metadata → the agent can't tell a scaled-down shot from a
  native one.

---

## Cross-cutting: consistency surface for `screenshot` (FR-027, SC-010)

`TOOL_NAMES` in `src/main/mcp/tools.ts` is the single source the About-text guard
(`tests/unit/connection-snippets.test.ts`) checks. Adding `"screenshot"` there and to the
About-text tool list in `src/renderer/snippets.ts`, the contract
`specs/001-open-any-url/contracts/mcp-tools.md`, and the README tool table is one atomic
change; the guard test fails if any of the enumerations drift.
