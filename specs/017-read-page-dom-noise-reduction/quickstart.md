# Quickstart: Validating Read Page DOM Noise Reduction

Validates the feature end-to-end using the offline fixture already committed for this purpose
(`tests/fixtures/dom-noise-repro.html`, from `specs/issues/008-read-page-dom-noise-reduction.md`).
No third-party site or login needed.

## Prerequisites

- Repo built (`npm run build`) or dev-run capable (`npm start`).
- The fixture server the integration tests already use (`tests/integration/helpers.ts`'s
  `startFixtureServer`), or simply `open_url` the local file directly for a manual check.

## Automated validation (primary)

```sh
npx playwright test tests/integration/read-page.spec.ts
npx vitest run tests/unit/read-page-noise-reduction.test.ts
```

Expected: all pass, covering (see contracts/read-page-noise-reduction.md and spec.md acceptance
scenarios):

- `read_page({ tabId, selector: "#job-list", includeDom: true })` (reduction on by default)
  returns `dom` with no `<script>`, no `<style>`, no HTML comment, no `class`/`style`
  attribute, and no decorative (`aria-hidden="true"`) icon `<svg>` — while every card's title
  and company text, and the one accessible badge icon (`role="img"` + `aria-label`), are still
  present in the markup (US1, FR-011).
- The same call's result includes `domReduced: true` (US3).
- `read_page({ tabId, selector: "#job-list", includeDom: true })`'s reduced `dom` is at least
  50% smaller by byte size than the same call with `reduceDom: false` (SC-001), matching the
  proportions measured against the real page in the source issue.
- `read_page({ tabId, selector: "#job-list", includeDom: true, reduceDom: false })` returns
  `dom` byte-for-byte identical to this feature's pre-existing (016-era) `includeDom: true`
  output, and the result has no `domReduced` field (US2).
- `read_page({ tabId })` (no `includeDom` at all) is entirely unaffected by `reduceDom` —
  `text` and all other fields unchanged (US2, FR-002 for the no-DOM case).

## Manual validation (matches the source issue's repro steps)

1. `open_url` the fixture: `tests/fixtures/dom-noise-repro.html`.
2. `read_page({ tabId, selector: "#job-list", includeDom: true, reduceDom: false })` → note the
   `dom` byte length; confirm it contains `<script>`, `<style>`, the HTML comment, and several
   `class="..."` attributes.
3. `read_page({ tabId, selector: "#job-list", includeDom: true })` (reduction on by default) →
   confirm the returned `dom` excludes all of the above, is meaningfully smaller than step 2's
   result, still contains `"Example Role One"`, `"Example Co"`, and the other two cards' text,
   and the result includes `domReduced: true`.
4. Compare the two byte sizes — confirms SC-001 (≥50% smaller) using the same measurement
   method the source issue used against the real page.
5. `read_page({ tabId })` (no `includeDom`) → confirm the result has no `dom` and no
   `domReduced` field regardless of `reduceDom`'s value, and `text` is unaffected — confirms
   this feature does not touch the plain-text output path.

## Out of scope for this validation

Ancestor-level widening and subtree exclusion (`specs/issues/009-read-page-ancestor-escalation.md`)
is a separate, deferred idea — not exercised here.
