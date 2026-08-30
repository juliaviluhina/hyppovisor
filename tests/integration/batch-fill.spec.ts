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

// ─── US2: any forbidden / unresolved target refuses the whole batch ───────────

/**
 * Run a batch expected to be refused whole. Returns the rejection message and
 * the log lines the batch appended. The `targets[]` breakdown does not survive
 * the app.evaluate() boundary (only `.message` does), so per-offender detail is
 * verified against the persisted audit lines — which is exactly where FR-014
 * requires each offender to be recorded.
 */
async function expectWholeBatchRefused(
  tabId: string,
  fields: Array<[string, string]>,
): Promise<{ message: string; added: Array<Record<string, unknown>> }> {
  const lp = await logPath();
  const n0 = readLog(lp).length;
  const message = await callHandle(app, "fillBatch", [tabId, fields]).then(
    () => {
      throw new Error("expected the batch to be refused");
    },
    (e: Error) => e.message,
  );
  expect(message).toContain("BATCH_REJECTED");
  return { message, added: readLog(lp).slice(n0) };
}

test("US2: a batch with a credential + a file target is refused whole; both offenders named (T015, SC-003)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const { added } = await expectWholeBatchRefused(tabId, [
    ["#first_name", "Iuliia"],
    ["#password", "hunter2"],
    ["#email", "x@y.co"],
    ["#resume", "cv"],
  ]);

  // 2 per-offender fill/refused lines + 1 fill_batch/refused summary; no permitted line.
  expect(added).toHaveLength(3);
  const offenderLines = added.slice(0, 2);
  expect(offenderLines.map((e) => e.operation)).toEqual(["fill", "fill"]);
  expect(offenderLines.every((e) => e.outcome === "refused")).toBe(true);
  expect(
    Object.fromEntries(offenderLines.map((e) => [e.target, e.ruleId])),
  ).toEqual({ "#password": "credential-field", "#resume": "unsafe-fill-type" });

  const summary = added[2];
  expect(summary.operation).toBe("fill_batch");
  expect(summary.outcome).toBe("refused");
  expect(summary.batch).toEqual({ requested: 4, written: 0, errored: 0, refused: 2 });
  expect(added.some((e) => e.outcome === "permitted")).toBe(false);

  // nothing was written
  expect(await probe<string>(tabId, "document.querySelector('#first_name').value")).toBe("");
  expect(await probe<string>(tabId, "document.querySelector('#email').value")).toBe("");
  expect(await probe<boolean>(tabId, "window.__submitted")).toBe(false);
});

test("US2: a submit control, a consent toggle, or an unresolved selector each bounces the batch (T015)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const submit = await expectWholeBatchRefused(tabId, [
    ["#first_name", "A"],
    ["#submitBtn", "x"],
  ]);
  expect(submit.added.find((e) => e.target === "#submitBtn")?.ruleId).toBe("submit-control");

  const consent = await expectWholeBatchRefused(tabId, [
    ["#first_name", "A"],
    ["#agree", "x"],
  ]);
  expect(consent.added.find((e) => e.target === "#agree")?.ruleId).toBe("consent-toggle");

  const missing = await expectWholeBatchRefused(tabId, [
    ["#first_name", "A"],
    ["#does_not_exist", "x"],
  ]);
  const miss = missing.added.find((e) => e.target === "#does_not_exist")!;
  expect(miss.ruleId).toBeNull();
  expect(String(miss.error)).toContain("no element matches");

  // every one of the three left the form untouched
  expect(await probe<string>(tabId, "document.querySelector('#first_name').value")).toBe("");
});

// ─── US3: a mid-write failure is per-field, not fatal ────────────────────────

