# Data Model: Checked-In Changelog for Future Releases

## Changelog

- `Unreleased` section: changes awaiting a version.
- Version sections: `## [x.y.z] - YYYY-MM-DD`.
- Category sections: Keep a Changelog categories such as Added, Changed, Fixed, and Security.

## Release Entry

- `version`: semantic version matching `package.json` and the tag without `v`.
- `heading`: exact version heading in `CHANGELOG.md`.
- `content`: non-empty Markdown body before the next version heading.

Validation fails for a missing file, malformed heading, duplicate matching heading, or empty content.
`Unreleased` cannot substitute for the current version during publication.
