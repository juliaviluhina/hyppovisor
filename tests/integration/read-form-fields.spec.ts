// Feature 005 — structured form-field reader, end to end against the fixture app.
// US1 (T012): one call returns the field map, inline, with no side effects.
// US2/US3/US4 cases are added in their own phases.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { startFixtureServer, launchApp, callHandle, handleValue } from "./helpers.js";
import type { ElectronApplication } from "@playwright/test";
import type { FormFieldMap } from "../../src/shared/types.js";

let app: ElectronApplication;
let server: Server;
let base: string;

test.beforeAll(async () => {
  ({ server, base } = await startFixtureServer());
  app = await launchApp();
});
test.afterAll(async () => {
  await app.close();
  server.close();
});

function readLogLen(logPath: string): number {
  try {
    return readFileSync(logPath, "utf8").split("\n").filter(Boolean).length;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
}

async function probe<T>(tabId: string, expr: string): Promise<T> {
  return callHandle<T>(app, "probe", [tabId, expr]);
}

const read = (tabId: string, container?: string) =>
  callHandle<FormFieldMap>(app, "readFormFields", container === undefined ? [tabId] : [tabId, container]);

// Labelable field kinds — the "real fields" SC-001 is about. Container comboboxes,
// bare listboxes, and generic buttons legitimately carry no <label>.
const LABELABLE = new Set(["text", "textarea", "select", "checkbox", "radio", "file"]);

test("US1: one call returns an ordered field map with working selectors and labels (T012, SC-001/SC-002)", async () => {
  const logPath = await handleValue<string>(app, "logPath");
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  // pre-fill a control so its record reports currentValue (US1 scenario 3)
  await probe(tabId, `(document.querySelector('#age').value = '42', 1)`);

  const n0 = readLogLen(logPath);
  const map = await read(tabId);

  expect(map.tabId).toBe(tabId);
  expect(map.url).toContain("/form.html");
  expect(typeof map.observedAt).toBe("string");
  expect(map.truncated).toBe(false);
  expect(map.records.length).toBeGreaterThan(8);

  // document order: known controls appear in source order
  const sels = map.records.map((r) => r.selector);
  const idx = (s: string) => sels.indexOf(s);
  expect(idx("#name")).toBeGreaterThanOrEqual(0);
  expect(idx("#name")).toBeLessThan(idx("#email"));
  expect(idx("#email")).toBeLessThan(idx("#submitBtn"));
  expect(idx("#submitBtn")).toBeLessThan(idx("#other_field"));

  // every visible control: non-null selector + a kind; labelable ones have a label
  for (const r of map.records) {
    if (!r.visible) continue;
    expect(r.selector, JSON.stringify(r)).not.toBeNull();
    expect(r.kind).toBeTruthy();
    if (LABELABLE.has(r.kind)) {
      expect(r.label.length, `${r.selector} label`).toBeGreaterThan(0);
    }
  }

  // every non-null selector resolves to exactly one element at call time (SC-002)
  for (const r of map.records) {
    if (r.selector == null) continue;
    const count = await probe<number>(
      tabId,
      `document.querySelectorAll(${JSON.stringify(r.selector)}).length`,
    );
    expect(count, r.selector).toBe(1);
  }

  // the id-less/name-less "Middle name" input got a synthesised structural selector
  const middle = map.records.find((r) => r.label === "Middle name");
  expect(middle).toBeTruthy();
  expect(middle!.selectorSynthesised).toBe(true);
  expect(middle!.selector).toContain(":nth-of-type(");

  // a pre-filled control reports its value (US1 scenario 3)
  const age = map.records.find((r) => r.selector === "#age")!;
  expect(age.currentValue).toBe("42");

  // no interaction-log entry for a read (US1 scenario 4, FR-014)
  expect(readLogLen(logPath)).toBe(n0);

  // one payload, no spill-to-file; nothing written to the shared data dir (SC-003/SC-007)
  const userData = await app.evaluate(async ({ app }) => app.getPath("userData"));
  const files = readdirSync(userData);
  expect(files.filter((f) => /capture|page|content|tool-results/i.test(f))).toEqual([]);
});

// ─── US2: verdicts match interact exactly (T015, SC-004/SC-005) ────────────────

test("US2: each control's fill / click verdict matches what interact returns", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const map = await read(tabId);
  const rec = (sel: string) => map.records.find((r) => r.selector === sel)!;

  // submit button — refused both ways, submit-control
  expect(rec("#submitBtn").fillVerdict).toMatchObject({ verdict: "refused" });
  expect(rec("#submitBtn").clickVerdict).toMatchObject({
    verdict: "refused",
    ruleId: "submit-control",
  });

  // password — fill refused credential-field, and NO currentValue key (SC-005)
  const pw = rec("#password");
  expect(pw.fillVerdict).toMatchObject({ verdict: "refused", ruleId: "credential-field" });
  expect("currentValue" in pw).toBe(false);

  // file input — fill refused unsafe-fill-type
  expect(rec("#resume").fillVerdict).toMatchObject({
    verdict: "refused",
    ruleId: "unsafe-fill-type",
  });

  // in-form consent checkbox — click refused consent-toggle; fill refused by the
  // wording rule (interact's fill path sees "agree" → external-act-label)
  expect(rec("#agree").clickVerdict).toMatchObject({
    verdict: "refused",
    ruleId: "consent-toggle",
  });
  expect(rec("#agree").fillVerdict.verdict).toBe("refused");

  // plain value fields inside #theform — fill permitted, click refused in-form
  for (const sel of ["#first_name", "#email", "#phone", "#website", "#age", "#bio", "#cover"]) {
    expect(rec(sel).fillVerdict, sel).toEqual({ verdict: "permitted" });
    expect(rec(sel).clickVerdict, sel).toMatchObject({ verdict: "refused", ruleId: "in-form" });
  }

  // cross-check a sample against a real interact call (SC-004)
  const submitErr = await callHandle(app, "interact", [tabId, "click", "#submitBtn"]).catch(
    (e: Error) => e.message,
  );
  expect(String(submitErr)).toContain("REFUSED_EXTERNAL_ACT");

  const pwErr = await callHandle(app, "interact", [tabId, "fill", "#password", "x"]).catch(
    (e: Error) => e.message,
  );
  expect(String(pwErr)).toContain("REFUSED_EXTERNAL_ACT");

  const fileErr = await callHandle(app, "interact", [tabId, "fill", "#resume", "x"]).catch(
    (e: Error) => e.message,
  );
  expect(String(fileErr)).toContain("REFUSED_EXTERNAL_ACT");

  const okFill = await callHandle<{ outcome: string }>(app, "interact", [
    tabId,
    "fill",
    "#first_name",
    "Iuliia",
  ]);
  expect(okFill.outcome).toBe("permitted");
});

