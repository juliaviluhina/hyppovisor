import { describe, expect, it } from "vitest";
import { extractReleaseEntry, validateReleaseEntry } from "../../scripts/check-release-changelog.js";

const changelog = `# Changelog

## [Unreleased]

### Changed
- pending

## [0.4.0] - 2026-09-04

### Fixed
- Preserve reviewed release notes.

## [0.3.0] - 2026-08-01

### Added
- Older release.
`;

describe("release changelog validation", () => {
  it("accepts and extracts one non-empty current-version entry", () => {
    expect(validateReleaseEntry(changelog, "0.4.0")).toEqual({ ok: true });
    expect(extractReleaseEntry(changelog, "0.4.0")).toContain("## [0.4.0] - 2026-09-04");
  });

  it("rejects a missing current-version entry", () => {
    expect(validateReleaseEntry(changelog, "0.5.0")).toEqual({
      ok: false,
      error: expect.stringContaining("0.5.0"),
    });
  });

  it("rejects duplicate and empty entries", () => {
    expect(validateReleaseEntry(`${changelog}\n## [0.4.0] - 2026-09-05\n\n`, "0.4.0").ok).toBe(false);
    expect(validateReleaseEntry(changelog.replace("### Fixed\n- Preserve reviewed release notes.", ""), "0.4.0").ok).toBe(false);
  });

  it("does not treat Unreleased as the current version", () => {
    expect(validateReleaseEntry("# Changelog\n\n## [Unreleased]\n\n- pending\n", "0.4.0").ok).toBe(false);
  });
});
