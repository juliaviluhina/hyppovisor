import { describe, it, expect } from "vitest";
import {
  matchBlocklist,
  listBlocklistRules,
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

  it("in-form: any element inside a form blocks both click and fill", () => {
    expect(matchBlocklist(d({ tagName: "a", hasFormAncestor: true }), "click").ruleId).toBe(
      "in-form",
    );
    expect(
      matchBlocklist(d({ tagName: "input", type: "text", hasFormAncestor: true }), "fill").ruleId,
    ).toBe("in-form");
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

  it("credential-field: password input or credential autocomplete blocks fill only", () => {
    expect(matchBlocklist(d({ tagName: "input", type: "password" }), "fill").ruleId).toBe(
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
});
