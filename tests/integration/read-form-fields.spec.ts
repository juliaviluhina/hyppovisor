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