// ─── US3: dropdown options (T018, SC-006) ─────────────────────────────────────

test("US3: <select> lists every option; a combobox lists in-DOM options, none when absent", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  let map = await read(tabId);
  const country = map.records.find((r) => r.selector === "#country")!;
  expect(country.kind).toBe("select");
  expect(country.optionsAvailable).toBe(true);
  expect(country.optionsTruncated).toBe(false);
  expect(country.options).toEqual([
    { label: "Select…", value: "" },
    { label: "Germany", value: "de" },
    { label: "United States", value: "us" },
  ]);

  const combo = map.records.find((r) => r.selector === "#locationCombobox")!;
  expect(combo.optionsAvailable).toBe(true);
  expect(combo.options.map((o) => o.label)).toEqual(["Berlin, Germany", "Munich, Germany"]);

  // remove the option elements from the DOM → the reader reports none available
  await probe(
    tabId,
    `document.querySelectorAll('#locationListbox [role="option"]').forEach((n) => n.remove())`,
  );
  map = await read(tabId);
  const closed = map.records.find((r) => r.selector === "#locationCombobox")!;
  expect(closed.options).toEqual([]);
  expect(closed.optionsAvailable).toBe(false);
});

// ─── US4: container scoping and an oversized page (T020) ──────────────────────

test("US4: a container selector scopes the read; an unresolved container errors", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const other = await read(tabId, "#otherform");
  expect(other.records.map((r) => r.selector)).toEqual(["#other_field"]);

  const scoped = await read(tabId, "#theform");
  const sels = scoped.records.map((r) => r.selector);
  for (const outside of ["#safeBtn", "#connectLink", "#saveBtn", "#tos", "#remoteOnly", "#other_field"]) {
    expect(sels, outside).not.toContain(outside);
  }
  // controls that ARE inside #theform are present
  for (const inside of ["#name", "#first_name", "#country", "#resume", "#submitBtn"]) {
    expect(sels, inside).toContain(inside);
  }

  const err = await callHandle(app, "readFormFields", [tabId, "#no-such-container"]).catch(
    (e: Error) => e.message,
  );
  expect(String(err)).toContain("TARGET_NOT_FOUND");
});

test("SC-008: a batch built from only the reader's permitted selectors passes 004's pre-write check", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const map = await read(tabId);

  const batch = map.records
    .filter((r) => r.selector != null && r.fillVerdict.verdict === "permitted" && r.visible)
    .map((r) => [r.selector as string, "sample"] as [string, string]);
  expect(batch.length).toBeGreaterThan(3);

  const r = await callHandle<{ outcome: string; summary: { requested: number; written: number; errored: number } }>(
    app,
    "fillBatch",
    [tabId, batch],
  );
  expect(r.outcome).toBe("permitted");
  expect(r.summary).toEqual({ requested: batch.length, written: batch.length, errored: 0 });
});

test("US4: more controls than the cap truncates to the first cap-many with the flag", async () => {
  const small = await startFixtureServer();
  const capped = await launchApp({ HYPPO_FORM_FIELD_CONTROL_CAP: "4" });
  try {
    const { tabId } = await callHandle<{ tabId: string }>(capped, "open", [
      `${small.base}/form.html`,
    ]);
    const map = await callHandle<FormFieldMap>(capped, "readFormFields", [tabId]);
    expect(map.truncated).toBe(true);
    expect(map.records.length).toBe(4);
    // the first four in document order: #name, #password, #first_name, #last_name
    expect(map.records.map((r) => r.selector)).toEqual([
      "#name",
      "#password",
      "#first_name",
      "#last_name",
    ]);
  } finally {
    await capped.close();
    small.server.close();
  }
});
