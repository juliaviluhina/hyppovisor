// Feature 010 (T004) — the `npm run dist` fail-fast preflight verdict.
// See quickstart.md §3.

import { describe, it, expect } from "vitest";
import { preflightVerdict } from "../../scripts/dist-preflight.js";

const good = {
  platform: "darwin",
  electronDistExists: true,
  iconWidth: 1024,
  iconHeight: 1024,
};

describe("preflightVerdict", () => {
  it("all good → ok", () => {
    expect(preflightVerdict(good)).toEqual({ ok: true, message: expect.any(String) });
  });

  it("non-macOS host → fail, names the platform requirement", () => {
    const v = preflightVerdict({ ...good, platform: "linux" });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/macOS required/i);
  });

  it("missing Electron runtime → fail, points at npm install", () => {
    const v = preflightVerdict({ ...good, electronDistExists: false });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/npm install/i);
  });

  it("wrong-size icon → fail, names the 1024×1024 requirement and the actual size", () => {
    const v = preflightVerdict({ ...good, iconWidth: 512, iconHeight: 512 });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/1024/);
    expect(v.message).toMatch(/512×512/);
  });

  it("missing icon (0×0) → fail", () => {
    expect(preflightVerdict({ ...good, iconWidth: 0, iconHeight: 0 }).ok).toBe(false);
  });

  it("host check comes before the icon check", () => {
    const v = preflightVerdict({
      platform: "win32",
      electronDistExists: false,
      iconWidth: 0,
      iconHeight: 0,
    });
    expect(v.message).toMatch(/macOS required/i);
  });
});
