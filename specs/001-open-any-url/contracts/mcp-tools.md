# Contract: MCP Tool Surface

**Feature**: 001-open-any-url | **Transport**: Streamable HTTP on loopback (default) or stdio | **Date**: 2026-08-29

The complete interface HyppoVisor exposes. Eight tools, no others (`read_form_fields`
was added by feature 005; `screenshot` by feature 008). Entity shapes are in
[data-model.md](../data-model.md); error codes are defined there too.

> **Runtime configuration (feature 007).** The HTTP listening port and the optional bearer
> token are now configurable at runtime from the in-app connection panel (opened via the 🦛
> button or the bottom `MCP` line), and persist in `settings.json` in the app's user-data
> directory. `HYPPO_MCP_PORT` / `HYPPO_MCP_TOKEN` remain the override for headless launches
> (precedence: env var > `settings.json` > default). This changes neither the tool set nor
> any tool's contract below.

**Contract invariants**, true of every tool:

- No tool submits a form, sends a message, or completes an application (FR-012, Principle I).
- No tool interprets page content — raw only (FR-011, Principle II).
- No tool writes page content anywhere (FR-019, Principle V).
- Every call acquires the app-wide queue; at most one is in flight (FR-013).
- Every interaction call produces exactly one interaction-log entry (FR-024a).
- Errors return a named code, never a generic failure (FR-014).

---

## `open_url`

Opens a URL in a new tab. Equivalent to the person typing it (FR-003).

**Input**: `{ url: string }` — must be `http`/`https`.

**Returns**: `{ tabId, url, title, loadState, queueDepth }` — `url` is the **final** URL after
redirects.

**Errors**: `INVALID_URL`, `SCHEME_NOT_ALLOWED`, `LOAD_FAILED`.

**Notes**: uses the person's existing in-app session; never triggers an app-initiated login
(FR-002, FR-016). Does not follow in-page links on its own (FR-006).

---

## `list_open_tabs`

**Input**: `{}`

**Returns**: `{ tabs: [{ tabId, url, title, loadState }] }` (FR-009).

---

## `read_page`

Returns the current content of one tab. Nothing is persisted — this payload is the only copy.

**Input**: `{ tabId: string, includeDom?: boolean }` — `includeDom` defaults to `false`.

**Returns**: `{ tabId, url, title, text, dom?, observedAt, truncated: { text, dom }, queueDepth }`

- `text` is verbatim visible text, never summarized or reformatted (FR-010b).
- `dom` present only when `includeDom: true` (FR-010a).
- Limits: `text` 100 KB default, `dom` its own separate limit; exceeding either truncates that
  part and sets its flag (FR-021).

**Errors**: `TAB_NOT_FOUND`.

**Guarantee**: the payload is self-sufficient — a caller that stores it can reconstruct the page's
visible text offline (SC-010).

---

## `navigate`

Points an existing tab at a new URL.

**Input**: `{ tabId: string, url: string }`

**Returns**: `{ tabId, url, title, loadState, queueDepth }`

**Errors**: `TAB_NOT_FOUND`, `INVALID_URL`, `SCHEME_NOT_ALLOWED`, `LOAD_FAILED`.

---

## `interact`

Bounded interaction to reveal content. **Cannot** submit, send, or apply.

**Input**:
`{ tabId: string, operation: "click" | "fill" | "scroll" | "space" | "choose_option" | "list_options", selector?: string, value?: string, label?: string, fields?: Array<{ selector: string, value: string }> }`

- `selector` required for `click`, `fill` (single form), `choose_option`, and `list_options`;
  `space` acts on the focused element.
- `value` required for `fill` (single form).
- `fields` (feature 004) — `fill` only, an alternative to `selector` + `value`: an ordered
  list of up to 50 `{ selector, value }` pairs applied in one call. Supply exactly one of the
  two forms.
- `label` (feature 006) — `choose_option` only: the target option's visible label
  (case-insensitive, whitespace-collapsed). Supply `label` and/or `value`; with both, `value`
  selects and `label` must also match. `choose_option` never presses Enter and never submits.
- `fill` non-goals (feature 008): `fill` on `<input type="file">` stays **refused** —
  attaching a file is a human step. `fill` types the **literal** text and stops; choosing
  among an address / place autocomplete suggestion list is a human step.
- `list_options` (feature 008) — read-only enumeration of a dropdown's current choices.
  Takes `tabId` + `selector`; `value` / `label` / `fields` are ignored. Valid targets are the
  same as `choose_option` (single-select `<select>`, `role=combobox`/`listbox`, or a
  listbox-owner). It opens and closes a scripted menu if needed, selects nothing, leaves the
  control's value and menu state exactly as found, and writes **no** interaction-audit entry
  on any path.

