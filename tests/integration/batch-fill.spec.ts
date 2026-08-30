// Feature 004 — batch fill, end to end against the fixture app.
// US1 (T012): one call drafts a whole form; nothing submits; audited.
// US2/US3/US4 cases are added in their own phases.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { startFixtureServer, launchApp, callHandle } from "./helpers.js";
import type { ElectronApplication } from "@playwright/test";

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

function readLog(logPath: string) {
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const logPath = () =>
  app.evaluate(() => (globalThis as Record<string, unknown>).__hyppo).then(
    (h) => (h as { logPath: string }).logPath,
  );

async function probe<T>(tabId: string, expr: string): Promise<T> {
  return callHandle<T>(app, "probe", [tabId, expr]);
}

type BatchResult = {
  operation: string;
  outcome: string;
  fields: Array<{ selector: string; outcome: string; message?: string }>;
  summary: { requested: number; written: number; errored: number };
};

test("US1: one batch fill drafts a whole form, nothing submitted, audited (T012, SC-001/SC-004)", async () => {
  const lp = await logPath();
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const before = await callHandle<{ url: string }>(app, "read", [tabId]);
  const n0 = readLog(lp).length;

  const batch: Array<[string, string]> = [
    ["#first_name", "Iuliia"],
    ["#last_name", "Iliukhina"],
    ["#email", "iuliia@example.com"],
    ["#website", "https://example.com"],
    ["#age", "12"],
  ];
  const r = await callHandle<BatchResult>(app, "fillBatch", [tabId, batch]);

  expect(r.operation).toBe("fill");
  expect(r.outcome).toBe("permitted");
  expect(r.summary).toEqual({ requested: 5, written: 5, errored: 0 });
  expect(r.fields.map((f) => f.selector)).toEqual(batch.map(([s]) => s));
  expect(r.fields.every((f) => f.outcome === "permitted")).toBe(true);

  for (const [sel, val] of batch) {
    const got = await probe<string>(tabId, `document.querySelector(${JSON.stringify(sel)}).value`);
    expect(got, sel).toBe(val);
  }

  expect(await probe<boolean>(tabId, "window.__submitted")).toBe(false);
  const after = await callHandle<{ url: string }>(app, "read", [tabId]);
  expect(after.url).toBe(before.url);

  const entries = readLog(lp);
  expect(entries.length).toBe(n0 + 6);
  const added = entries.slice(-6);
  expect(added.slice(0, 5).map((e) => e.operation)).toEqual(Array(5).fill("fill"));
  expect(added.slice(0, 5).every((e) => e.outcome === "permitted")).toBe(true);
  const summary = added[5];
  expect(summary.operation).toBe("fill_batch");
  expect(summary.outcome).toBe("permitted");
  expect(summary.target).toBeNull();
  expect(summary.batch).toEqual({ requested: 5, written: 5, errored: 0, refused: 0 });
});

test("US1: values are applied in order — a duplicate selector ends with the last value (SC-007)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const r = await callHandle<BatchResult>(app, "fillBatch", [
    tabId,
    [
      ["#first_name", "A"],
      ["#first_name", "B"],
    ],
  ]);
  expect(r.outcome).toBe("permitted");
  expect(r.fields).toHaveLength(2);
  expect(await probe<string>(tabId, "document.querySelector('#first_name').value")).toBe("B");
});
