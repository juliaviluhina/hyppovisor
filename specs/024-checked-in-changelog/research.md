# Research: Checked-In Changelog for Future Releases

## Decision: Root `CHANGELOG.md` using Keep a Changelog headings

This is human-readable, reviewable in pull requests, and supports an `Unreleased` section.
Generated-only GitHub notes and PR-label automation cannot guarantee reviewed compatibility notes.

## Decision: Manual entries supplemented by generated GitHub notes

Compatibility and behavior notes need authorial review; GitHub metadata can still provide PR history.

## Decision: Repository-local Node verifier and extractor

Node is already required, pure functions are straightforward to test, and one helper can both
fail the release and produce the exact body fragment. Inline shell parsing is harder to test.

## Decision: No historical backfill

The changelog starts with `Unreleased`; feature 018's note is recorded as a future-release note.
A versioned entry is required only when a release is cut.
