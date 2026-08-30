// Feature 008 (T007) — the INVALID_SELECTOR enforcer. The in-page detection is
// exercised end to end in the interaction / read-form-fields integration specs;
// here we pin the pure marker check and the fixed message.

import { describe, it, expect } from "vitest";
import {
  assertSelectorValid,
  isInvalidSelectorMarker,
  INVALID_SELECTOR_MESSAGE,
} from "../../src/main/page/selector-syntax.js";
import { isHyppoError } from "../../src/main/errors.js";

describe("assertSelectorValid", () => {
  it("throws INVALID_SELECTOR on the sentinel", () => {
    try {
      assertSelectorValid({ __invalidSelector: true });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(isHyppoError(e)).toBe(true);
      expect((e as { code: string }).code).toBe("INVALID_SELECTOR");
      expect((e as Error).message).toBe(INVALID_SELECTOR_MESSAGE);
    }
  });

  it("is a no-op for a normal value, null, or a look-alike object", () => {
    expect(() => assertSelectorValid(null)).not.toThrow();
    expect(() => assertSelectorValid(undefined)).not.toThrow();
    expect(() => assertSelectorValid({ tagName: "input" })).not.toThrow();
    expect(() => assertSelectorValid({ __invalidSelector: false })).not.toThrow();
    expect(() => assertSelectorValid([])).not.toThrow();
  });
});

describe("isInvalidSelectorMarker", () => {
  it("is true only for { __invalidSelector: true }", () => {
    expect(isInvalidSelectorMarker({ __invalidSelector: true })).toBe(true);
    expect(isInvalidSelectorMarker({ __invalidSelector: 1 })).toBe(false);
    expect(isInvalidSelectorMarker({})).toBe(false);
    expect(isInvalidSelectorMarker(null)).toBe(false);
    expect(isInvalidSelectorMarker("nope")).toBe(false);
  });
});

describe("INVALID_SELECTOR_MESSAGE", () => {
  it("names the unsupported selector forms and points at the discovery tools", () => {
    expect(INVALID_SELECTOR_MESSAGE).toContain(":has-text()");
    expect(INVALID_SELECTOR_MESSAGE).toContain("text=");
    expect(INVALID_SELECTOR_MESSAGE).toContain(">>");
    expect(INVALID_SELECTOR_MESSAGE).toContain("read_form_fields");
    expect(INVALID_SELECTOR_MESSAGE).toContain("read_page");
  });
});
