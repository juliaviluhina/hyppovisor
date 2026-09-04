# Phase 0 Research: Read Page Selector Scoping

No `NEEDS CLARIFICATION` markers remain in the Technical Context — this feature is a narrow
extension of an existing, already-shipped pattern (`read_form_fields`'s `containerSelector`),
so research here is about *which existing decision to reuse*, not new technology choices.

## R1 — Selector resolution and invalid-CSS detection

**Decision**: Reuse `src/main/page/selector-syntax.ts` (`SELECTOR_SYNTAX_HELPER`,
`__querySafe`, `assertSelectorValid`, `isInvalidSelectorMarker`) exactly as
`form-fields.ts` does, rather than writing a second detector.

**Rationale**: This module was built specifically to be "one enforcer for the
`INVALID_SELECTOR` guarantee" (its own header comment) across every injected script that
resolves a caller-supplied selector. `read_page` resolving a selector is precisely the case
it was generalized for. Reusing it means: the same `SyntaxError` → `{ __invalidSelector: true
}` → `INVALID_SELECTOR` HyppoError path, the same fixed error message pointing callers at
`read_form_fields` / `read_page` for a concrete selector, and zero new detection code.

**Alternatives considered**: Writing a `read.ts`-local try/catch around
`document.querySelector`. Rejected — would duplicate `selector-syntax.ts`'s exact logic,
diverge in error message wording, and violate Principle III's "prefer the smallest mechanism"
guidance now that a shared enforcer already exists.

## R2 — Error code for "valid selector, no match"

**Decision**: Reuse the existing `TARGET_NOT_FOUND` error code (already in
`src/main/errors.ts`'s `ErrorCode` union, already used by `read_form_fields` for exactly this
case — "No element matches container selector ...").

**Rationale**: `read_form_fields` already resolved this exact question for the sibling read
tool: a *valid* selector that matches nothing is not the same failure as a *syntactically
invalid* one (`selector-syntax.ts`'s own comment: "A valid selector that simply matches
nothing is untouched — the caller still gets `TARGET_NOT_FOUND`"). No new error code needed;
introducing one (e.g. a `read_page`-specific `SELECTOR_NOT_FOUND`) would fragment an already
zero-error-code-surprise contract for no behavioral gain.

**Alternatives considered**: A new `read_page`-specific code. Rejected — inconsistent with the
sibling tool's contract for the identical failure shape, and the source issue explicitly
frames this feature as "mirroring `read_form_fields`'s `containerSelector`."

## R3 — First-match-of-many convention

**Decision**: When `selector` matches multiple elements, use the first match
(`document.querySelector`, not `querySelectorAll`), same as `read_form_fields`'s
`containerSelector`.

**Rationale**: Consistency with the existing sibling convention (spec Assumptions,
carried from the source issue). A caller wanting a different match already has the tool to
get a more specific selector: an unscoped or previously-scoped read exposes enough structure
to write a narrower `#id` / `[name="…"]` selector, same guidance `selector-syntax.ts`'s error
message already gives.

**Alternatives considered**: Erroring on ambiguous (multi-match) selectors. Rejected — adds a
new failure mode with no precedent in the sibling tool, and the spec's clarification-free
Assumptions section already settled on first-match for consistency.

## R4 — Scoping the optional DOM output consistently with text

**Decision** (from spec Clarifications, session 2026-09-04): when `selector` is supplied
together with `includeDom`, the returned `dom` field is the matched element's own
`outerHTML`, not `document.documentElement.outerHTML`.

**Rationale**: A scoped read that still returns the full-page DOM would silently reintroduce
the exact waste (unbounded, already-seen shell content) the feature exists to eliminate —
`includeDom` on a scoped read would leak the whole page back in through the one input this
feature didn't narrow. Scoping needs to be a property of "this read," not "this read's text
field only," for the `scopedTo` self-description guarantee (FR-006) to mean what it says.

**Alternatives considered**: Leaving `dom` full-page regardless of `selector` (spec's Option
B during clarification). Rejected by the user during `/speckit-clarify` — chosen consistency
(Option A) over leaving an inconsistent, easy-to-misuse combination in the contract.

## R5 — Truncation and byte-budget machinery

**Decision**: Reuse `truncate.ts`'s `truncateToBytes` unchanged, applied to the (now possibly
narrower) `text` and `dom` strings, with the same `config.maxTextBytes` / `config.maxDomBytes`
limits and the same `truncated: { text, dom }` result shape.

**Rationale**: The source issue explicitly scopes truncation-relevance-awareness (rough edge
3) as out of scope; this feature only changes *what string* is fed into the existing
truncation call, not the truncation policy itself. No new config, no new field.

**Alternatives considered**: A smaller byte budget for scoped reads, reasoning that a scoped
read is already "the interesting part" and should get more headroom before truncating.
Rejected — out of scope per the issue, and would be a policy decision better made later if
real-world scoped-read truncation turns out to matter; today's byte budgets already comfortably
exceed nearly all single-element subtrees.
