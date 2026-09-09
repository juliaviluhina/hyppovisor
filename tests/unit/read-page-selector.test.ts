// Feature 016 — the pure piece of selector-scoped read_page: the in-page script
// builder. Selector resolution end to end (invalid CSS, no match, first match,
// DOM scoping) is exercised in tests/integration/read-page.spec.ts.

import { describe, it, expect, vi } from "vitest";
import { readPageScript } from "../../src/main/page/read.js";
import { readPage } from "../../src/main/page/read.js";

const waitForSelectorMock = vi.fn();
vi.mock("../../src/main/page/interact.js", () => ({
  waitForSelector: (...args: unknown[]) => waitForSelectorMock(...args),
}));

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

  it("translates a wait timeout into READINESS_TIMEOUT naming the selector and window", async () => {
    const { HyppoError } = await import("../../src/main/errors.js");
    waitForSelectorMock.mockRejectedValueOnce(
      new HyppoError("WAIT_TIMEOUT", "Selector \"#late\" did not appear within 5ms. Tab left unchanged."),
    );
    const err = await readPage({} as never, "tab", false, 0, "#late", true, undefined, [], {
      waitForSelector: true,
      timeoutMs: 5,
      log: {} as never,
    }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "READINESS_TIMEOUT" });
    expect((err as Error).message).toContain("#late");
    expect((err as Error).message).toContain("5ms");
  });

  it("propagates a non-timeout readiness error unchanged", async () => {
    const { HyppoError } = await import("../../src/main/errors.js");
    waitForSelectorMock.mockRejectedValueOnce(new HyppoError("INVALID_SELECTOR", "bad selector"));
    await expect(readPage({} as never, "tab", false, 0, ":::", true, undefined, [], {
      waitForSelector: true,
      timeoutMs: 5,
      log: {} as never,
    })).rejects.toMatchObject({ code: "INVALID_SELECTOR" });
  });
});
