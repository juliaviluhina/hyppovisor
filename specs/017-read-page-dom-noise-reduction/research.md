# Phase 0 Research: Read Page DOM Noise Reduction

No `NEEDS CLARIFICATION` markers remain in `plan.md`'s Technical Context — both spec-level
ambiguities (default on/off, strip-list scope) were resolved during `/speckit-specify`. This
phase records the implementation-level decisions needed before Phase 1 design.

## R1: Where does stripping happen?

**Decision**: Inside the same isolated-world in-page script `readPageScript()` already builds,
immediately before `outerHTML` is read — not as a post-processing step on the returned string in
the main process.

**Rationale**: `outerHTML` serialization is the only place that already has a live DOM
reference. Stripping nodes/attributes on the live `Element` (or a detached clone of it) before
calling `.outerHTML` is a single, cheap traversal using native DOM APIs
(`querySelectorAll("script, style"), .remove()`, `removeAttribute("class")`,
`removeAttribute("style")`, and a `TreeWalker`/`NodeFilter.SHOW_COMMENT` pass for comments).
Doing it as string post-processing on serialized HTML in the main process would require an HTML
parser dependency (violates "no new dependency," Principle III's smallest-mechanism guidance)
and would be strictly harder to keep correct (regex-based HTML mutation is exactly the kind of
fragile mechanism the constitution's "smallest mechanism that works" language warns against).

**Alternatives considered**:
- Post-process the serialized HTML string with a regex or lightweight parser in the main
  process — rejected: adds a dependency or a fragile regex, for no benefit over operating on
  the live DOM the script already has.
- Strip on a live, attached element (mutating the page itself) — rejected: would visibly alter
  the page the human is looking at, which no existing read operation does and Principle I's
  "read-only" framing for permitted actions doesn't cover. Must operate on a detached clone
  (`element.cloneNode(true)`) instead, exactly as considered in R2.

## R2: Mutating the real page vs. a clone

**Decision**: `element.cloneNode(true)` (or `document.documentElement.cloneNode(true)` for the
unscoped, whole-page case) before removing anything, then serialize the clone's `outerHTML`.
The live page is never mutated.

**Rationale**: `read_page` — scoped or not — is documented and constitutionally framed as a
read-only operation; any script/style/attribute removal must be invisible to the actual
rendered page. Cloning before mutating additionally means reduction composes cleanly with the
existing `selector` (016) flow, which already resolves an element (or `document.documentElement`
when unscoped) before reading — the clone-and-strip step just wraps whatever element was
already about to be serialized.

**Alternatives considered**:
- Mutate then immediately restore (remove, read `outerHTML`, re-append) — rejected: same net
  effect as cloning but with a window where the live page is actually altered (a concurrent
  read, a screenshot, or a human glancing at the screen mid-script could observe the mutated
  state); `cloneNode` has no such window and is the standard technique.

## R3: Comment removal mechanism

**Decision**: `document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT)`, collecting matched
comment nodes into an array first, then removing each (`.remove()` after the walk completes —
removing during iteration can skip siblings).

**Rationale**: `TreeWalker` with `SHOW_COMMENT` is the standard, dependency-free way to find
comment nodes in a subtree; no other native API enumerates comments directly.

**Alternatives considered**: None materially different — this is the only practical browser-
native approach.

## R4: Reduction indicator field naming

**Decision**: `domReduced?: boolean` on `PageReadResult`, present (and `true`) only when
reduction was actually applied to the returned `dom`; absent when `dom` was not requested at
all or when reduction was opted out. Mirrors 016's `scopedTo?: string` pattern (present only
when relevant, never present-and-`false`).

**Rationale**: FR-007/FR-008 require the result to self-describe whether reduction applied,
without requiring the caller to know the request's own parameters to interpret the response.
An optional boolean, present only on the `true` case, keeps the field absent-by-default for any
result where reduction isn't relevant (no DOM requested at all) — consistent with how
`scopedTo` is absent, not `undefined`-valued, for unscoped reads.

**Alternatives considered**:
- Always include `domReduced: false` when DOM was requested without reduction — rejected:
  inconsistent with `scopedTo`'s established absent-when-inapplicable convention in this same
  result type, and adds a field callers must special-case rather than simply check for presence.

## R5: Opt-out input naming and default

**Decision**: New `read_page` input `reduceDom?: boolean`, default `true` (Clarifications:
reduction is on by default). Passing `reduceDom: false` reproduces today's pre-feature-017
`includeDom: true` output byte-for-byte (User Story 2 / FR-002).

**Rationale**: Naming it as an explicit "reduce" toggle (rather than e.g. `raw` or `full`)
keeps the parameter symmetric with the behavior it controls, and keeps the default's meaning
readable at the call site: `reduceDom: true` (or omitted) is the common case: `includeDom: true`
alone; `reduceDom: false` is the deliberate opt-out for verbatim DOM.

**Alternatives considered**:
- `raw: boolean` (default `false`) — semantically inverted phrasing of the same toggle;
  rejected only for readability — `reduceDom: false` reads more directly as "don't reduce" than
  `raw: true` reads as "give me the unreduced version," and keeps naming consistent with the
  `scopedTo`/`domReduced` result-field naming already chosen.

## R6: Interaction with `selector` (feature 016)

**Decision**: No new code path — `readPageScript()` already resolves the subtree to serialize
(either `document.documentElement`/`document.body` unscoped, or the selector match) before this
feature's reduction step runs. Reduction operates on whatever subtree was already selected,
independent of how it was selected. `readPage()`'s signature gains one new parameter
(`reduceDom`) alongside the existing `selector` parameter; the two compose with no special-case
logic between them, matching FR-009's independence requirement and Edge Cases' explicit note.

**Rationale**: Confirms the plan's "no change to `selector-syntax.ts`" claim — selector
resolution and DOM reduction are genuinely orthogonal steps in the same script, in that order
(resolve subtree, then optionally reduce it, then serialize).

**Alternatives considered**: None — this is a direct consequence of R1/R2's design, not an
independent choice.
