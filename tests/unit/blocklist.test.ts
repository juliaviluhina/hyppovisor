import { describe, it, expect } from "vitest";
import {
  matchBlocklist,
  listBlocklistRules,
  listSafeFillTypes,
  isSafeFillTarget,
  chooseVerdictFor,
  SAFE_FILL_TYPES,
  BLOCKLIST_RULES,
  type TargetDescriptor,
} from "../../src/main/safety/blocklist.js";

const base: TargetDescriptor = {
  tagName: "div",
  type: null,
  role: null,
  hasFormAncestor: false,
  name: "",
  autocomplete: null,
  isContentEditable: false,
};
const d = (o: Partial<TargetDescriptor>): TargetDescriptor => ({ ...base, ...o });

describe("blocklist (FR-012a, FR-018)", () => {
  it("exposes an enumerable rule set", () => {
    const rules = listBlocklistRules();
    expect(rules.length).toBe(BLOCKLIST_RULES.length);
    expect(rules.map((r) => r.id).sort()).toEqual(
      [
        "consent-toggle",
        "credential-field",
        "external-act-label",
        "in-form",
        "submit-control",
      ].sort(),
    );
    for (const r of rules) expect(r.description.length).toBeGreaterThan(10);
  });

  it("submit-control: <button> with no type or type=submit blocks click", () => {
    expect(matchBlocklist(d({ tagName: "button" }), "click").ruleId).toBe("submit-control");
    expect(matchBlocklist(d({ tagName: "button", type: "submit" }), "click").ruleId).toBe(
      "submit-control",
    );
    expect(matchBlocklist(d({ tagName: "input", type: "image" }), "click").ruleId).toBe(
      "submit-control",
    );
  });

  it("submit-control: <button type=button> with a neutral name is allowed", () => {
    expect(
      matchBlocklist(d({ tagName: "button", type: "button", name: "show more" }), "click").blocked,
    ).toBe(false);
  });

  it("in-form: a clickable element inside a form blocks click (feature 003 FR-001)", () => {
    expect(matchBlocklist(d({ tagName: "a", hasFormAncestor: true }), "click").ruleId).toBe(
      "in-form",
    );
  });

  it("in-form: does NOT block fill — value entry inside a form is permitted (feature 003 FR-001)", () => {
    const verdict = matchBlocklist(
      d({ tagName: "input", type: "text", hasFormAncestor: true }),
      "fill",
    );
    expect(verdict.blocked).toBe(false);
    expect(verdict.ruleId).toBeUndefined();
  });

  it("in-form: does NOT block space — Space cannot submit, so it is not gated by in-form", () => {
    const verdict = matchBlocklist(
      d({ tagName: "button", type: "button", name: "add another", hasFormAncestor: true }),
      "space",
    );
    expect(verdict.blocked).toBe(false);
  });

  it("external-act-label: save / confirm / delete / sign in / sign up wording blocks", () => {
    for (const name of [
      "save",
      "save changes",
      "confirm",
      "submit application",
      "delete account",
      "remove item",
      "sign in",
      "log in",
      "sign up",
      "register",
      "accept and continue",
      "pay now",
    ]) {
      const v = matchBlocklist(d({ tagName: "a", name }), "click");
      expect(v.blocked, `expected "${name}" to be blocked`).toBe(true);
    }
  });

  it("consent-toggle: a checkbox whose label reads as consent blocks click", () => {
    expect(
      matchBlocklist(
        d({ tagName: "input", type: "checkbox", name: "i accept the terms of service" }),
        "click",
      ).ruleId,
    ).toBe("consent-toggle");
    expect(
      matchBlocklist(
        d({ tagName: "input", type: "checkbox", name: "agree to the privacy policy" }),
        "click",
      ).ruleId,
    ).toBe("consent-toggle");
    expect(
      matchBlocklist(
        d({ role: "switch", tagName: "span", name: "subscribe to the newsletter" }),
        "click",
      ).ruleId,
    ).toBe("consent-toggle");
  });

  it("consent-toggle: a plain filter checkbox is allowed", () => {
    expect(
      matchBlocklist(
        d({ tagName: "input", type: "checkbox", name: "show only remote roles" }),
        "click",
      ).blocked,
    ).toBe(false);
  });

  it("credential-field: password / credential autocomplete blocks fill and space, not click", () => {
    expect(matchBlocklist(d({ tagName: "input", type: "password" }), "fill").ruleId).toBe(
      "credential-field",
    );
    expect(matchBlocklist(d({ tagName: "input", type: "password" }), "space").ruleId).toBe(
      "credential-field",
    );
    expect(
      matchBlocklist(
        d({ tagName: "input", type: "text", autocomplete: "current-password" }),
        "fill",
      ).ruleId,
    ).toBe("credential-field");
    expect(matchBlocklist(d({ tagName: "input", type: "password" }), "click").ruleId).not.toBe(
      "credential-field",
    );
  });

  it("permits a plain non-form control with a neutral name", () => {
    expect(
      matchBlocklist(d({ tagName: "button", type: "button", name: "show more" }), "click").blocked,
    ).toBe(false);
    expect(
      matchBlocklist(d({ tagName: "input", type: "text", name: "search" }), "fill").blocked,
    ).toBe(false);
  });

  it("enumerates the current rule ids and their appliesTo (feature 003)", () => {
    const byId = Object.fromEntries(listBlocklistRules().map((r) => [r.id, r.appliesTo]));
    expect(byId).toEqual({
      "submit-control": "activation",
      "in-form": "click",
      "consent-toggle": "activation",
      "external-act-label": "both",
      "credential-field": "fill-or-space",
    });
  });
});

