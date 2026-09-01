// Feature 006 — the pure pieces of choose_option: the matching algorithm
// (research.md R5), chooser classification (R3), and the blocklist coverage
// change (R4). End-to-end mechanics are in tests/integration/choose-option.spec.ts.

import { describe, it, expect } from "vitest";
import type { WebContents } from "electron";
import {
  matchOption,
  chooserKindFor,
  listOptions,
  norm,
  type ChooserShape,
} from "../../src/main/page/choose-option.js";
import { config } from "../../src/main/config.js";
import {
  ruleCovers,
  matchBlocklist,
  type TargetDescriptor,
} from "../../src/main/safety/blocklist.js";
import { HyppoError } from "../../src/main/errors.js";
import type { ChooseOptionReason } from "../../src/shared/types.js";

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
    formAction: null,
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

// ─── feature 008 US1: listOptions() — probe → open → gather → close ───────────

/**
 * A WebContents stub that routes each injected script to a handler keyed by a
 * fragment unique to that script. Records the call order so a test can assert a
 * native <select> takes no open/close.
 */
function fakeWc(handlers: {
  probe: unknown;
  open?: unknown;
  gather?: unknown;
  close?: unknown;
}): { wc: WebContents; calls: string[] } {
  const calls: string[] = [];
  const wc = {
    getURL: () => "http://fixture.test/combobox.html",
    executeJavaScript: async (src: string) => {
      if (src.includes("optionsInDom")) {
        calls.push("probe");
        return handlers.probe;
      }
      if (src.includes("new MutationObserver") && src.includes("resolve({ options")) {
        calls.push("gather");
        return handlers.gather ?? { options: [] };
      }
      if (src.includes('aria-expanded') && src.includes("shown")) {
        calls.push("close");
        return handlers.close ?? { shown: "", expanded: "false" };
      }
      if (src.includes("const isOpen") && src.includes("fireMouse")) {
        calls.push("open");
        return handlers.open ?? { ok: true };
      }
      calls.push("other");
      return null;
    },
  } as unknown as WebContents;
  return { wc, calls };
}

const orec = (label: string, value: string, disabled = false) => ({ label, value, disabled });

describe("listOptions — read-only option enumeration (feature 008 US1)", () => {
  it("native <select>: returns optionsInDom with optionsPresent:true and no open/close", async () => {
    const { wc, calls } = fakeWc({
      probe: {
        tagName: "select",
        role: null,
        multiple: false,
        ownsListbox: false,
        optionsInDom: [orec("Engineering", "eng"), orec("Design", "design"), orec("Ops", "ops", true)],
        optionsPresent: true,
        hasFilterInput: false,
        preCallValue: "",
      },
    });
    const r = await listOptions(wc, "#plainSelect");
    expect(r).toEqual({
      options: [orec("Engineering", "eng"), orec("Design", "design"), orec("Ops", "ops", true)],
      optionsPresent: true,
      optionsTruncated: false,
    });
    expect(calls).toEqual(["probe"]);
  });

  it("scripted widget: drives probe → open → gather → close, returns the gathered options", async () => {
    const { wc, calls } = fakeWc({
      probe: {
        tagName: "div",
        role: "combobox",
        multiple: false,
        ownsListbox: false,
        optionsInDom: [],
        optionsPresent: false,
        hasFilterInput: false,
        preCallValue: "",
      },
      open: { ok: true },
      gather: { options: [orec("Frontend Engineer", "fe"), orec("Backend Engineer", "be")] },
      close: { shown: "", expanded: "false" },
    });
    const r = await listOptions(wc, "#roleCombo");
    expect(r.options.map((o) => o.value)).toEqual(["fe", "be"]);
    expect(r.optionsPresent).toBe(true);
    expect(r.optionsTruncated).toBe(false);
    expect(calls).toEqual(["probe", "open", "gather", "close"]);
  });

  it("a widget that never populates: options: [], optionsPresent: false, no error", async () => {
    const { wc } = fakeWc({
      probe: {
        tagName: "div",
        role: "combobox",
        multiple: false,
        ownsListbox: false,
        optionsInDom: [],
        optionsPresent: false,
        hasFilterInput: false,
        preCallValue: "",
      },
      gather: { options: [] },
    });
    const r = await listOptions(wc, "#deadCombo");
    expect(r).toEqual({ options: [], optionsPresent: false, optionsTruncated: false });
  });

  it("<select multiple> → CHOOSE_OPTION_FAILED reason not-a-dropdown", async () => {
    const { wc } = fakeWc({
      probe: {
        tagName: "select",
        role: null,
        multiple: true,
        ownsListbox: false,
        optionsInDom: [orec("JS", "js"), orec("TS", "ts")],
        optionsPresent: true,
        hasFilterInput: false,
        preCallValue: "",
      },
    });
    await expect(listOptions(wc, "#multiSelect")).rejects.toMatchObject({
      code: "CHOOSE_OPTION_FAILED",
      details: { reason: "not-a-dropdown" },
    });
  });

  it("a plain <div> (probe returns null) → TARGET_NOT_FOUND", async () => {
    const { wc } = fakeWc({ probe: null });
    await expect(listOptions(wc, "#plainDiv")).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });
  });

  it("a non-CSS selector (probe returns the sentinel) → INVALID_SELECTOR", async () => {
    const { wc } = fakeWc({ probe: { __invalidSelector: true } });
    await expect(listOptions(wc, "a:has-text('x')")).rejects.toMatchObject({
      code: "INVALID_SELECTOR",
    });
  });

  it("the option cap truncates the returned list and sets optionsTruncated", async () => {
    const many = Array.from({ length: config.formFieldOptionCap + 2 }, (_, i) =>
      orec(`Option ${i}`, String(i)),
    );
    const { wc } = fakeWc({
      probe: {
        tagName: "select",
        role: null,
        multiple: false,
        ownsListbox: false,
        optionsInDom: many,
        optionsPresent: true,
        hasFilterInput: false,
        preCallValue: "",
      },
    });
    const r = await listOptions(wc, "#big");
    expect(r.options.length).toBe(config.formFieldOptionCap);
    expect(r.optionsTruncated).toBe(true);
  });
});

describe("refusal payload shape (data-model.md §8, R11)", () => {
  const reasons: ChooseOptionReason[] = [
    "not-a-dropdown",
    "no-option-match",
    "ambiguous-option",
    "option-disabled",
    "option-not-appeared",
    "multi-select",
  ];

  it("every non-rule reason serialises under code CHOOSE_OPTION_FAILED with the reason", () => {
    for (const reason of reasons) {
      const { error } = new HyppoError("CHOOSE_OPTION_FAILED", `msg (reason: ${reason})`, {
        reason,
      }).toResult();
      expect(error.code).toBe("CHOOSE_OPTION_FAILED");
      expect(error.reason).toBe(reason);
    }
  });

  it("ambiguous-option carries candidates: string[]", () => {
    const { error } = new HyppoError("CHOOSE_OPTION_FAILED", "msg", {
      reason: "ambiguous-option",
      candidates: ["Other", "Other"],
    }).toResult();
    expect(error.reason).toBe("ambiguous-option");
    expect(error.candidates).toEqual(["Other", "Other"]);
  });

  it("a rule match serialises under REFUSED_EXTERNAL_ACT with ruleId + ruleDescription", () => {
    const { error } = new HyppoError("REFUSED_EXTERNAL_ACT", "refused", {
      ruleId: "submit-control",
      ruleDescription: "…",
    }).toResult();
    expect(error.code).toBe("REFUSED_EXTERNAL_ACT");
    expect(error.ruleId).toBe("submit-control");
  });
});