**Returns**: `{ tabId, operation, outcome: "permitted", queueDepth }`. A permitted single
`fill` also carries `currentValue` — the field's value read back after the write,
post-formatting (feature 011; omitted for a credential target, which is refused earlier). A
batch `fill`
returns `{ tabId, operation: "fill", outcome: "permitted" | "partial", fields: Array<{ selector, outcome, message? }>, summary: { requested, written, errored }, queueDepth }`.
A permitted `choose_option` additionally carries `chosenOption: { label, value }` — the
matched option's verbatim label and value (feature 006).
`list_options` returns `{ tabId, selector, options: Array<{ label, value, disabled }>,
optionsPresent, optionsTruncated, queueDepth }` (feature 008). `options` is in document
order; `label` is verbatim except surrounding whitespace; `value` precedence is
`data-value` → `value` → `id` → `""`. A native `<select>` always has `optionsPresent: true`
and is read without opening anything. A scripted menu that never populates within the
option-wait window returns `options: []`, `optionsPresent: false` — **not** an error.
`options` is capped at `formFieldOptionCap`; `optionsTruncated: true` when it bit.

**Errors**: `TAB_NOT_FOUND`, `TARGET_NOT_FOUND`, `INVALID_SELECTOR`, `REFUSED_EXTERNAL_ACT`,
`BATCH_REJECTED`, `CHOOSE_OPTION_FAILED`, `WRITE_NOT_APPLIED`.

**`WRITE_NOT_APPLIED`** (feature 011): `fill` typed a well-formed value with real key
events but a read-back shows the field did not accept it (empty, unchanged, or a truncated
prefix — an input mask may need a different format). Not a refusal — no `ruleId`; carries
`currentValue` (the read-back, omitted for a credential target). The single-`fill` path
throws it; in a batch it is that entry's `error` outcome and the remaining entries still
fill. The interaction-log entry is `outcome: "error"`.

**Refusal**: when the target matches a blocklist rule, returns `REFUSED_EXTERNAL_ACT` with
`{ ruleId, description }` and a message referencing the no-external-act rule (FR-012, FR-012a).
The `external-act-label` rule reads only the target control's **own** accessible name, never
a nearby button or the drafted value (feature 011), so a plain field cannot become refused
because of what was typed into it.
`fill` additionally refuses credential inputs (FR-018).
`click` inside a `<form>` is refused (`in-form`) **except** a `<button type="button">` with
no `formaction`, not the implicit submit, own label not an outward act — permitted since
constitution 1.4.0 to reveal a repeatable sub-form (feature 011). A batch `fill` with any forbidden or
unresolved target returns `BATCH_REJECTED` with a `targets[]` breakdown and writes nothing;
cap / empty / malformed-call refusals use `BATCH_REJECTED` without `targets` (feature 004).
`choose_option` refuses a non-chooser, an ambiguous / disabled / no-match / never-rendered
option, or a `<select multiple>` with `CHOOSE_OPTION_FAILED` and a `reason` (`not-a-dropdown`
/ `no-option-match` / `ambiguous-option` (+ `candidates`) / `option-disabled` /
`option-not-appeared` / `multi-select`); a submit/consent/credential/wording chooser is
`REFUSED_EXTERNAL_ACT`. `in-form` does not gate `choose_option`. Every refusal leaves the
control unchanged (feature 006).
`list_options` (feature 008) is blocklist-gated identically to `choose_option`
(submit/consent/credential/wording → `REFUSED_EXTERNAL_ACT` with the same `ruleId`; `in-form`
does not gate it); a non-chooser or `<select multiple>` → `CHOOSE_OPTION_FAILED`
(`reason: "not-a-dropdown"`); a non-CSS `selector` → `INVALID_SELECTOR`. It never writes an
interaction-audit entry.

---

## `read_form_fields` (feature 005)

Read-only, derived view for building a batch `fill`. `read_page` is unchanged.

**Input**: `{ tabId: string, containerSelector?: string, fields?: string[],
includeNonInteractive?: boolean, only?: "required-unfilled" }`.

- `containerSelector` — omit for the whole page; give it to scope to controls inside that
  element. Mutually exclusive with `fields` (supplying both → `BATCH_REJECTED`).
- `fields` (feature 008) — return records only for controls matching these selectors, in
  document order. An explicit selector is returned **even for a non-interactive element**
  (overrides the default exclusion). A non-matching entry is silently absent; all-miss ⇒
  empty `records`. A non-CSS entry → `INVALID_SELECTOR`.
- `includeNonInteractive` (feature 008, default `false`) — when `false`, plain buttons and
  hidden value-mirror inputs are omitted. When `true`, they are included (a mirror carries
  `interactive: false` + `mirrors`). Feature 011: `true` also restores the diagnostic
  fields (`selectorSynthesised`, `duplicateId`, `optionsAvailable`, `optionsTruncated`) and
  every record's `options` array, all of which the lean default record omits.