describe("safe-fill type allowlist (feature 003 FR-002/FR-003/FR-004, SC-006)", () => {
  it("exposes an enumerable allowlist", () => {
    const list = listSafeFillTypes();
    expect([...list.types].sort()).toEqual(
      ["email", "number", "search", "tel", "text", "url"].sort(),
    );
    expect([...list.elementKinds].sort()).toEqual(["contenteditable", "textarea"].sort());
  });

  it("accepts every allowed input type", () => {
    for (const t of SAFE_FILL_TYPES) {
      expect(isSafeFillTarget(d({ tagName: "input", type: t })).ok, `type=${t}`).toBe(true);
    }
    expect(isSafeFillTarget(d({ tagName: "input", type: null })).ok).toBe(true); // defaults to text
    expect(isSafeFillTarget(d({ tagName: "textarea" })).ok).toBe(true);
    expect(isSafeFillTarget(d({ tagName: "div", isContentEditable: true })).ok).toBe(true);
  });

  it("accepts a combobox typed-text input but rejects its container", () => {
    expect(isSafeFillTarget(d({ tagName: "input", role: "combobox" })).ok).toBe(true);
    expect(isSafeFillTarget(d({ tagName: "input", role: "textbox" })).ok).toBe(true);
    const container = isSafeFillTarget(d({ tagName: "div", role: "combobox" }));
    expect(container.ok).toBe(false);
    expect(container.reason).toMatch(/container/);
  });

  it("rejects file, select, listbox, and non-value input types with a reason", () => {
    for (const bad of [
      d({ tagName: "input", type: "file" }),
      d({ tagName: "select" }),
      d({ tagName: "div", role: "listbox" }),
      d({ tagName: "input", type: "checkbox" }),
      d({ tagName: "input", type: "radio" }),
      d({ tagName: "input", type: "date" }),
      d({ tagName: "input", type: "color" }),
      d({ tagName: "button", type: "button" }),
    ]) {
      const v = isSafeFillTarget(bad);
      expect(v.ok, `${bad.tagName}/${bad.type ?? bad.role}`).toBe(false);
      expect(v.reason && v.reason.length).toBeGreaterThan(3);
    }
  });
});

describe("click / space verdict parity (feature 003 FR-012, SC-003)", () => {
  const cases: Array<[string, Partial<TargetDescriptor>, string]> = [
    ["submit button", { tagName: "button", type: "submit" }, "submit-control"],
    ["untyped button in form", { tagName: "button", hasFormAncestor: true }, "submit-control"],
    [
      "consent checkbox",
      { tagName: "input", type: "checkbox", name: "i agree to the terms" },
      "consent-toggle",
    ],
    ["apply-labelled non-button", { tagName: "div", name: "apply now" }, "external-act-label"],
  ];

  for (const [label, shape, ruleId] of cases) {
    it(`${label}: click and space yield ${ruleId}`, () => {
      const clickV = matchBlocklist(d(shape), "click");
      const spaceV = matchBlocklist(d(shape), "space");
      expect(clickV.ruleId).toBe(ruleId);
      expect(spaceV.ruleId).toBe(ruleId);
      expect(spaceV.blocked).toBe(clickV.blocked);
    });
  }

  it("in-form is the sole rule that gates click but not space", () => {
    const plainButtonInForm = d({
      tagName: "button",
      type: "button",
      name: "add another",
      hasFormAncestor: true,
    });
    expect(matchBlocklist(plainButtonInForm, "click").ruleId).toBe("in-form");
    expect(matchBlocklist(plainButtonInForm, "space").blocked).toBe(false);
  });
});

describe("chooseVerdictFor — parity with choose_option's refusals (feature 008 R8)", () => {
  it("refuses exactly submit-control / consent-toggle / credential-field / external-act-label", () => {
    expect(chooseVerdictFor(d({ tagName: "button", type: "submit", name: "go" }))).toMatchObject({
      allowed: false,
      ruleId: "submit-control",
    });
    expect(
      chooseVerdictFor(d({ tagName: "input", type: "checkbox", name: "i agree to the terms" })),
    ).toMatchObject({ allowed: false, ruleId: "consent-toggle" });
    expect(chooseVerdictFor(d({ tagName: "input", type: "password" }))).toMatchObject({
      allowed: false,
      ruleId: "credential-field",
    });
    expect(chooseVerdictFor(d({ tagName: "span", name: "download report" }))).toMatchObject({
      allowed: false,
      ruleId: "external-act-label",
    });
  });

  it("permits an in-form plain <select> — in-form does not gate choose_option", () => {
    expect(
      chooseVerdictFor(d({ tagName: "select", name: "country", hasFormAncestor: true })),
    ).toEqual({ allowed: true });
  });

  it("matches matchBlocklist(d, 'choose_option') by construction", () => {
    const cases = [
      d({ tagName: "button", type: "submit" }),
      d({ tagName: "select", hasFormAncestor: true }),
      d({ tagName: "input", type: "password" }),
      d({ tagName: "div", role: "combobox", name: "role" }),
    ];
    for (const c of cases) {
      const v = matchBlocklist(c, "choose_option");
      const cv = chooseVerdictFor(c);
      expect(cv.allowed).toBe(!v.blocked);
      if (v.blocked) expect(cv.ruleId).toBe(v.ruleId);
    }
  });
});
