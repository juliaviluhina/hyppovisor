# Changelog

All notable changes to HyppoVisor are documented here. This file follows the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) convention.

## [Unreleased]

<!-- Move reviewed Unreleased notes into a dated version heading when releasing. -->

## [0.5.0] - 2026-09-05

### Added

- `read_page` accepts `selector` to scope a read to one element — both the
  text and (when requested) the DOM output narrow to that element's subtree.
- `read_page` accepts `ancestorLevels` to escalate a scoped read to an
  ancestor of the matched element, and `exclude` to drop selected
  descendants from the result.
- `reduceDom` strips non-content noise (scripts, styles, hidden/`aria-hidden`
  nodes, decorative icons) from DOM output, including when the selected
  element itself matches a noise rule.

### Changed

- `reduceDom` is enabled by default for page reads. Set `reduceDom: false` to
  opt out and receive verbatim page content.
- DOM reduction work is now skipped entirely when DOM output isn't requested,
  avoiding unnecessary cost on text-only reads.
- Navigation that happens after a tab's initial entry is now checked against
  the same URL policy as the entry navigation itself (via `will-navigate` /
  `will-redirect`), closing a gap that let post-load redirects and script
  navigations bypass the policy. Synced tab URLs are no longer duplicated.
- Lifecycle failures are now classified as recoverable operational failures
  or invariant failures; invariant failures degrade the app to a visible
  degraded state instead of crashing it outright.

### Security

- The local MCP HTTP endpoint now requires a bearer token by default —
  previously it accepted unauthenticated local connections.
- Renderer windows (including tab views) run with Electron's `sandbox: true`.
- Profile and token storage now enforces restrictive file permissions
  (`0o600` for token files, `0o700` for profile directories) with the policy
  documented in `docs/security.md`.

### Process

- Release changelog entries are now verified in CI: the release workflow
  fails before building if the current version's `CHANGELOG.md` entry is
  missing, duplicated, or empty, and publishes that entry alongside GitHub's
  generated release notes.
