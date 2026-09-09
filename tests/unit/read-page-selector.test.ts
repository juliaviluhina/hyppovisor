// Feature 016 — the pure piece of selector-scoped read_page: the in-page script
// builder. Selector resolution end to end (invalid CSS, no match, first match,
// DOM scoping) is exercised in tests/integration/read-page.spec.ts.

import { describe, it, expect } from "vitest";
import { readPageScript } from "../../src/main/page/read.js";
import { readPage } from "../../src/main/page/read.js";

describe("readPageScript", () => {
  it("with no selector, is textually equivalent to the unscoped full-page read", () => {
    const script = readPageScript(undefined, false);
    expect(script).toContain("document.body ? document.body.innerText : \"\"");
    expect(script).toContain(
      "document.documentElement ? document.documentElement.outerHTML : \"\"",
    );
    // No selector-resolution machinery pulled in when unscoped.
    expect(script).not.toContain("__querySafe");
  });

  it("with a selector, embeds it via JSON.stringify (safe against quotes/backslashes)", () => {
    const tricky = `div[data-x="a\\"b"]`;
    const script = readPageScript(tricky, false);
    expect(script).toContain(JSON.stringify(tricky));
    expect(script).toContain("__querySafe");
  });

  it("produces different scripts for undefined vs. a selector", () => {
    expect(readPageScript(undefined, false)).not.toBe(readPageScript("#detail-pane", false));
  });
});

describe("readPage readiness validation", () => {
  it("requires a selector when readiness is enabled", async () => {
    await expect(readPage({} as never, "tab", false, 0, undefined, true, undefined, [], {
      waitForSelector: true,
      log: {} as never,
    })).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });
  });

  it("rejects non-positive readiness timeouts before browser work", async () => {
    await expect(readPage({} as never, "tab", false, 0, "#target", true, undefined, [], {
      waitForSelector: true,
      timeoutMs: 0,
      log: {} as never,
    })).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });
  });
});