test("US3: a field removed mid-batch is error; the rest fill; batch outcome is partial (T017, SC-005)", async () => {
  const lp = await logPath();
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  // arm the fixture: the first #email `input` removes #phone from the DOM.
  await probe<boolean>(tabId, "window.__armPhoneRemoval = true");
  const n0 = readLog(lp).length;

  const r = await callHandle<BatchResult>(app, "fillBatch", [
    tabId,
    [
      ["#first_name", "A"],
      ["#email", "a@b.co"],
      ["#phone", "555"],
      ["#website", "https://z.co"],
      ["#age", "9"],
    ],
  ]);

  expect(r.outcome).toBe("partial");
  expect(r.summary).toEqual({ requested: 5, written: 4, errored: 1 });
  const bySelector = Object.fromEntries(r.fields.map((f) => [f.selector, f]));
  expect(bySelector["#phone"].outcome).toBe("error");
  expect(typeof bySelector["#phone"].message).toBe("string");
  expect(bySelector["#phone"].message!.length).toBeGreaterThan(0);
  for (const sel of ["#first_name", "#email", "#website", "#age"]) {
    expect(bySelector[sel].outcome, sel).toBe("permitted");
  }

  for (const [sel, val] of [
    ["#first_name", "A"],
    ["#email", "a@b.co"],
    ["#website", "https://z.co"],
    ["#age", "9"],
  ] as const) {
    expect(await probe<string>(tabId, `document.querySelector(${JSON.stringify(sel)}).value`)).toBe(
      val,
    );
  }
  expect(await probe<boolean>(tabId, "window.__submitted")).toBe(false);

  const added = readLog(lp).slice(n0);
  expect(added).toHaveLength(6);
  const perField = added.slice(0, 5);
  expect(perField.filter((e) => e.outcome === "permitted")).toHaveLength(4);
  const errLine = perField.find((e) => e.outcome === "error")!;
  expect(errLine.operation).toBe("fill");
  expect(errLine.target).toBe("#phone");
  expect(typeof errLine.error).toBe("string");
  const summary = added[5];
  expect(summary.operation).toBe("fill_batch");
  expect(summary.outcome).toBe("partial");
  expect(summary.batch).toEqual({ requested: 5, written: 4, errored: 1, refused: 0 });
});

// ─── US4: an oversized or empty batch is refused ─────────────────────────────

test("US4: an empty batch is refused with an 'at least one' message; one summary line, nothing written (T019, SC-006)", async () => {
  const lp = await logPath();
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const n0 = readLog(lp).length;

  const message = await callHandle(app, "fillBatch", [tabId, []]).then(
    () => {
      throw new Error("expected the empty batch to be refused");
    },
    (e: Error) => e.message,
  );
  expect(message).toContain("BATCH_REJECTED");
  expect(message.toLowerCase()).toContain("at least one");

  const added = readLog(lp).slice(n0);
  expect(added).toHaveLength(1);
  expect(added[0].operation).toBe("fill_batch");
  expect(added[0].outcome).toBe("refused");
  expect(added[0].batch).toEqual({ requested: 0, written: 0, errored: 0, refused: 0 });
  expect(await probe<string>(tabId, "document.querySelector('#first_name').value")).toBe("");
});

test("US4: a batch over the 50-pair cap is refused naming the cap and the count; nothing written (T019, SC-006)", async () => {
  const lp = await logPath();
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const n0 = readLog(lp).length;

  // 51 well-formed, resolvable pairs — the cap check fires before the pre-write pass.
  const oversized: Array<[string, string]> = Array.from({ length: 51 }, () => [
    "#first_name",
    "x",
  ]);
  const message = await callHandle(app, "fillBatch", [tabId, oversized]).then(
    () => {
      throw new Error("expected the oversized batch to be refused");
    },
    (e: Error) => e.message,
  );
  expect(message).toContain("BATCH_REJECTED");
  expect(message).toContain("50");
  expect(message).toContain("51");

  const added = readLog(lp).slice(n0);
  expect(added).toHaveLength(1);
  expect(added[0].operation).toBe("fill_batch");
  expect(added[0].outcome).toBe("refused");
  expect(added[0].batch).toEqual({ requested: 51, written: 0, errored: 0, refused: 0 });
  expect(await probe<string>(tabId, "document.querySelector('#first_name').value")).toBe("");
});
