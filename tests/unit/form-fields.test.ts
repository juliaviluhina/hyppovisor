// Feature 005 — the pure pieces of the structured form-field reader: the R4
// `kind` mapping and selector synthesis (research.md R3). The DOM walk, caps,
// options extraction, and verdict wiring are exercised end to end in
// tests/integration/read-form-fields.spec.ts.

import { describe, it, expect } from "vitest";
import type { WebContents } from "electron";
import {
  kindFor,
  synthesizeSelector,
  readFormFields,
  capList,
  isRequiredUnfilled,
  checkReadFormFieldsShape,
  operationForKind,
  type SelectorCounts,
} from "../../src/main/page/form-fields.js";
import {
  fillVerdictFor,
  clickVerdictFor,
  type TargetDescriptor,
} from "../../src/main/safety/blocklist.js";
import { config } from "../../src/main/config.js";

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

describe("capList — control cap and per-record options cap (FR-010)", () => {
  it("cuts to the cap in order and flags the truncation", () => {
    expect(capList([1, 2, 3, 4, 5], 3)).toEqual({ items: [1, 2, 3], truncated: true });
  });
  it("leaves a list at or under the cap untouched", () => {
    expect(capList([1, 2], 3)).toEqual({ items: [1, 2], truncated: false });
    expect(capList([1, 2, 3], 3)).toEqual({ items: [1, 2, 3], truncated: false });
  });
  it("handles an empty list", () => {
    expect(capList([], 3)).toEqual({ items: [], truncated: false });
  });
});

describe("readFormFields applies both caps from config", () => {
  it("truncates the control list and sets the top-level flag", async () => {
    const many = Array.from({ length: config.formFieldControlCap + 5 }, () =>
      rawRecord(desc({ type: "text" })),
    );
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        fieldsProjected: false,
        records: many,
      }),
      "tab-1",
      undefined,
      0,
    );
    // Post-feature-008 the 64 KB byte budget may trim further than the count cap;
    // either way the list is bounded and the single flag is set.
    expect(map.records.length).toBeLessThanOrEqual(config.formFieldControlCap);
    expect(map.records.length).toBeGreaterThan(0);
    expect(map.truncated).toBe(true);
  });

  it("truncates a record's options to the options cap with a per-record flag", async () => {
    const opts = Array.from({ length: config.formFieldOptionCap + 3 }, (_, i) => ({
      label: `o${i}`,
      value: String(i),
    }));
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        records: [
          rawRecord(desc({ tagName: "select", type: null }), {
            options: opts,
            optionsAvailable: true,
          }),
        ],
      }),
      "tab-1",
      undefined,
      0,
    );
    expect(map.records[0].options.length).toBe(config.formFieldOptionCap);
    expect(map.records[0].optionsTruncated).toBe(true);
    expect(map.records[0].optionsAvailable).toBe(true);
  });
});

const desc = (o: Partial<TargetDescriptor>): TargetDescriptor => ({
  tagName: "input",
  type: "text",
  role: null,
  hasFormAncestor: false,
  name: "",
  autocomplete: null,
  isContentEditable: false,
  ...o,
});

// ─── feature 008 US2 ────────────────────────────────────────────────────────

describe("operationForKind — data-model.md R8 table", () => {
  it("maps every kind to its interact operation", () => {
    expect(operationForKind("text")).toBe("fill");
    expect(operationForKind("textarea")).toBe("fill");
    expect(operationForKind("richtext")).toBe("fill");
    expect(operationForKind("select")).toBe("choose");
    expect(operationForKind("combobox")).toBe("choose");
    expect(operationForKind("checkbox")).toBe("activate");
    expect(operationForKind("radio")).toBe("activate");
    expect(operationForKind("button")).toBe("activate");
    expect(operationForKind("file")).toBe("none");
    expect(operationForKind("other")).toBe("none");
  });
});

describe("readFormFields — every record carries operation + chooseVerdict (R8)", () => {
  it("derives operation from kind and chooseVerdict from the blocklist", async () => {
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        fieldsProjected: false,
        records: [
          rawRecord(desc({ tagName: "input", type: "text", name: "first name" })),
          rawRecord(desc({ tagName: "select", type: null }), { options: [], optionsAvailable: true }),
          rawRecord(desc({ tagName: "input", type: "checkbox", name: "i agree to the terms" })),
        ],
      }),
      "tab-1",
      undefined,
      0,
      { includeNonInteractive: true },
    );
    expect(map.records[0].operation).toBe("fill");
    expect(map.records[0].chooseVerdict).toEqual({ allowed: true });
    expect(map.records[1].operation).toBe("choose");
    // the consent checkbox: choose_option would refuse it (consent-toggle)
    expect(map.records[2].chooseVerdict).toMatchObject({ allowed: false, ruleId: "consent-toggle" });
  });
});