- `only: "required-unfilled"` (feature 008) — return only records that are `required` and
  whose current value is empty (empty string / unchecked / no option chosen).

**Returns**: `FormFieldMap` — `{ tabId, url, observedAt, truncated, records[], queueDepth }`.
Each record (feature 011 — the **lean default**): `selector` (usable by `interact`, verified
unique at call time; `null` only when none could be built), `kind`, raw `type`, verbatim
`label`, `required`, `group` (radios), `inFormAncestor`, `visible`, `currentValue` (**omitted
entirely** for a credential field), `options` (only for a dropdown kind in the default read;
every kind under `includeNonInteractive`), `fillVerdict` / `clickVerdict` — identical in shape
and content to what `interact` returns for that target — and (feature 008) `operation`
(`"fill" | "choose" | "activate" | "none"`, derived from `kind`), `chooseVerdict`
(`{ allowed, ruleId?, description? }` — what `choose_option` would return; `in-form` does not
gate it), `interactive: false` on a surfaced plain button / value-mirror, `mirrors` on a
value-mirror (the combobox `selector` it carries the value for), and `maxLength` / `pattern`
/ `inputMode` on a text-like record that declares them. Under `includeNonInteractive` each
record also carries `selectorSynthesised`, `duplicateId`, `optionsAvailable`, and
`optionsTruncated` (feature 011 — omitted from the lean default). Verdicts are computed
after the DOM reaches `readyState: "complete"` (bounded wait), so a re-read of an unchanged
page returns the same verdict (feature 011). A scripted dropdown backed by a
hidden same-named input collapses to **one** record whose `selector` is the one
`choose_option` / `list_options` accept (the `role=combobox` element), not the hidden
`[name]` input.

**Errors**: `TAB_NOT_FOUND`, `TARGET_NOT_FOUND` (a container selector that resolves to
nothing), `INVALID_SELECTOR` (a non-CSS `containerSelector` or `fields` entry),
`BATCH_REJECTED` (`fields` and `containerSelector` supplied together).

**Notes**: performs no interaction, writes nothing to the shared data directory, adds no
interaction-audit-log entry. Bounded by `formFieldControlCap` (control count),
`formFieldOptionCap` (per-record `optionsTruncated`), and a `formFieldReadMaxBytes` byte
budget (64 KB default) that drops tail records in document order — the single result-level
`truncated` flag covers all three.

---

## `wait_for_selector`

**Input**: `{ tabId: string, selector: string, timeoutMs?: number }` — default 10000.

**Returns**: `{ tabId, selector, found: true, queueDepth }`

**Errors**: `TAB_NOT_FOUND`, `WAIT_TIMEOUT` — timeout leaves the tab unchanged (US3 scenario 6).
A non-CSS `selector` → `INVALID_SELECTOR` (feature 008); a valid selector that never appears
still → `WAIT_TIMEOUT`.

---

## `screenshot` (feature 008)

A picture of a tab, to check its rendered state. Retrieval only — touches no control, sends
nothing, **writes nothing to disk, adds no interaction-audit entry** (matches `read_page`).
Runs through the app-wide action queue.

**Input**: `{ tabId: string, selector?: string, fullPage?: boolean, format?: "jpeg" | "png",
maxBytes?: integer }`.

- default — capture the viewport.
- `selector` — clip to that element's on-screen box; **wins over `fullPage`**. Echoed back
  as `element`.
- `fullPage: true` — capture the full scroll height (CDP `Page.captureScreenshot`,
  `captureBeyondViewport`).
- `format` — `"jpeg"` (default) or `"png"`.
- `maxBytes` — scale/compress until the image fits (default 262144 = 256 KB). A caller may
  only **lower** it; it is clamped to the default ceiling and a small floor.

**Returns**: an MCP **image** content block (`{ type: "image", data: <base64>, mimeType }`)
followed by a **text** content block: `{ tabId, width, height, scale, format, fullPage,
element?, limitNotMet }`. `scale` = returned width ÷ natural width (`1` = not downscaled).
`limitNotMet: true` ⇒ still over `maxBytes` at the compression floor; the smallest achievable
image is returned anyway. The bytes are **not** persisted — the content block is the only copy.

**Errors**: `TAB_NOT_FOUND`; `INVALID_SELECTOR` (a non-CSS `selector`); `SCREENSHOT_FAILED`
(the element resolves but is zero-size / fully off-viewport, or the capture/encode pipeline
failed — `cause` set).

**Privacy**: captures only what is rendered; credential inputs render masked and stay masked.
A screenshot may show a signed-in identity or a partly-drafted value — not a new disclosure
class, page text is already retrievable via `read_page`.

---

## Deliberately absent

No tool exists for: submitting a form, clicking an "Apply"/"Send" control, entering credentials,
downloading a file, closing a tab, or reading a tab the person did not open. Their absence is the
contract — Principle I is enforced by the surface's shape, not only by runtime checks.
