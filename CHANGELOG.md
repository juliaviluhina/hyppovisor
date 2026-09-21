# Changelog

All notable changes to HyppoVisor are documented here. This file follows the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) convention.

## [Unreleased]

<!-- Move reviewed Unreleased notes into a dated version heading when releasing. -->

## [0.6.0] - 2026-09-21

### Added

- `read_actionable` MCP tool: one read-only call returns a tab's actionable
  elements as an indexed table plus its meaningful visible text, with omission
  counts and explicit truncation instead of silent cuts.
- `read_actionable` accepts a `goal` for Jev relevance ordering over the table
  (needs the user's `TYPESAFE_API_KEY`); a missing key or failed request
  returns the unranked snapshot with an explicit ranking status, never an
  error. Snapshot indices address `interact` targets with stale rejection;
  every refusal still applies unchanged.
- Every instance-list row offers copy of that instance's MCP connection
  settings — the same `claude mcp add` command and JSON config block as the
  Connection panel, parameterized per instance — so an agent can be connected
  to a `--background` instance without digging through profile files.
  Unreachable rows offer marked last-known settings; unreadable rows offer no
  copy rather than guessed values. Copying changes nothing on any instance.
- `TYPESAFE_API_KEY` environment configuration for Jev ranking; the key is
  never logged or persisted.

### Changed

- The MCP tool surface grows from eight to nine tools (docs, panel About
  text, and skill list updated accordingly).

## [0.5.2] - 2026-09-09

### Changed

- Reissued the release with the complete post-`0.5.0` changelog, including
  async selector readiness and the configurable blocked-domain policy.

## [0.5.1] - 2026-09-09

### Added

- User-configurable blocked domains, with subdomain-inclusive matching across
  MCP navigation, redirects, and popups.
- Connection-panel controls and the `HYPPO_BLOCKED_DOMAINS` environment
  override for the per-instance navigation policy.
- Metadata-only audit records for blocked navigation attempts.
- `read_page` can optionally wait for a positive selector to appear before
  collecting scoped content, with a bounded timeout and explicit timeout error.

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
