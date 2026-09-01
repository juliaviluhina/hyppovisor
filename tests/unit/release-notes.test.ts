// Guards the release-changelog wiring: the GitHub Release body is
// `.github/RELEASE_NOTES_HEADER.md` (the unsigned-build Gatekeeper steps)
// followed by GitHub's auto-generated PR changelog. Regression cover for the
// v0.2.0 miss, where the publish job never checked out the repo so `body_path`
// failed with ENOENT and the header silently dropped out.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string): string => readFileSync(root + p, "utf8");

const HEADER_PATH = ".github/RELEASE_NOTES_HEADER.md";
const HEADER = read(HEADER_PATH);
/** Header with `>` blockquote prefixes and line wrapping flattened, for prose matches. */
const HEADER_PROSE = HEADER.replace(/^>\s?/gm, "").replace(/\s+/g, " ").trim();
const WORKFLOW = read(".github/workflows/release.yml");

/** The body of a top-level (2-space-indented) job key, up to the next such key or EOF. */
function jobBlock(name: string): string {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  expect(start, `job "${name}" present in release.yml`).toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("RELEASE_NOTES_HEADER.md", () => {
  it("is present and non-trivial", () => {
    expect(HEADER.trim().length).toBeGreaterThan(200);
  });

  it("names the misleading Gatekeeper message users will search for", () => {
    expect(HEADER_PROSE).toMatch(/damaged and can.?t be opened/i);
    expect(HEADER_PROSE.toLowerCase()).toContain("unsigned");
  });

  it("gives the two unblock commands verbatim", () => {
    expect(HEADER).toContain("xattr -dr com.apple.quarantine /Applications/HyppoVisor.app");
    expect(HEADER).toMatch(/codesign --force --deep --sign - \/Applications\/HyppoVisor\.app/);
  });

  it("points back to the README for the full steps", () => {
    expect(HEADER).toMatch(/github\.com\/juliaviluhina\/hyppovisor#download--install/);
  });

  it("covers both shipped arches", () => {
    expect(HEADER).toMatch(/arm64/);
    expect(HEADER).toMatch(/x64/);
  });
});

describe("release.yml — changelog wiring", () => {
  const publish = jobBlock("publish");

  it("only a tag push cuts a Release", () => {
    expect(publish).toMatch(/if:\s*startsWith\(github\.ref, 'refs\/tags\/'\)/);
  });

  it("uses the header file as the Release body and appends the auto changelog", () => {
    expect(publish).toContain(`body_path: ${HEADER_PATH}`);
    expect(publish).toMatch(/generate_release_notes:\s*true/);
  });

  it("checks out the repo before the release step, so body_path resolves", () => {
    const checkout = publish.indexOf("actions/checkout@");
    const release = publish.indexOf("softprops/action-gh-release@");
    expect(checkout, "publish job runs actions/checkout").toBeGreaterThan(-1);
    expect(release, "publish job runs action-gh-release").toBeGreaterThan(-1);
    expect(checkout).toBeLessThan(release);
  });

  it("fails a release whose tag disagrees with package.json", () => {
    const verify = jobBlock("verify");
    expect(verify).toMatch(/\[ "\$tag" = "\$pkg" \]/);
  });
});
