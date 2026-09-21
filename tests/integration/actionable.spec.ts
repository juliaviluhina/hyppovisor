// Feature 027 — actionable snapshot end to end against fixture pages:
// one atomic call returns the indexed table + text, refused markers agree
// with interact, omissions are counted, and snapshot indices address
// interact targets with stale rejection. Ranking (US2) stays a unit +
// manual concern — it needs TYPESAFE_API_KEY (research.md R6).

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { startFixtureServer, launchApp, callHandle, handleValue } from "./helpers.js";
import type { ElectronApplication } from "@playwright/test";
import type { ActionableSnapshot } from "../../src/shared/types.js";

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

const read = (tabId: string) => callHandle<ActionableSnapshot>(app, "readActionable", [tabId]);

async function probe<T>(tabId: string, expr: string): Promise<T> {
  return callHandle<T>(app, "probe", [tabId, expr]);
}

function lastLogEntry(logPath: string): Record<string, unknown> {
  const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

test("US1: one call returns the indexed table plus text, atomically (T012, FR-001/FR-004)", async () => {
  const logPath = await handleValue<string>(app, "logPath");
  const logLen = () => {
    try {
      return readFileSync(logPath, "utf8").split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };
  const n0 = logLen();
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/actionable/content.html`]);

  const snap = await read(tabId);

  expect(snap.tabId).toBe(tabId);
  expect(snap.url).toContain("/actionable/content.html");
  expect(typeof snap.observedAt).toBe("string");
  expect(snap.generation).toMatch(/^[0-9a-f]{64}$/);
  // From, Where to?, Departure, Search (refused), Show more, 2 links, 1 checkbox.
  expect(snap.elements.length).toBe(8);
  expect(snap.elements.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

  const dest = snap.elements.find((e) => e.label === "Where to?");
  expect(dest).toMatchObject({ role: "textbox", marker: "actionable", value: "" });
  expect(dest!.operations).toContain("fill");

  const submit = snap.elements.find((e) => e.label === "Search flights");
  expect(submit).toMatchObject({ marker: "refused", operations: [] });

  expect(snap.text.text).toContain("Search flights");
  expect(snap.text.truncated).toBe(false);
  expect(snap.ranking).toBeNull();
  expect(snap.rankingStatus).toBeNull();
  // Disabled button excluded and counted; the payload carries no selectors.
  expect(snap.omissions.hiddenNodes).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(snap)).not.toContain("#from");

  // Determinism: an unchanged page re-reads identically (SC-003).
  const again = await read(tabId);
  expect(again.generation).toBe(snap.generation);
  expect(again.elements).toEqual(snap.elements);

  // A read writes no audit entry.
  expect(logLen()).toBe(n0);
});

test("sensitive controls are listed refused with values omitted (FR-002, clarify Q1)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/actionable/sensitive.html`,
  ]);
  const snap = await read(tabId);

  const password = snap.elements.find((e) => e.label === "Password");
  expect(password?.marker).toBe("refused");
  expect(password).not.toHaveProperty("value");

  const terms = snap.elements.find((e) => /terms and conditions/i.test(e.label));
  expect(terms?.marker).toBe("refused");

  const email = snap.elements.find((e) => e.label === "Email");
  expect(email?.marker).toBe("actionable");

  const signin = snap.elements.find((e) => e.label === "Sign in");
  expect(signin?.marker).toBe("refused");
});

test("edgelist pages: empty table and over-budget trimming are explicit (FR-004)", async () => {
  const { tabId: article } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/actionable/article.html`,
  ]);
  const pure = await read(article);
  expect(pure.elements).toEqual([]);
  expect(pure.text.text).toContain("quiet essay");
  expect(pure.omissions).toEqual({ hiddenNodes: 0, overBudgetElements: 0, textTruncated: false });

  const { tabId: big } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/actionable/oversized.html`,
  ]);
  const snap = await read(big);
  // Below-fold controls are offscreen-excluded (counted as hiddenNodes), not
  // over-budget: the table holds exactly the in-viewport entries, densely numbered.
  expect(snap.elements.length).toBeLessThan(300);
  expect(snap.omissions.hiddenNodes).toBeGreaterThan(0);
  expect(snap.elements.length + snap.omissions.hiddenNodes).toBe(300);
  expect(snap.omissions.overBudgetElements).toBe(0);
  expect(snap.elements.map((e) => e.index)).toEqual(
    snap.elements.map((_, i) => i + 1),
  );
});

test("US3: snapshot indices address interact; stale refs reject, refusals hold (FR-005/FR-009)", async () => {
  const logPath = await handleValue<string>(app, "logPath");
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/actionable/content.html`,
  ]);
  const snap = await read(tabId);
  const dest = snap.elements.find((e) => e.label === "Where to?")!;

  // A fresh index fills exactly like a selector, and the audit log names #N.
  await callHandle(app, "interact", [tabId, "fill", undefined, "London", undefined, { generation: snap.generation, index: dest.index }]);
  expect(await probe<string>(tabId, `(document.querySelector('#to').value)`)).toBe("London");
  expect(lastLogEntry(logPath).target).toBe(`#${dest.index}`);

  // A refused entry refuses through the index too.
  const submit = snap.elements.find((e) => e.label === "Search flights")!;
  const refused = await callHandle(app, "interact", [
    tabId,
    "click",
    undefined,
    undefined,
    undefined,
    { generation: snap.generation, index: submit.index },
  ]).catch((e: Error) => e.message);
  expect(refused).toMatch(/REFUSED_EXTERNAL_ACT/);

  // After navigation the old generation is stale — never reinterpreted.
  await callHandle(app, "navigate", [tabId, `${base}/actionable/article.html`]);
  const stale = await callHandle(app, "interact", [
    tabId,
    "click",
    undefined,
    undefined,
    undefined,
    { generation: snap.generation, index: dest.index },
  ]).catch((e: Error) => e.message);
  expect(stale).toMatch(/TARGET_NOT_FOUND/);
  expect(stale).toMatch(/stale/);
});
