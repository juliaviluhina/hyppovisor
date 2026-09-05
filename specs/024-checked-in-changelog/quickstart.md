# Quickstart: Checked-In Changelog

1. Add user-visible changes under `## [Unreleased]` in `CHANGELOG.md`.
2. Before release, move them into `## [x.y.z] - YYYY-MM-DD` matching `package.json`.
3. Run `node scripts/check-release-changelog.js $(node -p "require('./package.json').version")`.
4. Run `npm test` and push the matching `vX.Y.Z` tag.
5. Confirm the GitHub Release contains the checked-in entry and supplemental generated notes.
