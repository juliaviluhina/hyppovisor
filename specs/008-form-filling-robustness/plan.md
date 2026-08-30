# Implementation Plan: Form-Filling Robustness

**Branch**: `plan-008-form-filling-robustness` (feature dir `specs/008-form-filling-robustness`) |
**Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-form-filling-robustness/spec.md`

## Summary

Five additive changes to the read/prepare side of the MCP surface, all retrieval-only:

1. **`read_form_fields`** grows a `fields` projection, a `includeNonInteractive` toggle
   (default off), a 64 KB byte budget with a single `truncated` flag, text input-constraint
   hints (`maxLength` / `pattern` / `inputMode`), an `only: "required-unfilled"` filter, a
   hidden value-mirror suppression pass, and a per-record `operation` hint plus a
   `chooseVerdict`.
2. **`interact` gains `operation: "list_options"`** — a read-only enumeration that reuses
   `choose_option`'s probe → open → gather → close machinery, returns
   `{ options, optionsPresent, optionsTruncated }`, writes **no** interaction-log entry, and
   never changes the control's value.
3. **Selector hygiene** — the form reader collapses a scripted dropdown backed by a hidden
   same-named input into one interactive record whose `selector` is the one `choose_option`
   accepts; the mirror element is emitted only under `includeNonInteractive` or when named
   in `fields`.
4. **`INVALID_SELECTOR`** — a new error code raised (before any element lookup) whenever a
   selector supplied to `interact`, `list_options`, `wait_for_selector`, or
   `read_form_fields` (`containerSelector` / `fields`) is not valid CSS.
5. **`screenshot`** — a new MCP tool: `WebContents.capturePage()` for the viewport,
   `getBoundingClientRect` clip for an element, CDP `Page.captureScreenshot` for `fullPage`;
   JPEG by default, scaled/compressed to a 256 KB default budget, returned as an MCP image
   content block plus a `{ width, height, scale, limitNotMet }` text block. No disk write,
   no audit entry.

Documented non-goals (FR-029/FR-030): file-upload drafting stays refused (README "what the
app will not do" gains a line); `fill` gains no autocomplete suggestion-picking (its docs
gain a line).

No change to `open_url`, `navigate`, `list_open_tabs`, `read_page`, the blocklist's refusal
set, the interaction audit log's existing entries, the action queue, or the transport.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22, ESM for `src/main` / `src/shared`; Electron 33.

**Primary Dependencies**: Electron (`WebContents.executeJavaScript`, `WebContents.capturePage`,
`WebContents.debugger` for the CDP full-page path, `NativeImage` `toJPEG` / `toPNG` /
`resize`); `@modelcontextprotocol/sdk` (`server.tool`, image content block); `zod`. **No new
runtime dependencies.**

**Storage**: None. `list_options` and `screenshot` persist nothing and add no audit entry —
same posture as `read_page` (Principle V). No new file under `userData` or the shared data
directory.

**Testing**: `vitest` unit — pure helpers: the byte-budget trimmer, the screenshot
scale/compress loop (image bytes stubbed), the mirror-input classifier, the
`required-unfilled` predicate, `chooseVerdictFor`. `@playwright/test` `_electron`
integration — new `tests/integration/list-options.spec.ts`,
`tests/integration/screenshot.spec.ts`; extensions to `read-form-fields.spec.ts`,
`interaction.spec.ts` (INVALID_SELECTOR across entry points). New fixture
`tests/fixtures/combobox.html` (a lazy, options-render-on-open widget with a hidden
value-mirror input) and additions to `tests/fixtures/form.html`.

**Target Platform**: Electron desktop app (macOS primary; Windows/Linux build) + embedded
MCP HTTP/stdio server.

**Project Type**: Single project — existing `src/main/**` + `src/shared/**` + `src/renderer/**`
+ `tests/**` layout.

**Performance Goals**: `list_options` completes within the existing `chooseOptionWaitMs`
window (default 10 s, env-overridable) — one open, one MutationObserver-bounded gather, one
close. `screenshot` viewport/element path is a single `capturePage`; the compress loop is
bounded to ≤ 6 iterations. `read_form_fields` adds one `JSON.stringify` length measurement
and a tail-trim loop.

**Constraints**: One page operation in flight app-wide — every new path goes through
`queue.run` (Principle V). Retrieval only — no external act, nothing written (Principles I,
V). Verbatim obligation: option labels and field values are returned unmodified; the
screenshot is explicitly a *supplementary* visual aid, not the verbatim text channel, and
every size reduction is flagged (Principle V's "truncation MUST be explicitly indicated").

**Scale/Scope**: Target is a ~60-control third-party application form with ~7 scripted
dropdowns. Option lists bounded by the existing `formFieldOptionCap` (200). Screenshot
default budget 256 KB; form-read budget 64 KB.

## Constitution Check

*GATE: re-checked after Phase 1 design — still passing.*

### I. Human Does Every External Act (NON-NEGOTIABLE) — PASS

- `list_options` performs the same widget open/close `choose_option` already performs, but
  **selects nothing** and fires no activation on any option — strictly less action than the
  already-permitted `choose_option`. It cannot submit, send, or press Enter.
- `screenshot` is a local frame capture; it touches no site control and sends nothing.
- The blocklist gate still refuses `list_options` on any submit / consent / credential /
  external-act target, by the *same* rule that refuses `choose_option` there (FR-005).
- No new capability performs an external act, so no constitution amendment is required (the
  amendment trigger in Principle I is specifically "a capability that would perform an
  external act").
- FR-029/FR-030 hold the line: file-upload drafting stays refused; `fill` gains no
  suggestion-picking.

### II. Zero Business Logic in HyppoVisor — PASS

No scoring, ranking, tiering, or interpretation. `operation` hint and `chooseVerdict` are
mechanical restatements of a control's `kind` and the existing blocklist verdict.
`required-unfilled` is a literal `required && value-is-empty` predicate, not a judgement.

### III. Solid and Comprehensible — PASS (one mechanism noted)

- **One new MCP tool** (`screenshot`) and **one new `interact` operation** (`list_options`).
  Both sit on the existing MCP surface — no new IPC channel, no new persistent store, no new
  service.
- The **CDP `WebContents.debugger` attach** used only for the `fullPage` screenshot path is
  new mechanism. Justified in Complexity Tracking: Electron exposes no "capture beyond
  viewport" API, `Page.captureScreenshot` is the standard route, the attach/detach is
  per-call, and the action queue guarantees no concurrent debugger client. The viewport and
  element-clip paths (the common case) use plain `capturePage` with no debugger.
- `list_options` writes **no** audit-log entry. This is consistent with `read_page` /
  `read_form_fields` (reads don't log), not a regression of "every `interact` op logs
  exactly one entry" — that invariant is about *actions*; `list_options` is a read. Called
  out here and at review.

### IV. User-Held Credentials and Sessions — PASS

- `screenshot` captures only what is already rendered. Credential inputs render masked and
  stay masked in the image. Nothing is typed, captured as a password, or transmitted.
- FR-028 puts this in the tool contract in writing. No screenshot or option list is written
  to any storage.

### V. Assistive Pace, Not Bulk Collection — PASS

- Every path is `queue.run`-serialised: at most one page operation in flight app-wide.
- No page content reaches the shared data directory. `list_options` and `screenshot` persist
  nothing — the returned payload is the only copy.
- Option labels and field values are returned **verbatim**. The 64 KB form-read budget and
  the 256 KB screenshot budget each carry an explicit "was trimmed / scaled" flag
  (FR-011, FR-023, FR-008) — truncation is never silent.
- The screenshot is a supplementary visual aid; the verbatim-text preservation channel
  (`read_page`) is unchanged, so the Principle V "a caller that stores the payload can
  reconstruct the page's visible text" obligation is unaffected.
- No crawling, no traversal — `list_options` and `screenshot` act only on a tab the caller
  already holds.

### Architecture Constraints — PASS

`hyppovisor` gains no dependency on `hyppograph`. MCP stays the only session bridge; the new
tool is on that bridge. No change to the shared data directory or provenance logging (page
reads produce no provenance entry; these produce none either).

## Project Structure

### Documentation (this feature)

```text
specs/008-form-filling-robustness/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions R1–R10
├── data-model.md        # Phase 1 — extended records + new result shapes
├── quickstart.md        # Phase 1 — the 60-control-form walkthrough as the acceptance run
├── contracts/
│   └── mcp-tools-008-delta.md   # Phase 1 — exact tool/param/field/error deltas
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/main/
├── config.ts                  # + formFieldReadMaxBytes (64K), screenshotMaxBytes (256K),
│                              #   screenshotJpegQualityStart/Floor
├── errors.ts                  # + "INVALID_SELECTOR"; + "SCREENSHOT_FAILED"
├── mcp/
│   └── tools.ts               # register `screenshot`; `interact` enum + `list_options`;
│                              #   read_form_fields params; TOOL_NAMES (+screenshot);
│                              #   okImage() content-block helper
├── safety/
│   └── blocklist.ts           # + chooseVerdictFor(descriptor) (choose_option gate, no in-form)
└── page/
    ├── form-fields.ts         # fields projection, includeNonInteractive, byte budget,
    │                          #   mirror-input suppression, operation hint, input
    │                          #   constraints, only filter, invalid-selector catch
    ├── choose-option.ts       # export listOptions(); invalid-selector catch in probeScript
    ├── interact.ts            # `list_options` branch (no log.record); invalid-selector catch
    ├── screenshot.ts          # NEW — takeScreenshot(wc, opts): capturePage / rect clip /
    │                          #   CDP fullPage; scale+compress loop; SCREENSHOT_FAILED
    └── selector-syntax.ts     # NEW (small) — the shared "not valid CSS" sentinel + message

src/shared/
└── types.ts                   # FormFieldRecord additions; ListOptionsResult; ScreenshotResult

tests/
├── unit/
│   ├── screenshot.test.ts     # NEW — scale/compress loop, limitNotMet, format pick
│   ├── form-fields.test.ts    # + byte trim, mirror classifier, operation hint,
│   │                          #   required-unfilled, input-constraint extraction
│   ├── choose-option.test.ts  # + listOptions gather/close, no-populate → empty+flag
│   ├── blocklist.test.ts      # + chooseVerdictFor parity with choose_option refusals
│   └── connection-snippets.test.ts  # auto-covers screenshot via TOOL_NAMES
├── integration/
│   ├── list-options.spec.ts   # NEW — native + lazy widget, not-a-dropdown, no-populate,
│   │                          #   blocklist parity, no audit entry, value unchanged
│   ├── screenshot.spec.ts     # NEW — viewport, element clip, maxBytes scaling, fullPage,
│   │                          #   non-renderable element error, no file / no audit entry
│   ├── read-form-fields.spec.ts   # + fields, includeNonInteractive, budget, only,
│   │                              #   mirror collapse, operation hint, INVALID_SELECTOR
│   └── interaction.spec.ts    # + INVALID_SELECTOR for interact & wait_for_selector
└── fixtures/
    ├── combobox.html          # NEW — options render on open; hidden value-mirror input
    └── form.html              # + maxlength/pattern/inputmode fields; a required-empty set

specs/001-open-any-url/contracts/mcp-tools.md   # contract: screenshot row, list_options,
                                                #   read_form_fields params, INVALID_SELECTOR
README.md                                       # tool table + screenshot; "will not do" file
                                                #   upload line; fill autocomplete note
```

**Structure Decision**: Single project, existing layout. The one-file-per-guarantee
convention is kept: `INVALID_SELECTOR` is minted only via `HyppoError`
(`src/main/errors.ts`), the selector-syntax sentinel lives in one small module
(`src/main/page/selector-syntax.ts`) imported by every call site, and the screenshot logic
is one module (`src/main/page/screenshot.ts`).

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| `WebContents.debugger` (CDP) attach for the `fullPage` screenshot path | Electron `capturePage` captures only the composited viewport; `Page.captureScreenshot({ captureBeyondViewport: true })` is the only way to get the full scroll height. FR-024 requires the full-page option. | Dropping `fullPage`: rejected — tall application forms are exactly where a single scroll-height capture beats several viewport shots, and the spec requires it. Resizing the `WebContentsView` to content height and capturing: rejected — visibly disturbs the tab and races layout. The attach is per-call and the action queue guarantees a single debugger client at a time. |
| `list_options` is an `interact` op that does **not** write an audit entry | It is a read; forcing a log entry would make the audit log's "every entry is an action attempt" reading false. | A standalone `list_options` MCP tool: rejected — grows `TOOL_NAMES` to 9 and duplicates `interact`'s queue/error wrapping for no behavioural gain. Logging it as a read: rejected — `read_page` / `read_form_fields` set the precedent that reads don't log. |
