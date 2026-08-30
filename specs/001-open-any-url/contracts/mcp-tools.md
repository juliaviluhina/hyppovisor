# Contract: MCP Tool Surface

**Feature**: 001-open-any-url | **Transport**: Streamable HTTP on loopback (default) or stdio | **Date**: 2026-08-29

The complete interface HyppoVisor exposes. Seven tools, no others (`read_form_fields`
was added by feature 005). Entity shapes are in
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
`{ tabId: string, operation: "click" | "fill" | "scroll" | "space" | "choose_option", selector?: string, value?: string, label?: string, fields?: Array<{ selector: string, value: string }> }`

- `selector` required for `click`, `fill` (single form), and `choose_option`; `space` acts on
  the focused element.
- `value` required for `fill` (single form).
- `fields` (feature 004) — `fill` only, an alternative to `selector` + `value`: an ordered
  list of up to 50 `{ selector, value }` pairs applied in one call. Supply exactly one of the
  two forms.
- `label` (feature 006) — `choose_option` only: the target option's visible label
  (case-insensitive, whitespace-collapsed). Supply `label` and/or `value`; with both, `value`
  selects and `label` must also match. `choose_option` never presses Enter and never submits.

**Returns**: `{ tabId, operation, outcome: "permitted", queueDepth }`. A batch `fill`
returns `{ tabId, operation: "fill", outcome: "permitted" | "partial", fields: Array<{ selector, outcome, message? }>, summary: { requested, written, errored }, queueDepth }`.
A permitted `choose_option` additionally carries `chosenOption: { label, value }` — the
matched option's verbatim label and value (feature 006).

**Errors**: `TAB_NOT_FOUND`, `TARGET_NOT_FOUND`, `REFUSED_EXTERNAL_ACT`, `BATCH_REJECTED`,
`CHOOSE_OPTION_FAILED`.

**Refusal**: when the target matches a blocklist rule, returns `REFUSED_EXTERNAL_ACT` with
`{ ruleId, description }` and a message referencing the no-external-act rule (FR-012, FR-012a).
`fill` additionally refuses credential inputs (FR-018). A batch `fill` with any forbidden or
unresolved target returns `BATCH_REJECTED` with a `targets[]` breakdown and writes nothing;
cap / empty / malformed-call refusals use `BATCH_REJECTED` without `targets` (feature 004).
`choose_option` refuses a non-chooser, an ambiguous / disabled / no-match / never-rendered
option, or a `<select multiple>` with `CHOOSE_OPTION_FAILED` and a `reason` (`not-a-dropdown`
/ `no-option-match` / `ambiguous-option` (+ `candidates`) / `option-disabled` /
`option-not-appeared` / `multi-select`); a submit/consent/credential/wording chooser is
`REFUSED_EXTERNAL_ACT`. `in-form` does not gate `choose_option`. Every refusal leaves the
control unchanged (feature 006).

---

## `read_form_fields` (feature 005)

Read-only, derived view for building a batch `fill`. `read_page` is unchanged.

**Input**: `{ tabId: string, containerSelector?: string }` — omit `containerSelector`
for the whole page; give it to scope to controls inside that element.

**Returns**: `FormFieldMap` — `{ tabId, url, observedAt, truncated, records[], queueDepth }`.
Each record: `selector` (usable by `interact`, verified unique at call time; `null` only when
none could be built), `selectorSynthesised` / `duplicateId`, `kind`, raw `type`, verbatim
`label`, `required`, `group` (radios), `inFormAncestor`, `visible`, `currentValue` (**omitted
entirely** for a credential field), `options` + `optionsAvailable` + `optionsTruncated`
(`<select>` and in-DOM combobox menus), and `fillVerdict` / `clickVerdict` — identical in
shape and content to what `interact` returns for that target.

**Errors**: `TAB_NOT_FOUND`, `TARGET_NOT_FOUND` (a container selector that resolves to nothing).

**Notes**: performs no interaction, writes nothing to the shared data directory, adds no
interaction-audit-log entry. Bounded by `formFieldControlCap` (result-level `truncated`) and
`formFieldOptionCap` (per-record `optionsTruncated`).

---

## `wait_for_selector`

**Input**: `{ tabId: string, selector: string, timeoutMs?: number }` — default 10000.

**Returns**: `{ tabId, selector, found: true, queueDepth }`

**Errors**: `TAB_NOT_FOUND`, `WAIT_TIMEOUT` — timeout leaves the tab unchanged (US3 scenario 6).

---

## Deliberately absent

No tool exists for: submitting a form, clicking an "Apply"/"Send" control, entering credentials,
downloading a file, closing a tab, or reading a tab the person did not open. Their absence is the
contract — Principle I is enforced by the surface's shape, not only by runtime checks.
