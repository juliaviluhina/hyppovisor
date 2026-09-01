# Implementation Plan: Form-Fill Fidelity

**Branch**: `011-form-fill-fidelity` (feature dir `specs/011-form-fill-fidelity`) |
**Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-form-fill-fidelity/spec.md`

## Summary

Five changes that make `fill` and the form-field verdict *faithful* — the tool's report
matches what happened on the page. Four are fixes to existing behaviour; one (US4) is a
narrow new permission that needs a constitution amendment first.

1. **`fill` types like a keyboard, then reads back (US1).** `fillScript` gains a
   per-character key-event pass (`keydown` → `beforeinput` → native-setter value step →
   `input` → `keyup`) so input masks / formatters that build their value from key events
   receive it. After writing, the same call reads `el.value` / `el.innerText` back and
   compares (formatter separators normalised, a strict-short prefix = truncation). A write
   that did not land throws `WRITE_NOT_APPLIED` carrying the read-back value; a write that
   landed returns `{ currentValue }`. In a batch, a `WRITE_NOT_APPLIED` on one entry is
   that entry's `error` outcome and the rest still fill (existing mid-write behaviour).

2. **The external-act check stops reading the field's own draft (US2).** The shared
   descriptor `name` currently concatenates `el.innerText` + `el.value` with the label
   sources. For a `<textarea>` / `contenteditable` / text-like `<input>`, that folds the
   *drafted answer* into the string the `external-act-label` rule matches — so a draft
   containing a common word ("apply", "join", "post", "order", "continue", …) makes every
   later `fill` on that field refuse. Fix: exclude a value-bearing control's own editable
   text from `name`; keep `el.value` for `<button>` / `<input type=submit|button|reset|
   image>` where it is the caption, not user input.

3. **The verdict is stable across reads (US3).** Same root cause as US2 — the verdict
   flipped because the descriptor `name` changed when the value was drafted, not because
   page policy changed. The US2 descriptor fix makes a re-read deterministic and is the
   primary fix. Plus a bounded `document.readyState === "complete"` poll in
   `read_form_fields` (new — no read path gates on readiness today) so a verdict is never
   computed against a still-parsing DOM. `read_page` is left untouched.

4. **A non-submit in-form button may be clicked to reveal a sub-form (US4).** `in-form`
   stops refusing a `<button type="button">` that declares no `formaction` and is not
   caught by an earlier rule (`submit-control` already claims a bare/`type=submit` button;
   `external-act-label` already claims an outward-labelled one). `TargetDescriptor` gains
   `formAction`. **Gated on a MINOR constitution amendment** to Principle I (FR-016) that
   MUST merge before the rule change — see Constitution Check.

5. **The default form-read record is leaner (US5).** `selectorSynthesised`, `duplicateId`,
   `optionsTruncated`, and `optionsAvailable` move behind `includeNonInteractive`; the
   default record keeps `selector`, `kind`, `type`, `label`, `required`, `group`,
   `inFormAncestor`, `visible`, `currentValue`, `operation`, `fillVerdict`, `clickVerdict`,
   `chooseVerdict`, and `options` only for a dropdown. An unscoped read of a ~60-control
   form then fits the 64 KB budget with no record trimmed. Callers passing `fields` / `only`
   are unaffected.

No change to `open_url`, `navigate`, `list_open_tabs`, `read_page`, `screenshot`,
`wait_for_selector`, the action queue, the transport, or the set of MCP tools. No new tool,
no new `interact` operation.

## Technical Context

**Language/Version**: TypeScript 5.7, Node ≥ 22, ESM for `src/main` / `src/shared`;
Electron 33.

**Primary Dependencies**: Electron (`WebContents.executeJavaScript` in an isolated world);
`@modelcontextprotocol/sdk` (`server.tool`); `zod`. **No new runtime dependencies.**

**Storage**: None. `read_form_fields` still writes no audit entry and persists nothing
(FR-026). `fill` still appends exactly one interaction-log entry per single call / per
batch entry — the only new log lines are the permitted in-form clicks from US4, which the
amendment classifies as preparation.

**Testing**: `vitest` unit — the descriptor `name` builder with/without the own-value
contribution, `fillVerdictFor` / `clickVerdictFor` parity on a value-bearing control before
and after a draft, the read-back comparator (separator normalisation, prefix-short =
truncation), the leaner-record projection, the narrowed `in-form` matcher (four boundary
cases). `@playwright/test` `_electron` integration — extensions to
`tests/integration/interaction.spec.ts`, `batch-fill.spec.ts`, `read-form-fields.spec.ts`;
new `tests/fixtures/masked.html` (an `MM/YYYY` mask + a phone mask) and additions to
`tests/fixtures/form.html` / `expander.html` (an "Add row" `<button type="button">` inside
a `<form>`).

**Target Platform**: Electron desktop app (macOS primary; Windows/Linux build) + embedded
MCP HTTP/stdio server.

**Project Type**: Single project — existing `src/main/**` + `src/shared/**` + `tests/**`
layout.

**Performance Goals**: the per-character type loop is bounded by the value length and runs
one `executeJavaScript` round-trip (the loop is in-page). The read-back is one extra
in-page expression. `read_form_fields` adds one bounded `readyState` poll
(`config.domReadyTimeoutMs`, default 1000 ms, proceeds on timeout). No measurable change to
`read_page` / `screenshot` / `choose_option`.

**Constraints**: one page operation in flight app-wide — every path already goes through
`queue.run` (Principle V). `fill` read-back respects the credential-value omission (FR-007):
for a `credential-field` target it verifies non-emptiness only and never returns the value.
Verbatim obligation unaffected — `read_page` is untouched.

**Scale/Scope**: target is the captured ~60-control A2Z Sync Workable form
(`specs/issues/005-form-fill-second-workable-session.md`) — masked `MM/YYYY` dates, the
`#CA_42882` free-text question, the "Add Experience" / "Add Education" buttons, the unscoped
read payload.

## Constitution Check

*GATE: US1–US3, US5 pass now. US4 depends on an amendment that MUST land before its code —
re-checked after Phase 1: unchanged.*

### I. Human Does Every External Act (NON-NEGOTIABLE)

- **US1 / US2 / US3 / US5 — PASS.** `fill` gains a more truthful outcome (real typing +
  read-back) and a more precise refusal (its own-label scope); it still cannot submit, send,
  or press Enter. The descriptor fix *narrows* what `external-act-label` matches but keeps
  every genuine outward label refused (a control whose own `<label>` / `aria-label` reads
  "Submit application" still refuses). `read_form_fields` stays a read.
- **US4 — REQUIRES AMENDMENT.** Permitting any `click` inside a `<form>` touches the
  Principle I clause "any `click` inside a `<form>`" is refused. Decision 2026-08-31
  (spec Clarifications, interpretation B1): adopt a narrow carve-out. The amendment adds a
  clause to Principle I — *"clicking a non-submit in-form control (`<button type="button">`
  with no `formaction`, not the implicit submit, own label not an outward act) to reveal a
  repeatable sub-form is preparation"* — versioned **1.4.0 (MINOR)** by the precedent of
  1.2.0 (value entry is preparation) and 1.3.0 (choosing an option is preparation): a
  binding clarification that expands existing guidance, redefines no principle, invalidates
  no conforming artifact. The amendment commit + an Amendment History entry referencing
  this feature and `specs/issues/005-…` MUST be the first change on the implementation
  branch; the `in-form` rule change MUST NOT merge without it. Recorded in Complexity
  Tracking.
- No new capability performs an external act, so beyond this one clause no further
  amendment is triggered. The final Submit, file attachment, reCAPTCHA, and the Enter key
  stay out of scope.

### II. Zero Business Logic in HyppoVisor — PASS

No scoring, ranking, or interpretation. The read-back comparator is a string test
(normalise separators, check equality / prefix). The leaner record drops fields; it computes
nothing new. The `in-form` narrowing is a structural test on `tagName` / `type` /
`formAction`.

### III. Solid and Comprehensible — PASS

- No new MCP tool, no new `interact` operation, no new IPC channel, no new persistent store,
  no new service. Every change is inside modules that already own the behaviour:
  `blocklist.ts` (the descriptor snippet + two rules), `interact.ts` (`fillScript` +
  the single-fill return), `form-fields.ts` (the `readyState` gate + the projection).
- One new error code, `WRITE_NOT_APPLIED`, minted only via `HyppoError`
  (`src/main/errors.ts`) — consistent with the "one distinct code per failure" convention
  (no generic catch-all).
- The descriptor `name` change is a single edit to one shared snippet
  (`DESCRIPTOR_BODY` / `ACCESSIBLE_NAME_SOURCES_BODY`), consumed identically by `interact`
  and `read_form_fields`, so their verdicts still cannot diverge (feature 005 SC-004).

### IV. User-Held Credentials and Sessions — PASS

The read-back honours the existing credential-value omission (FR-007): for a
`credential-field` target `fill` checks that the field is non-empty / the expected length
and returns no value; `read_form_fields` still omits `currentValue` for that record. Nothing
is typed as a password, captured, or transmitted. The per-character type loop dispatches
key events in-page only.

### V. Assistive Pace, Not Bulk Collection — PASS

- Every path is `queue.run`-serialised — at most one page operation in flight app-wide.
- The type loop is one field's worth of synthetic key events in a single in-page pass, not
  a burst of network activity; pace is unchanged.
- No page content reaches the shared data directory. `read_form_fields` persists nothing.
- No new truncation is silent: `WRITE_NOT_APPLIED` names the lost write and carries the
  read-back value; the leaner record does not drop data that was verbatim page content
  (the removed fields are HyppoVisor-computed diagnostics).

### Architecture Constraints — PASS

`hyppovisor` gains no dependency on `hyppograph`. MCP stays the only session bridge. No
change to the shared data directory or provenance logging.

## Project Structure

### Documentation (this feature)

```text
specs/011-form-fill-fidelity/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions R1–R7
├── data-model.md        # Phase 1 — descriptor + fill-result + record deltas
├── quickstart.md        # Phase 1 — the captured Workable form as the acceptance run
├── contracts/
│   └── mcp-tools-011-delta.md   # Phase 1 — exact tool/param/field/error deltas
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
.specify/memory/
└── constitution.md            # US4 gate: Principle I gains the in-form-reveal clause;
                               #   version 1.3.2 → 1.4.0; Amendment History entry.
                               #   MUST be the first commit on the branch.

src/main/
├── errors.ts                  # + "WRITE_NOT_APPLIED"
├── config.ts                  # + domReadyTimeoutMs (1000) for the read_form_fields poll
├── safety/
│   └── blocklist.ts           # ACCESSIBLE_NAME_SOURCES_BODY / DESCRIPTOR_BODY: drop the
│                              #   own editable value from `name` for value-bearing
│                              #   controls; + `formAction` on TargetDescriptor; narrow
│                              #   the `in-form` rule; keep fillVerdictFor/clickVerdictFor
│                              #   pure (US2/US3/US4)
└── page/
    ├── interact.ts            # fillScript: per-character key-event pass + read-back;
    │                          #   single-fill path returns { currentValue }; throw
    │                          #   WRITE_NOT_APPLIED on a lost write; fillBatch maps it to
    │                          #   the per-entry `error` outcome (US1)
    └── form-fields.ts         # await readyState "complete" before verdicts; leaner
    │                          #   default record, extra fields behind
    │                          #   includeNonInteractive (US3/US5)

src/shared/
└── types.ts                   # TargetDescriptor + formAction; FormFieldRecord: the moved
                               #   fields become optional; FillResult (currentValue)

tests/
├── unit/
│   ├── blocklist.test.ts      # + `name` excludes own value for textarea/CE/text input,
│   │                          #   keeps it for button/submit; external-act parity before
│   │                          #   & after a draft; narrowed in-form matcher (button/
│   │                          #   type=button/no formaction permitted; submit, formaction,
│   │                          #   outward-label still refused)
│   ├── interact.test.ts       # + read-back comparator: separator normalise, prefix-short
│   │                          #   = truncation, exact match; per-character script shape
│   └── form-fields.test.ts    # + leaner projection; includeNonInteractive restores the
│   │                          #   diagnostic fields; readyState gate
├── integration/
│   ├── interaction.spec.ts    # + masked MM/YYYY & phone: value lands OR WRITE_NOT_APPLIED
│   │                          #   with currentValue; a drafted textarea re-fills (US2);
│   │                          #   verdict identical across 10 reads (US3); in-form
│   │                          #   type=button reveals a sub-form, submit still refused (US4)
│   ├── batch-fill.spec.ts     # + one masked entry → that entry `error`, the rest written
│   └── read-form-fields.spec.ts  # + default record shape; includeNonInteractive superset;
│                              #   unscoped ~60-control read within budget, no trim
└── fixtures/
    ├── masked.html            # NEW — an MM/YYYY input mask + a (###) ###-#### phone mask
    ├── form.html              # + a drafted-answer field whose value contains "apply"
    └── expander.html          # + an "Add Experience" <button type="button"> inside a <form>

specs/001-open-any-url/contracts/mcp-tools.md   # contract: fill read-back + WRITE_NOT_APPLIED;
                                                #   read_form_fields default vs verbose record;
                                                #   in-form carve-out wording
docs/safety.md                                  # the in-form carve-out + its four conditions
docs/design-notes.md                            # the "Allowed / Refused" table row for
                                                #   in-form click gains the carve-out note
README.md                                       # tool table `fill` note (read-back / masked);
                                                #   "what the app will not do" unchanged
```

**Structure Decision**: Single project, existing layout. The one-file-per-guarantee
convention holds: `WRITE_NOT_APPLIED` is minted only in `errors.ts`; the descriptor `name`
rule lives in the one shared snippet in `blocklist.ts`; the `in-form` decision is one rule
object. No module is added.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| **Constitution amendment 1.4.0** (Principle I gains an in-form-reveal clause) before the US4 code change | The captured form's repeatable sections ("Add Experience" / "Add Education") are unreachable by tooling — zero Experience rows could be added. The buttons are `type="button"` and submit nothing, but the current Principle I text refuses *any* in-form click. Decision 2026-08-31 (interpretation B1) is to permit the narrow case. | Keeping the blanket refusal: rejected by the user — the capability gap is real and recurring across ATS forms. Doing it as a normal PR without the amendment: rejected — Principle I changes are amendment-only by governance; the review gate must see one explicit, versioned clause, not a rule diff. |
| **`WRITE_NOT_APPLIED`** as a thrown error (not a soft `{ applied: false }`) on the single-fill path | A masked no-op is a condition the caller must handle before moving on; the session behind issue 005 trusted a soft `written: 1` and left three fields blank. A thrown, named code forces the caller to notice, and the batch path already converts a mid-write throw into a per-entry `error` outcome — so one mechanism covers both. | A soft success flag: rejected — it is the exact shape that failed in the field. A silent retry with real key events only: rejected — some masks still reject a well-formed value (a country-specific date order), and the caller still needs to know. |