describe("readFormFields — value-mirror cluster collapse (R7 / FR-015)", () => {
  it("tags the hidden mirror interactive:false + mirrors:<combo selector>; combo record stays interactive", async () => {
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        fieldsProjected: true, // fields-projected so both survive for the assertion
        records: [
          // index 0: the combobox (role=combobox), id → selector #roleCombo
          {
            ...rawRecord(desc({ tagName: "div", type: null, role: "combobox" })),
            selectorCounts: {
              id: "roleCombo",
              name: null,
              tagName: "div",
              structuralPath: "",
              idCount: 1,
              nameBareCount: 0,
              nameTaggedCount: 0,
              structuralCount: 0,
            },
          },
          // index 1: the hidden mirror, pointing back at index 0
          {
            ...rawRecord(desc({ tagName: "input", type: "hidden" })),
            visible: false,
            mirrorOfIndex: 0,
            selectorCounts: {
              id: "q_role",
              name: "q_role",
              tagName: "input",
              structuralPath: "",
              idCount: 1,
              nameBareCount: 1,
              nameTaggedCount: 1,
              structuralCount: 0,
            },
          },
        ],
      }),
      "tab-1",
      undefined,
      0,
      { fields: ["#roleCombo", "#q_role"] },
    );
    const combo = map.records[0];
    const mirror = map.records[1];
    expect(combo.selector).toBe("#roleCombo");
    expect("interactive" in combo).toBe(false); // genuine control ⇒ interactive absent
    expect(mirror.interactive).toBe(false);
    expect(mirror.mirrors).toBe("#roleCombo");
  });
});

describe("isRequiredUnfilled — required && currently empty (data-model.md §1)", () => {
  it("true only for a required control with no value", () => {
    expect(isRequiredUnfilled({ required: true, currentValue: "" })).toBe(true);
    expect(isRequiredUnfilled({ required: true, currentValue: null })).toBe(true);
    expect(isRequiredUnfilled({ required: true, currentValue: undefined })).toBe(true);
    expect(isRequiredUnfilled({ required: true, currentValue: false })).toBe(true); // unchecked
    expect(isRequiredUnfilled({ required: true, currentValue: [] })).toBe(true); // no option chosen
  });
  it("false when not required, or when a value is present", () => {
    expect(isRequiredUnfilled({ required: false, currentValue: "" })).toBe(false);
    expect(isRequiredUnfilled({ required: true, currentValue: "x" })).toBe(false);
    expect(isRequiredUnfilled({ required: true, currentValue: true })).toBe(false); // checked
    expect(isRequiredUnfilled({ required: true, currentValue: ["a"] })).toBe(false);
  });
});

describe("checkReadFormFieldsShape — fields ⨯ containerSelector are mutually exclusive (R6)", () => {
  it("rejects both supplied together as an argument error", () => {
    const err = checkReadFormFieldsShape("#form", ["#a"]);
    expect(err).not.toBeNull();
    expect(err!.code).toBe("BATCH_REJECTED");
  });
  it("permits either alone or neither", () => {
    expect(checkReadFormFieldsShape("#form", undefined)).toBeNull();
    expect(checkReadFormFieldsShape(undefined, ["#a"])).toBeNull();
    expect(checkReadFormFieldsShape(undefined, undefined)).toBeNull();
  });
  it("readFormFields itself throws when both are passed", async () => {
    await expect(
      readFormFields(wcYielding({ containerFound: true }), "tab-1", "#form", 0, { fields: ["#a"] }),
    ).rejects.toMatchObject({ code: "BATCH_REJECTED" });
  });
});

describe("readFormFields — byte budget tail-drop (FR-011, R5)", () => {
  const bigRaw = (i: number) =>
    rawRecord(desc({ type: "text" }), {
      label: `field ${i} ${"x".repeat(600)}`,
      currentValue: "y".repeat(600),
      selectorCounts: {
        id: `f${i}`,
        name: null,
        tagName: "input",
        structuralPath: "",
        idCount: 1,
        nameBareCount: 0,
        nameTaggedCount: 0,
        structuralCount: 0,
      },
    });

  it("drops the last records in document order until the payload fits, and sets truncated", async () => {
    const records = Array.from({ length: 120 }, (_, i) => bigRaw(i)); // ~150 KB of labels/values
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        fieldsProjected: false,
        records,
      }),
      "tab-1",
      undefined,
      0,
    );
    expect(map.truncated).toBe(true);
    expect(map.records.length).toBeLessThan(120);
    expect(map.records.length).toBeGreaterThan(0);
    // order-stable: the kept records are the FIRST n, by id
    const keptIds = map.records.map((r) => r.selector);
    expect(keptIds).toEqual(
      Array.from({ length: keptIds.length }, (_, i) => `#f${i}`),
    );
    // and the serialised payload is within budget
    expect(Buffer.byteLength(JSON.stringify(map), "utf8")).toBeLessThanOrEqual(65536);
  });

  it("a small read is untouched — truncated stays false", async () => {
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        fieldsProjected: false,
        records: [rawRecord(desc({ type: "text" }), { currentValue: "" })],
      }),
      "tab-1",
      undefined,
      0,
    );
    expect(map.truncated).toBe(false);
    expect(map.records.length).toBe(1);
  });
});

