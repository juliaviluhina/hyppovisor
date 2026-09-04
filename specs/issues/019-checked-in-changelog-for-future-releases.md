# Issue: keep a checked-in changelog for future releases

**Filed**: 2026-09-04
**Component**: Release documentation and `.github/workflows/release.yml`
**Severity**: Low — release-process clarity / maintainability.
**Status**: Deferred — revisit after feature development is complete; no release behavior changes
are part of the current feature branch.

## The request

Use a repository changelog file for future releases so release history and notable compatibility
changes are reviewable in the branch, before GitHub generates the final release notes.

In particular, the `reduceDom` default-on behavior and the `reduceDom: false` verbatim opt-out
should be recorded in the changelog when this feature is ready to ship. The current branch is
still under feature development, so this issue deliberately does not add or backfill a release
entry yet.

## Follow-up shape

- Decide on the changelog filename and format (for example, `CHANGELOG.md` with Keep a Changelog
  sections).
- Define whether entries are maintained manually, generated from PR metadata, or both.
- Update the release workflow to include the checked-in changelog entry in published releases.
- Add a release-process test that prevents a release from omitting the current version's entry.
- At completion of feature 018, add its final user-visible compatibility note to the selected
  changelog file.

## Related

- `specs/018-read-page-reduction-hardening/spec.md` — FR-011 / SC-005.
- `.github/workflows/release.yml` — current GitHub-generated release-note flow.
- `docs/development.md` — publishing and release guidance.
