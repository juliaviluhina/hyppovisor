# Quickstart: Validating Read Page Selector Scoping

Validates the feature end-to-end using the offline fixture already committed for this purpose
(`tests/fixtures/chat-shell-repro.html`, from `specs/issues/007-read-page-selector-scoping.md`).
No third-party site or login needed.

## Prerequisites

- Repo built (`npm run build`) or dev-run capable (`npm start`).
- The fixture server the integration tests already use (`tests/integration/helpers.ts`'s
  `startFixtureServer`), or simply `open_url` the local file directly for a manual check.

## Automated validation (primary)

```sh
npx playwright test tests/integration/read-page.spec.ts
npx vitest run tests/unit/read-page-selector.test.ts
```

Expected: all pass, covering (see contracts/read-page-selector.md and spec.md acceptance
scenarios):

- Unscoped `read_page` on the fixture returns the full page (chat log + detail pane) —
  byte-for-byte what today's `read_page` already returns (US2).
- `read_page({ tabId, selector: "#detail-pane" })` returns only `"Turn N"`, regardless of how
  many times `#advance` was clicked beforehand — the chat-log prefix never appears (US1).
- `read_page({ tabId, selector: "#detail-pane", includeDom: true })` returns `dom` limited to
  `#detail-pane`'s own subtree, not the full document (US1 scenario 5, research.md R4).
- A scoped result carries `scopedTo: "#detail-pane"`; an unscoped result carries no `scopedTo`
  field (US3).
- An invalid selector (e.g. `"???"`) rejects `INVALID_SELECTOR`; a valid selector matching
  nothing (e.g. `"#does-not-exist"`) rejects `TARGET_NOT_FOUND` (US1 scenarios 3–4).

## Manual validation (matches the source issue's repro steps)

1. `open_url` the fixture: `tests/fixtures/chat-shell-repro.html`.
2. `read_page({ tabId })` (no selector) → text includes `"Chat line 1"` + `"Turn 1"`.
3. `interact` click `#advance` a few times.
4. `read_page({ tabId })` (still no selector) → text now includes every chat line so far +
   the latest `"Turn N"` — unchanged from today's behavior (confirms FR-002).
5. `read_page({ tabId, selector: "#detail-pane" })` → text is **only** `"Turn N"`, and the
   result includes `scopedTo: "#detail-pane"` — confirms SC-001 (constant-size scoped read
   regardless of chat-log growth) and SC-003 (self-describing result).
6. `read_page({ tabId, selector: "#does-not-exist" })` → rejects `TARGET_NOT_FOUND`.
7. `read_page({ tabId, selector: "???" })` → rejects `INVALID_SELECTOR`.

## Out of scope for this validation

DOM noise-reduction (`specs/issues/008-read-page-dom-noise-reduction.md`) is a separate,
deferred feature — not exercised here.
