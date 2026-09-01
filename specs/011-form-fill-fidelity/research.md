# Phase 0 Research: Form-Fill Fidelity

All Technical Context items resolved. No open NEEDS CLARIFICATION.

---

## R1 — Why a well-formed `fill` lands `written: 1` but the field stays empty

**Decision**: Drive the value with a per-character key-event pass, then read the value
back inside the same call and throw `WRITE_NOT_APPLIED` if it did not land.

**Rationale**: `fillScript` (`src/main/page/interact.ts:78`) sets the value in one shot
through the native property setter and dispatches `input` / `change` / `blur`. Input-mask
libraries (iMask, Cleave.js, `react-input-mask`, `cleave-zen`, Workable's own field
formatters) build their formatted value from `beforeinput` / `keydown` / `keypress`
sequences and treat a bulk programmatic `.value` write as noise — they either ignore it or
reformat it to empty on the next tick. The result is `written: 1` with an empty field
(issue 005 finding 2). The fix has two parts:

- **Type character by character.** For a non-`contentEditable` text control, loop over the
  intended string: per character dispatch `keydown`, `beforeinput` (with `inputType:
  "insertText"`, `data: ch`), advance the value via the native setter (`prev + ch`),
  dispatch `input`, then `keyup`. End with `change` + `blur` as today. Dispatching
  synthetic `KeyboardEvent`s in-page is already the established pattern
  (`choose-option.ts:336` fires `keydown`/`keyup` to open and navigate a combobox); the
  new part is a per-character *text* sequence. The loop stays in-page so it is one
  `executeJavaScript` round-trip.
- **Read back and compare.** After the loop, evaluate `el.value` (or `el.innerText` for
  `contentEditable`) and compare with the intended value under R2's rules. A mismatch
  throws `WRITE_NOT_APPLIED` carrying `{ currentValue }`; a match returns `{ currentValue }`
  (the post-format string).

**Alternatives considered**:
- *Keep the bulk set, just add the read-back.* Rejected — it would report `WRITE_NOT_APPLIED`
  for every masked field instead of populating the ones that a keystroke sequence would
  fill. The type loop is what makes masked dates / phones actually work.
- *Use CDP `Input.insertText` / `Input.dispatchKeyEvent`.* Rejected — needs a
  `WebContents.debugger` attach (feature 008 took that route only for full-page screenshot
  and flagged it as complexity). Synthetic DOM key events reach every mask library in
  practice and keep the change inside the existing `executeJavaScript` model.
- *Per-character with a real delay between keys.* Rejected for v1 — adds wall-clock cost and
  a tunable; no observed mask needs it. Left as a follow-up if a specific site regresses.

---

## R2 — What counts as "the value did not land"

**Decision**: After the write, the field is **not landed** when its value is empty, is
byte-identical to the pre-write value, or is a strict prefix of the intended value shorter
than it. Formatter-inserted separators are normalised out before the comparison.

**Rationale**: A mask reformats `091992` to `09/1992` — that is success, not a mismatch. So
the comparator strips a fixed separator set (`/ - . space ( ) :`) from *both* the intended
and the read-back string, then:
- equal after normalisation → success, return the raw read-back (`09/1992`);
- read-back empty or unchanged from before → `WRITE_NOT_APPLIED`;
- normalised read-back is a proper prefix of the normalised intended value → the mask
  truncated it → `WRITE_NOT_APPLIED` with the partial value shown;
- any other difference (mask rejected some characters, transformed case, reordered) →
  `WRITE_NOT_APPLIED` with the read-back shown.

**Alternatives considered**:
- *Exact string equality.* Rejected — every reformatting mask would report failure.
- *Levenshtein / fuzzy threshold.* Rejected — that is judgement (Principle II) and would
  mask real truncation. Separator normalisation + prefix check is mechanical and covers the
  observed cases.

---

## R3 — Why `external-act-label` refuses a plain field on every call after the first

**Decision**: Stop folding a value-bearing control's own editable text into the descriptor
`name`. Keep `el.value` in `name` only for `<button>` and `<input type=submit|button|
reset|image>`, where it is the caption.

