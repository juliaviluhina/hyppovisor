import { describe, it, expect } from "vitest";
import { readPageScript } from "../../src/main/page/read.js";

describe("readPageScript ancestor escalation and exclusion", () => {
  it("resolves the first match, climbs ancestors, and reports the effective level", () => {
    const script = readPageScript("#target", false, true, 2);
    expect(script).toContain("__querySafe(document, \"#target\")");
    expect(script).toContain("root = root.parentElement");
    expect(script).toContain("requestedAncestorLevels: 2");
    expect(script).toContain("effectiveAncestorLevels");
  });

  it("removes exclusions from the cloned root before text and DOM output", () => {
    const script = readPageScript("#target", true, true, 1, [".chat", ".ads"]);
    expect(script).toContain("cloneNode(true)");
    expect(script).toContain("__queryAllSafe(clone, exclusion)");
    expect(script).toContain("el.remove()");
    expect(script).toContain("text: clone.innerText");
    expect(script).toContain("__reduceDom(clone)");
  });

  it("keeps the existing script path unchanged when new inputs are omitted", () => {
    const script = readPageScript("#target", false);
    expect(script).toContain('text: el.innerText || ""');
    expect(script).toContain('dom: el.outerHTML || ""');
    expect(script).not.toContain("cloneNode");
  });
});
