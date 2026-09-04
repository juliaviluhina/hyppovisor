# Quickstart: Read Page Reduction Hardening

Validates the four fixes end-to-end against a running HyppoVisor instance. Prerequisites and
harness match feature 017's own quickstart — reuse the same fixture server and Electron E2E
handle.

## Prerequisites

- Repo built (`npm run build`) or running under `npm run test:e2e` (Playwright launches the
  app itself).
- `tests/fixtures/dom-noise-repro.html` served locally (the existing `startFixtureServer()`
  helper in `tests/integration/helpers.ts` does this automatically for the integration spec).

## Automated validation (primary path)

```bash
npm test          # vitest — any unit-level coverage added for __reduceDom's root check
npm run test:e2e  # playwright — tests/integration/read-page.spec.ts, extended per FR-003–FR-008
```

Expected: all cases in `read-page.spec.ts` pass, including the new ones for:

- FR-005: a `selector` resolving directly to `<script>`, `<style>`, and a decorative
  `<svg aria-hidden="true">` each return `dom: ""` under default reduction.
- FR-003/FR-004: scoped and unscoped reduced reads strip script/style/comment nodes that are
  genuinely inside the read subtree (not just outside it, as the pre-018 fixture allowed).
- FR-006: a full attribute-set diff (not just `aria-roledescription`) confirms non-`class`/
  `style` attributes survive reduction unchanged.
- FR-007: a live page-side marker is unaffected after a reduced read (proves the clone, not
  the live DOM, was mutated).
- FR-008: DOM truncation (`config.maxDomBytes`) still applies to reduced output.

## Manual / exploratory validation

1. Launch the app (`npm start`), open a tab to a page containing a top-level `<script>` (or
   use `tests/fixtures/dom-noise-repro.html` served locally).
2. Via the MCP `read_page` tool (or the `HYPPO_E2E=1` test handle,
   `globalThis.__hyppo.read(tabId, true, "script")`), confirm the returned `dom` is `""` and
   `domReduced` is `true` — this reproduces issue 010's repro case and should now pass.
3. Call `read_page({ tabId })` (no `includeDom`) against a page with a large DOM; confirm
   `text` is returned unchanged and (informally) that the call is not slower with
   `reduceDom: true` than with `reduceDom: false` — SC-003.

## Release note check (FR-011)

Before merging, confirm the PR description names the `reduceDom` default-on behavior and its
`reduceDom: false` opt-out (per the `pr-description` skill's "Notable decisions" section) — no
separate file to update; GitHub compiles release notes from PR titles at tag time
(`.github/workflows/release.yml`, `generate_release_notes: true`).

## Out of scope for this quickstart

- Selector scoping itself (issue 007/016) — unchanged, not re-validated here.
- Ancestor escalation (issue 009) — separate, not-yet-designed feature.