describe("readFormFields — maxLength / pattern / inputMode pass through only when present", () => {
  it("carries the constraint hints from the raw record", async () => {
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        fieldsProjected: false,
        records: [
          rawRecord(desc({ type: "text" }), {
            maxLength: 20,
            pattern: "[0-9]*",
            inputMode: "numeric",
          }),
        ],
      }),
      "tab-1",
      undefined,
      0,
    );
    expect(map.records[0]).toMatchObject({ maxLength: 20, pattern: "[0-9]*", inputMode: "numeric" });
  });
  it("omits the keys entirely when the raw record has none", async () => {
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        fieldsProjected: false,
        records: [rawRecord(desc({ type: "text" }))],
      }),
      "tab-1",
      undefined,
      0,
    );
    const rec = map.records[0];
    expect("maxLength" in rec).toBe(false);
    expect("pattern" in rec).toBe(false);
    expect("inputMode" in rec).toBe(false);
  });
});

describe("fill / click verdicts match interact's rule set (FR-006, FR-007, SC-004)", () => {
  it("attributes each rule category to the same id interact's path produces", () => {
    // submit control
    const submit = desc({ tagName: "button", type: "submit", name: "apply now", hasFormAncestor: true });
    expect(clickVerdictFor(submit)).toMatchObject({ verdict: "refused", ruleId: "submit-control" });
    expect(fillVerdictFor(submit).ruleId).toBe("external-act-label"); // fill path: wording rule

    // consent toggle
    const consent = desc({ type: "checkbox", name: "i agree to the terms", hasFormAncestor: true });
    expect(clickVerdictFor(consent)).toMatchObject({ verdict: "refused", ruleId: "consent-toggle" });

    // external-act wording (applies to both) — a non button/anchor element so
    // submit-control does not claim it first
    const wording = desc({ tagName: "span", name: "download report" });
    expect(clickVerdictFor(wording).ruleId).toBe("external-act-label");
    expect(fillVerdictFor(wording).ruleId).toBe("external-act-label");

    // credential field — fill only
    const cred = desc({ type: "password" });
    expect(fillVerdictFor(cred)).toMatchObject({ verdict: "refused", ruleId: "credential-field" });
    const otp = desc({ type: "text", autocomplete: "one-time-code" });
    expect(fillVerdictFor(otp).ruleId).toBe("credential-field");

    // unsafe fill type — fill only, after the blocklist clears
    const select = desc({ tagName: "select", type: null });
    expect(fillVerdictFor(select)).toMatchObject({ verdict: "refused", ruleId: "unsafe-fill-type" });
    expect(clickVerdictFor(select).verdict).toBe("permitted");

    // in-form — click only, NEVER fill
    const plainInForm = desc({ type: "text", name: "first name", hasFormAncestor: true });
    expect(clickVerdictFor(plainInForm)).toMatchObject({ verdict: "refused", ruleId: "in-form" });
    expect(fillVerdictFor(plainInForm)).toEqual({ verdict: "permitted" });

    // a plain field outside a form — permitted both ways
    const plain = desc({ type: "email", name: "email address" });
    expect(fillVerdictFor(plain)).toEqual({ verdict: "permitted" });
    expect(clickVerdictFor(plain)).toEqual({ verdict: "permitted" });
  });
});

/** A WebContents stub whose collector script yields a fixed raw result. */
function wcYielding(raw: unknown): WebContents {
  return {
    getURL: () => "http://fixture.test/form.html",
    executeJavaScript: async () => raw,
  } as unknown as WebContents;
}

function rawRecord(descriptor: TargetDescriptor, extra: Record<string, unknown> = {}) {
  return {
    descriptor,
    selectorCounts: {
      id: "x",
      name: null,
      tagName: descriptor.tagName,
      structuralPath: "",
      idCount: 1,
      nameBareCount: 0,
      nameTaggedCount: 0,
      structuralCount: 0,
    },
    label: "",
    required: false,
    group: null,
    inFormAncestor: descriptor.hasFormAncestor,
    visible: true,
    currentValue: "SHOULD_NOT_LEAK",
    options: [],
    optionsAvailable: false,
    optionsTruncated: false,
    ...extra,
  };
}

describe("record assembly — credential currentValue is omitted entirely (FR-005, SC-005)", () => {
  it("drops the currentValue own-property for a password field", async () => {
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        records: [rawRecord(desc({ type: "password" }))],
      }),
      "tab-1",
      undefined,
      0,
    );
    const rec = map.records[0];
    expect(rec.fillVerdict.ruleId).toBe("credential-field");
    expect("currentValue" in rec).toBe(false);
  });

  it("keeps currentValue for a non-credential field", async () => {
    const map = await readFormFields(
      wcYielding({
        containerFound: true,
        observedAt: "2026-08-30T00:00:00.000Z",
        hardCeilingHit: false,
        records: [rawRecord(desc({ type: "text" }), { currentValue: "hello" })],
      }),
      "tab-1",
      undefined,
      0,
    );
    expect(map.records[0].currentValue).toBe("hello");
  });
});
