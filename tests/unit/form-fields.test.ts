// Feature 005 — the pure pieces of the structured form-field reader: the R4
// `kind` mapping and selector synthesis (research.md R3). The DOM walk, caps,
// options extraction, and verdict wiring are exercised end to end in
// tests/integration/read-form-fields.spec.ts.

import { describe, it, expect } from "vitest";
import { kindFor, synthesizeSelector, type SelectorCounts } from "../../src/main/page/form-fields.js";

describe("kindFor — research.md R4 table, first match wins", () => {
  it("maps the common (tag, type, role, contenteditable) combinations", () => {
    // contenteditable wins outright
    expect(kindFor("div", null, null, true)).toBe("richtext");
    expect(kindFor("textarea", null, null, false)).toBe("textarea");
    expect(kindFor("select", null, null, false)).toBe("select");

    // password input is still `text` — the raw `type` is carried on the record
    expect(kindFor("input", "password", null, false)).toBe("text");
    expect(kindFor("input", "text", null, false)).toBe("text");
    expect(kindFor("input", null, null, false)).toBe("text");
    expect(kindFor("input", "email", null, false)).toBe("text");
    expect(kindFor("input", "number", null, false)).toBe("text");

    expect(kindFor("input", "file", null, false)).toBe("file");
    expect(kindFor("input", "checkbox", null, false)).toBe("checkbox");
    expect(kindFor("input", "radio", null, false)).toBe("radio");

    // buttons: <button>, role=button, and the button-ish input types
    expect(kindFor("button", null, null, false)).toBe("button");
    expect(kindFor("button", "submit", null, false)).toBe("button");
    expect(kindFor("input", "submit", null, false)).toBe("button");
    expect(kindFor("input", "image", null, false)).toBe("button");
    expect(kindFor("span", null, "button", false)).toBe("button");

    // combobox groups <select>-alternatives
    expect(kindFor("div", null, "combobox", false)).toBe("combobox");
    expect(kindFor("ul", null, "listbox", false)).toBe("combobox");
    expect(kindFor("input", "text", "combobox", false)).toBe("combobox");
    expect(kindFor("input", "text", "textbox", false)).toBe("combobox");

    // role=switch is a checkbox-kind toggle
    expect(kindFor("span", null, "switch", false)).toBe("checkbox");
    expect(kindFor("span", null, "radio", false)).toBe("radio");

    // nothing recognised
    expect(kindFor("div", null, null, false)).toBe("other");
    expect(kindFor("a", null, null, false)).toBe("other");
  });
});

const counts = (o: Partial<SelectorCounts>): SelectorCounts => ({
  id: null,
  name: null,
  tagName: "input",
  structuralPath: "",
  idCount: 0,
  nameBareCount: 0,
  nameTaggedCount: 0,
  structuralCount: 0,
  ...o,
});

describe("synthesizeSelector — preference #id → [name] → structural (research.md R3)", () => {
  it("uses #id when the id is unique", () => {
    expect(synthesizeSelector(counts({ id: "first_name", idCount: 1 }))).toEqual({
      selector: "#first_name",
      selectorSynthesised: false,
      duplicateId: false,
    });
  });

  it("flags a duplicate id and falls through to a structural selector", () => {
    const r = synthesizeSelector(
      counts({ id: "dup", idCount: 2, structuralPath: "body:nth-of-type(1) > input:nth-of-type(2)", structuralCount: 1 }),
    );
    expect(r.duplicateId).toBe(true);
    expect(r.selectorSynthesised).toBe(true);
    expect(r.selector).toBe("body:nth-of-type(1) > input:nth-of-type(2)");
  });

  it("uses a bare [name] when the id is absent and the name is unique", () => {
    expect(synthesizeSelector(counts({ name: "email", nameBareCount: 1 }))).toEqual({
      selector: '[name="email"]',
      selectorSynthesised: false,
      duplicateId: false,
    });
  });

  it("tag-qualifies [name] when the bare form is not unique but the tagged one is", () => {
    const r = synthesizeSelector(
      counts({ name: "q", tagName: "select", nameBareCount: 2, nameTaggedCount: 1 }),
    );
    expect(r.selector).toBe('select[name="q"]');
    expect(r.selectorSynthesised).toBe(false);
  });

  it("synthesises a structural path when there is neither id nor name", () => {
    const r = synthesizeSelector(
      counts({ structuralPath: "body:nth-of-type(1) > form:nth-of-type(1) > input:nth-of-type(3)", structuralCount: 1 }),
    );
    expect(r.selector).toBe("body:nth-of-type(1) > form:nth-of-type(1) > input:nth-of-type(3)");
    expect(r.selectorSynthesised).toBe(true);
    expect(r.duplicateId).toBe(false);
  });

  it("returns selector: null when nothing resolves to exactly one element", () => {
    const r = synthesizeSelector(counts({ id: "x", idCount: 3, structuralPath: "div", structuralCount: 5 }));
    expect(r.selector).toBeNull();
    expect(r.selectorSynthesised).toBe(true);
    expect(r.duplicateId).toBe(true);
  });
});