**Rationale**: `DESCRIPTOR_BODY` (`src/main/safety/blocklist.ts:334`) builds `name` from
`el.innerText`, `el.value`, the ARIA / `<label>` sources, and a `el.textContent` fallback.
For a `<textarea>`, `el.innerText` is the textarea's *content*; for a text `<input>`,
`el.value` is the current value. Once the agent drafts an answer, that answer is in `name`.
`EXTERNAL_ACT_WORDS` includes very common substrings — `apply`, `join`, `post`, `order`,
`send`, `save`, `continue`, `pay`, `buy`, `register`, `accept` — so a drafted sentence like
"…I applied what I learned…" or "…helped the team continue…" makes `external-act-label`
(`appliesTo: "both"`) match, and every later `fill` on that selector is
`REFUSED_EXTERNAL_ACT`. This is issue 005 findings 3 **and** 4: the "misfire" and the
"stale / state-dependent verdict" are the same bug. `#CA_42882` ("Do you have startup
experience?") has an innocuous own label; the refusal came from the answer text.

Implementation: split the accessible-name assembly so the label sources
(`ACCESSIBLE_NAME_SOURCES_BODY`) are always included, and the *own-content* parts
(`el.innerText`, `el.value`, the `el.textContent` fallback) are included only when the
element is not a value-bearing control — i.e. skip them for `<textarea>`, `isContentEditable`,
and `<input>` whose type is in `SAFE_FILL_TYPES` or is a bare text input. A `<button>` /
submit input keeps `el.value` and text, because that *is* its label and `submit-control` /
`external-act-label` must still catch "Apply".

The `id` / `name` attribute is already **not** matched (issue 005's `CA_`-pattern
hypothesis does not hold against the code) — no change needed there, FR-010 is already
satisfied; a unit test locks it in.

**Alternatives considered**:
- *Strip known trigger words from the drafted value before matching.* Rejected — brittle and
  still couples the verdict to content.
- *Cache the first verdict per selector and reuse it.* Rejected — a real page change (a
  script turning a div into a submit control) must still be able to flip the verdict
  (US3 acceptance scenario 3); caching hides that.
- *Only exclude `el.innerText` for `<textarea>`, keep `el.value` everywhere.* Rejected — a
  text `<input>`'s drafted value hits the same words; both parts must go for value-bearing
  controls.

---

## R4 — Making the verdict a pure function of the settled DOM (US3)

**Decision**: R3's descriptor fix removes the content-coupling — it is the primary fix.
Additionally, `read_form_fields` polls `document.readyState === "complete"` (bounded, up to
`config.domReadyTimeoutMs`, default 1000 ms, then proceeds anyway) before it collects, so a
verdict is not computed against a still-parsing document.

**Rationale**: With the own-value excluded from `name`, two reads of the same selector on
an unchanged DOM produce an identical descriptor and therefore an identical verdict — the
verdicts are already pure functions of the descriptor (`fillVerdictFor` /
`clickVerdictFor`, `blocklist.ts:253`/`:270`). That alone fixes the reported case
(a filled field that then refuses). The residual risk is a read fired against a document
still being parsed by late `<script>`s. Neither `read_page` (`src/main/page/read.ts`) nor
`read_form_fields` gates on readiness today — they `executeJavaScript` immediately. Adding
a small bounded `readyState` poll to `read_form_fields` (only — `read_page`'s verbatim text
is not verdict-bearing and stays as is) closes that latent flake without a new tunable
class: one `config` value, one in-page `await`. A genuine post-hydration change
(scenario 3) still flips the verdict because it is a real descriptor difference.

**Alternatives considered**:
- *A MutationObserver quiet-period wait.* Rejected as heavier than the problem — a
  `readyState` poll is deterministic and enough for the captured case.
- *Do nothing beyond R3.* Rejected — R3 fixes the reported symptom, but a verdict computed
  mid-parse is still a latent flake; the bounded poll closes it for a few lines.
- *Add the poll to `read_page` too.* Rejected — `read_page` returns verbatim visible text,
  not a policy verdict; changing its timing risks the Principle V "return what is rendered"
  contract for no US3 benefit.

---

## R5 — Narrowing the `in-form` rule for a non-submit reveal button (US4)

**Decision**: `in-form` matches `d.hasFormAncestor && !(d.tagName === "button" && d.type ===
"button" && d.formAction === null)`. `TargetDescriptor` gains `formAction: string | null`
(from `el.getAttribute("formaction")`, lowercased). No other rule changes.

**Rationale**: Rule order in `BLOCKLIST_RULES` is `submit-control`, `consent-toggle`,
`external-act-label`, `credential-field`, `in-form`. By the time evaluation reaches
`in-form`:
- a bare `<button>` (no `type`) or `<button type="submit">` / `<input type=submit|image>`
  is already refused by `submit-control` — so "implicit submit control" needs no extra
  check here;
- an outward-labelled button ("Save", "Apply", "Continue") is already refused by
  `external-act-label` (`appliesTo: "both"`).

So the only thing `in-form` still needs to let through is a `<button type="button">` that
declares no `formaction`. `formaction` on a `type="button"` is inert per the HTML spec, but
checking it is a cheap belt-and-braces guard and makes the rule read correctly on its own.
A permitted in-form click already flows through `interact()`'s existing
`log.record(outcome: "permitted")` (`interact.ts:435`) — FR-015's audit requirement needs
no new code.

**Gate**: the rule change MUST NOT merge before the constitution amendment (R7). The
`in-form` rule's `description` string and `docs/safety.md` are updated in the same change.

**Alternatives considered**:
- *A new `in-form-reveal` allow rule instead of narrowing `in-form`.* Rejected — adds a
  rule id for a carve-out that is naturally expressed as an exception to the existing one;
  the audit log is clearer with one `in-form` id.
- *Require a sibling submit control to exist (interpretation B2).* Rejected by the spec
  clarification (B1 chosen) — a fragile heuristic, and a multi-step form legitimately has
  no submit on the current step.
- *Gate the click behind an `interact` opt-in flag.* Considered (spec option C); not chosen
  — the four structural conditions are a tight enough boundary and an extra flag grows the
  tool surface for no safety gain.

---

## R6 — The leaner default form-read record (US5)

**Decision**: `selectorSynthesised`, `duplicateId`, `optionsTruncated`, and
`optionsAvailable` become optional on `FormFieldRecord` and are emitted only when
`includeNonInteractive: true`. `options` is emitted in the default record only for a
dropdown kind (`select` / `combobox` / `listbox`); for every other kind it is `[]` today
and is simply omitted. The default record keeps `selector`, `kind`, `type`, `label`,
`required`, `group`, `inFormAncestor`, `visible`, `currentValue` (credential omitted),
`operation`, `fillVerdict`, `clickVerdict`, `chooseVerdict`.

**Rationale**: On the captured ~60-control form the unscoped default response still spilled
the MCP token budget (issue 005 P5) even after feature 008's 64 KB trim, forcing the client
to persist and re-parse it. Per record the four removed fields are ~60–90 bytes of JSON;
across 60 controls that is ~4–5 KB, and dropping empty `options` arrays from ~50 non-dropdown
records removes another chunk — enough to clear the budget without trimming records. The
removed fields are HyppoVisor-computed diagnostics (was the selector synthesised, is the
`id` duplicated, was the option list capped) that an agent needs only when a selector
misbehaves — exactly when it would pass `includeNonInteractive` anyway. Callers that pass
`fields` or `only` already get a scoped response and see no change (FR-024).

**Alternatives considered**:
- *Make `only: "required-unfilled"` the implicit default when no projection is given.*
  Rejected in the spec clarification — it changes the response *scope* for every existing
  unscoped caller, which is surprising. Lowering the per-record payload keeps "every
  control is represented" true.
- *A dedicated `verbose: true` param.* Considered; `includeNonInteractive` already means
  "give me the extra, non-planning stuff", so reusing it avoids a second toggle. The
  contract delta documents that `includeNonInteractive` now also restores the diagnostic
  fields.

---

## R7 — Constitution amendment 1.4.0 (US4 gate)

**Decision**: Add one clause to Principle I and bump 1.3.2 → **1.4.0 (MINOR)**. The
amendment commit is the first change on the implementation branch; `/speckit-tasks` orders
it as task 1 with the `in-form` code change depending on it.

**Proposed clause** (wording to be finalised in the amendment PR), appended to the
Principle I bullet list:

> Revealing an already-in-page repeatable sub-form by clicking a non-submit control —
> a `<button type="button">` inside a `<form>` that declares no `formaction`, is not the
> form's implicit submit control, and whose own accessible name reads as no outward action
> — is preparation: it exposes fields the human will review, and it cannot submit, send, or
> navigate. Every submit control, `formaction` button, implicit submit, consent toggle, and
> outward-labelled control inside a form stays refused for every operation, and no operation
> may press Enter.

**Rationale**: Matches the precedent set by 1.2.0 ("value entry is preparation") and 1.3.0
("choosing an option is preparation") — a binding clarification that *expands* Principle I's
existing "preparing drafts" scope, redefines no principle, and invalidates no conforming
spec or code. MINOR per the versioning policy ("a new … section is added, or existing
guidance is materially expanded"). The Amendment History entry follows the one/two-line
convention and cites this feature plus
`specs/issues/005-form-fill-second-workable-session.md`.

**Alternatives considered**:
- *PATCH bump.* Rejected — this blesses a new (if narrow) permitted action, which is more
  than "wording / non-semantic refinement".
- *Fold the amendment into the same commit as the rule change.* Rejected — the governance
  gate wants the amendment reviewable on its own; separate first commit, same PR.
