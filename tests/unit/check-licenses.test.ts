// Feature 010 (T009) — the pure license classifier. See quickstart.md §1.

import { describe, it, expect } from "vitest";
import { classify, PERMISSIVE_ALLOWLIST } from "../../scripts/check-licenses.js";

describe("classify", () => {
  it("all-permissive → pass", () => {
    const r = classify({
      "a@1.0.0": "MIT",
      "b@2.1.0": "Apache-2.0",
      "c@0.0.1": "ISC",
      "d@3.0.0": "BSD-3-Clause",
    });
    expect(r).toEqual({ ok: true, offenders: [] });
  });

  it("a GPL dependency → fail, named as `name@version — <license>`", () => {
    const r = classify({ "a@1.0.0": "MIT", "bad-lib@4.2.0": "GPL-3.0" });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual(["bad-lib@4.2.0 — GPL-3.0"]);
  });

  it("UNKNOWN and a missing license field → fail (fail closed)", () => {
    const r = classify({ "a@1.0.0": "UNKNOWN", "b@1.0.0": "" });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([
      "a@1.0.0 — UNKNOWN",
      "b@1.0.0 — UNKNOWN",
    ]);
  });

  it("an OR expression passes when any term is permissive", () => {
    expect(classify({ "a@1.0.0": "(MIT OR Apache-2.0)" }).ok).toBe(true);
    expect(classify({ "a@1.0.0": "(GPL-3.0 OR MIT)" }).ok).toBe(true);
  });

  it("an AND expression passes only when every term is permissive", () => {
    expect(classify({ "a@1.0.0": "MIT AND ISC" }).ok).toBe(true);
    expect(classify({ "a@1.0.0": "MIT AND GPL-3.0" }).ok).toBe(false);
  });

  it("a mixed OR/AND expression is unparseable → fail", () => {
    expect(classify({ "a@1.0.0": "(MIT OR ISC) AND GPL-3.0" }).ok).toBe(false);
  });

  it("LGPL is not in the general allowlist", () => {
    expect(PERMISSIVE_ALLOWLIST).not.toContain("LGPL-2.1-or-later");
    expect(classify({ "a@1.0.0": "LGPL-2.1-or-later" }).ok).toBe(false);
  });
});
