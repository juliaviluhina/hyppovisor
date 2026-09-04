import { describe, expect, it } from "vitest";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restrictDirectoryPermissions, restrictFilePermissions } from "../../src/main/security/file-permissions.js";

describe("local security permissions", () => {
  it("sets owner-only mode for files and directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "hyppo-permissions-"));
    const file = join(dir, "settings.json");
    writeFileSync(file, "{}");
    restrictFilePermissions(file);
    restrictDirectoryPermissions(dir);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});
