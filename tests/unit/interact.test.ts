// Feature 011 — the pure pieces of the faithful-`fill` path:
// - writeLanded(): does the read-back value count as a landed write? (R2)
// - fillScript(): the generated in-page script types character by character with
//   real key events (US1 / R1). End-to-end behaviour is in
//   tests/integration/interaction.spec.ts.

import { describe, it, expect } from "vitest";
import { writeLanded, fillScript } from "../../src/main/page/interact.js";

describe("writeLanded — read-back comparator (feature 011, R2)", () => {
  it("exact match lands", () => {
    expect(writeLanded("hello world", "hello world")).toBe(true);
  });

  it("a mask that inserts separators still lands", () => {
    expect(writeLanded("091992", "09/1992")).toBe(true);
    expect(writeLanded("09/1992", "09/1992")).toBe(true);
    expect(writeLanded("5551234567", "(555) 123-4567")).toBe(true);
    expect(writeLanded("2026-08-31", "2026 . 08 . 31")).toBe(true);
  });

  it("an empty read-back does not land", () => {
    expect(writeLanded("09/1992", "")).toBe(false);
  });

  it("a truncated / shorter prefix does not land", () => {
    expect(writeLanded("09/1992", "09/19")).toBe(false);
    expect(writeLanded("09/1992", "091")).toBe(false);
  });

  it("a reordered or case-changed value does not land", () => {
    expect(writeLanded("1992/09", "09/1992")).toBe(false);
    expect(writeLanded("ABC", "abc")).toBe(false);
  });

  it("clearing a field (empty intended) lands only when the field is empty", () => {
    expect(writeLanded("", "")).toBe(true);
    expect(writeLanded("", "leftover")).toBe(false);
  });
});

describe("fillScript — per-character key events (feature 011, US1 / R1)", () => {
  const script = fillScript("#start_date", "09/1992");

  it("iterates the value one character at a time", () => {
    expect(script).toContain("for (const ch of Array.from(v))");
  });

  it("dispatches keydown, beforeinput, input, keyup per character", () => {
    expect(script).toContain('new KeyboardEvent("keydown", { key: ch');
    expect(script).toContain('new InputEvent("beforeinput"');
    expect(script).toContain('inputType: "insertText", data: ch');
    expect(script).toContain('new InputEvent("input", { bubbles: true, inputType: "insertText", data: ch }))');
    expect(script).toContain('new KeyboardEvent("keyup", { key: ch');
  });

  it("advances the value through the native setter, honouring a cancelled beforeinput", () => {
    expect(script).toContain("if (bi) __setValue(el, el.value + ch)");
  });

  it("reads the value back and returns currentValue", () => {
    expect(script).toContain("el.isContentEditable ? (el.innerText || \"\") : (el.value || \"\")");
    expect(script).toContain("return { currentValue: String(raw) }");
  });

  it("does not do a bulk one-shot value assignment of v", () => {
    expect(script).not.toContain("__setValue(el, v)");
  });
});
