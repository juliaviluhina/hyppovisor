// Feature 004 — batch fill: the pure guards and the shared per-target check.
// Cap / empty / exactly-one-of (T011) and resolveFillTarget offender parity
// with a single `fill` (T014). End-to-end behaviour is in
// tests/integration/batch-fill.spec.ts.

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebContents } from "electron";
import {
  fillBatch,
  resolveFillTarget,
  checkFillInputShape,
} from "../../src/main/page/interact.js";
import { InteractionLog } from "../../src/main/safety/interaction-log.js";
import { isHyppoError } from "../../src/main/errors.js";
import type { TargetDescriptor } from "../../src/main/safety/blocklist.js";

const log = new InteractionLog(mkdtempSync(join(tmpdir(), "hv-batch-")));

/** A WebContents stub whose executeJavaScript always yields `descriptor`. */
function wcResolving(descriptor: TargetDescriptor | null): WebContents {
  return {
    getURL: () => "http://fixture.test/form.html",
    executeJavaScript: async () => descriptor,
  } as unknown as WebContents;
}

const baseDescriptor: TargetDescriptor = {
  tagName: "input",
  type: "text",
  role: null,
  hasFormAncestor: false,
  name: "",
  autocomplete: null,
  isContentEditable: false,
};
const desc = (o: Partial<TargetDescriptor>): TargetDescriptor => ({ ...baseDescriptor, ...o });

async function expectRejected(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    throw new Error("expected the call to reject");
  } catch (e) {
    expect(isHyppoError(e)).toBe(true);
    return (e as Error).message;
  }
}

describe("fillBatch cap / empty guards (FR-003, T011)", () => {
  it("refuses an empty batch with an 'at least one' message and no targets breakdown", async () => {
    try {
      await fillBatch(wcResolving(desc({})), log, "tab-1", []);
      throw new Error("expected reject");
    } catch (e) {
      expect(isHyppoError(e)).toBe(true);
      const err = e as { code: string; message: string; details: { targets?: unknown } };
      expect(err.code).toBe("BATCH_REJECTED");
      expect(err.message.toLowerCase()).toContain("at least one");
      expect(err.details.targets).toBeUndefined();
    }
  });

  it("refuses an over-cap batch naming the cap and the count supplied", async () => {
    const fields = Array.from({ length: 51 }, (_, i) => ({
      selector: `#f${i}`,
      value: String(i),
    }));
    const msg = await expectRejected(fillBatch(wcResolving(desc({})), log, "tab-1", fields));
    expect(msg).toContain("50");
    expect(msg).toContain("51");
  });
});

describe("checkFillInputShape — exactly one of (selector,value) XOR fields (FR-001, T011)", () => {
  it("rejects a fill call that supplies BOTH a single target and fields", () => {
    const err = checkFillInputShape("#a", "x", [{ selector: "#b", value: "y" }]);
    expect(err && err.code).toBe("BATCH_REJECTED");
  });

  it("rejects a fill call that supplies NEITHER form", () => {
    const err = checkFillInputShape(undefined, undefined, undefined);
    expect(err && err.code).toBe("BATCH_REJECTED");
  });

  it("accepts a single-target fill and accepts a batch fill", () => {
    expect(checkFillInputShape("#a", "x", undefined)).toBeNull();
    expect(checkFillInputShape(undefined, undefined, [{ selector: "#a", value: "x" }])).toBeNull();
  });
});

describe("resolveFillTarget — offender parity with a single fill (FR-004, T014)", () => {
  it("returns ok for a plain text field", async () => {
    const r = await resolveFillTarget(wcResolving(desc({ type: "text", name: "first name" })), "#n");
    expect(r.ok).toBe(true);
  });

  it("returns a credential-field offender for a password input", async () => {
    const r = await resolveFillTarget(wcResolving(desc({ type: "password" })), "#pw");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offender.ruleId).toBe("credential-field");
  });

  it("returns an unsafe-fill-type offender for <select>, file input, and checkbox", async () => {
    for (const d of [
      desc({ tagName: "select", type: null }),
      desc({ tagName: "input", type: "file" }),
      desc({ tagName: "input", type: "checkbox" }),
    ]) {
      const r = await resolveFillTarget(wcResolving(d), "#x");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.offender.ruleId).toBe("unsafe-fill-type");
        expect(r.offender.reason && r.offender.reason.length).toBeGreaterThan(3);
      }
    }
  });

  it("returns a no-rule 'no element matches' offender for an unresolved selector", async () => {
    const r = await resolveFillTarget(wcResolving(null), "#gone");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.offender.ruleId).toBeUndefined();
      expect(r.offender.reason).toBe("no element matches");
    }
  });

  it("returns an external-act-label offender for outward-action wording", async () => {
    const r = await resolveFillTarget(wcResolving(desc({ name: "apply now" })), "#a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offender.ruleId).toBe("external-act-label");
  });
});

describe("resolveFillTarget gateActivation — precise rule id for the batch pre-check (T014)", () => {
  const submit = desc({ tagName: "button", type: "submit", name: "apply now", hasFormAncestor: true });
  // A consent checkbox whose label reads as consent but carries no external-act
  // word, so the fill blocklist alone would fall through to unsafe-fill-type.
  const consent = desc({
    tagName: "input",
    type: "checkbox",
    name: "i understand the privacy policy",
    hasFormAncestor: true,
  });
  const plainInForm = desc({ tagName: "input", type: "text", name: "first name", hasFormAncestor: true });

  it("attributes a submit control to submit-control, not unsafe-fill-type", async () => {
    const r = await resolveFillTarget(wcResolving(submit), "#s", { gateActivation: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offender.ruleId).toBe("submit-control");
  });

  it("attributes a consent checkbox to consent-toggle, not unsafe-fill-type", async () => {
    const r = await resolveFillTarget(wcResolving(consent), "#c", { gateActivation: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offender.ruleId).toBe("consent-toggle");
  });

  it("does NOT gate a plain value field inside a <form> (in-form never blocks a fill)", async () => {
    const r = await resolveFillTarget(wcResolving(plainInForm), "#f", { gateActivation: true });
    expect(r.ok).toBe(true);
  });

  it("without gateActivation, a consent checkbox is the generic unsafe-fill-type (single-fill parity)", async () => {
    const r = await resolveFillTarget(wcResolving(consent), "#c");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.offender.ruleId).toBe("unsafe-fill-type");
  });
});
