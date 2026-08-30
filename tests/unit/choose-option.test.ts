// Feature 006 — the pure pieces of choose_option: the matching algorithm
// (research.md R5), chooser classification (R3), and the blocklist coverage
// change (R4). End-to-end mechanics are in tests/integration/choose-option.spec.ts.

import { describe, it, expect } from "vitest";
import {
  matchOption,
  chooserKindFor,
  norm,
  type ChooserShape,
} from "../../src/main/page/choose-option.js";
import {
  ruleCovers,
  matchBlocklist,
  type TargetDescriptor,
} from "../../src/main/safety/blocklist.js";

const opt = (label: string, value: string, disabled = false) => ({ label, value, disabled });

describe("matchOption — exact match, no fuzzy (FR-004…FR-008)", () => {
  const opts = [opt("France", "fr"), opt("Germany", "de"), opt("United States", "us")];

  it("value only: hit / miss / duplicate-value takes document order", () => {
    expect(matchOption(opts, { value: "de" })).toEqual({ ok: true, option: opt("Germany", "de") });
    expect(matchOption(opts, { value: "zz" })).toEqual({ ok: false, reason: "no-option-match" });
    const dups = [opt("A", "x"), opt("B", "x")];
    expect(matchOption(dups, { value: "x" })).toEqual({ ok: true, option: opt("A", "x") });
  });

  it("label only: exact hit (case + whitespace insensitive), miss, ambiguous", () => {
    expect(matchOption(opts, { label: "  united   STATES " })).toEqual({
      ok: true,
      option: opt("United States", "us"),
    });
    expect(matchOption(opts, { label: "Atlantis" })).toEqual({
      ok: false,
      reason: "no-option-match",
    });
    const two = [opt("Other", "a"), opt("Other", "b")];
    expect(matchOption(two, { label: "other" })).toEqual({
      ok: false,
      reason: "ambiguous-option",
      candidates: ["Other", "Other"],
    });
  });

  it("both supplied: value picks, label must agree", () => {
    expect(matchOption(opts, { value: "us", label: "United States" })).toEqual({
      ok: true,
      option: opt("United States", "us"),
    });
    expect(matchOption(opts, { value: "us", label: "France" })).toEqual({
      ok: false,
      reason: "no-option-match",
    });
  });

  it("a matched option that is disabled → option-disabled (checked last)", () => {
    const withDisabled = [opt("They / them", "they"), opt("Prefer not to say", "no", true)];
    expect(matchOption(withDisabled, { label: "prefer not to say" })).toEqual({
      ok: false,
      reason: "option-disabled",
    });
    // ambiguity wins over disabled
    const ambiguousDisabled = [opt("Dup", "a"), opt("Dup", "b", true)];
    expect(matchOption(ambiguousDisabled, { label: "dup" }).ok).toBe(false);
    expect((matchOption(ambiguousDisabled, { label: "dup" }) as { reason: string }).reason).toBe(
      "ambiguous-option",
    );
  });

  it("value is compared exactly — no trim, no case fold", () => {
    expect(matchOption([opt("X", "AB ")], { value: "AB" })).toEqual({
      ok: false,
      reason: "no-option-match",
    });
  });

  it("norm collapses whitespace and case", () => {
    expect(norm("  Two   Words ")).toBe("two words");
  });
});

describe("chooserKindFor — research.md R3, first match wins", () => {
  const shape = (o: Partial<ChooserShape>): ChooserShape => ({
    tagName: "div",
    role: null,
    multiple: false,
    ownsListbox: false,
    ...o,
  });

  it("classifies each chooser kind and rejects the rest", () => {
    expect(chooserKindFor(shape({ tagName: "select" }))).toBe("native-select");
    expect(chooserKindFor(shape({ tagName: "select", multiple: true }))).toBeNull();
    expect(chooserKindFor(shape({ role: "combobox" }))).toBe("custom-combobox");
    expect(chooserKindFor(shape({ role: "listbox" }))).toBe("listbox");
    expect(chooserKindFor(shape({ ownsListbox: true }))).toBe("custom-combobox");
    expect(chooserKindFor(shape({ role: "combobox", multiple: true }))).toBeNull();
    expect(chooserKindFor(shape({}))).toBeNull();
    expect(chooserKindFor(shape({ tagName: "input" }))).toBeNull();
  });
});

describe("blocklist coverage for choose_option (research.md R4)", () => {
  it("ruleCovers: activation / fill-or-space / both cover choose_option; click does not", () => {
    expect(ruleCovers("activation", "choose_option")).toBe(true);
    expect(ruleCovers("fill-or-space", "choose_option")).toBe(true);
    expect(ruleCovers("both", "choose_option")).toBe(true);
    expect(ruleCovers("click", "choose_option")).toBe(false);
  });

  const d = (o: Partial<TargetDescriptor>): TargetDescriptor => ({
    tagName: "select",
    type: null,
    role: null,
    hasFormAncestor: false,
    name: "",
    autocomplete: null,
    isContentEditable: false,
    ...o,
  });

  it("matchBlocklist(d, 'choose_option') blocks the four rule categories", () => {
    expect(
      matchBlocklist(d({ tagName: "button", type: "submit", name: "apply" }), "choose_option")
        .ruleId,
    ).toBe("submit-control");
    expect(
      matchBlocklist(d({ tagName: "input", type: "checkbox", name: "i agree to the terms" }), "choose_option")
        .ruleId,
    ).toBe("consent-toggle");
    expect(
      matchBlocklist(d({ name: "i agree to receive marketing email" }), "choose_option").ruleId,
    ).toBe("external-act-label");
    expect(matchBlocklist(d({ type: "password", tagName: "input" }), "choose_option").ruleId).toBe(
      "credential-field",
    );
  });

  it("does NOT block a plain <select> inside a form (in-form never gates choose_option)", () => {
    expect(
      matchBlocklist(d({ name: "country", hasFormAncestor: true }), "choose_option").blocked,
    ).toBe(false);
  });
});
