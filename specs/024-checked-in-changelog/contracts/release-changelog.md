# Release Changelog Contract

## Local command

`node scripts/check-release-changelog.js <version> [--output <path>]`

- Exit 0 for exactly one non-empty entry for `<version>`.
- Exit non-zero with an actionable message naming the missing or invalid entry.
- With `--output`, write the matching entry body for the published release.
- Never mutate `CHANGELOG.md`.

## Workflow

The verification job invokes the checker before build or publication. The publish job supplies
the extracted checked-in entry to the GitHub Release; generated notes remain supplemental.
