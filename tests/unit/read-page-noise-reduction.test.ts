// Feature 017 — the pure piece of DOM noise reduction: the in-page script
// builder's reduction pass. End-to-end stripping/preservation is exercised in
// tests/integration/read-page.spec.ts against tests/fixtures/dom-noise-repro.html.

import { describe, it, expect } from "vitest";
import { readPageScript } from "../../src/main/page/read.js";

describe("readPageScript reduction pass", () => {
  it("reduceDom: true (unscoped) embeds the clone/strip/TreeWalker reduction pass", () => {
    const script = readPageScript(undefined, true);
    expect(script).toContain("cloneNode(true)");
    expect(script).toContain('querySelectorAll("script, style")');
    expect(script).toContain("createTreeWalker");
    expect(script).toContain("NodeFilter.SHOW_COMMENT");
    expect(script).toContain('removeAttribute("class")');
    expect(script).toContain('removeAttribute("style")');
    expect(script).toContain("__reduceDom(document.documentElement)");
  });

  it("reduceDom: true removes only decorative (aria-hidden) icon svgs", () => {
    const script = readPageScript(undefined, true);
    expect(script).toContain('svg[aria-hidden="true"]');
  });

  it("reduceDom: true (scoped) applies the same reduction pass to the selector match", () => {
    const script = readPageScript("#job-list", true);
    expect(script).toContain("__querySafe");
    expect(script).toContain("cloneNode(true)");
    expect(script).toContain("__reduceDom(el)");
  });

  it("reduceDom: false (unscoped) is textually equivalent to the pre-017 script — no clone/strip", () => {
    const script = readPageScript(undefined, false);
    expect(script).toContain('document.documentElement ? document.documentElement.outerHTML : ""');
    expect(script).not.toContain("cloneNode");
    expect(script).not.toContain("createTreeWalker");
  });

  it("reduceDom: false (scoped) is textually equivalent to the pre-017 script — no clone/strip", () => {
    const script = readPageScript("#job-list", false);
    expect(script).toContain('el.outerHTML || ""');
    expect(script).not.toContain("cloneNode");
    expect(script).not.toContain("createTreeWalker");
  });

  it("text is always read from the original element, never the reduced clone", () => {
    const unscoped = readPageScript(undefined, true);
    expect(unscoped).toContain('document.body ? document.body.innerText : ""');
    const scoped = readPageScript("#job-list", true);
    expect(scoped).toContain('text: el.innerText || ""');
  });

  it("omits all DOM work when includeDom is false", () => {
    const unscoped = readPageScript(undefined, true, false);
    const scoped = readPageScript("#job-list", true, false);
    expect(unscoped).not.toContain("cloneNode");
    expect(unscoped).not.toContain("outerHTML");
    expect(scoped).not.toContain("cloneNode");
    expect(scoped).not.toContain("outerHTML");
    expect(scoped).toContain('text: el.innerText || ""');
  });
});
