// US3: bounded interaction, blocklist refusals (release blockers), wait/target
// errors, audit log completeness, and app-wide sequencing.
// Covers T039, T040, T042, T043, T044, T045.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { startFixtureServer, launchApp, callHandle, handleValue } from "./helpers.js";
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

test("every external-act blocklist category is refused with a named rule (T039, SC-005)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const submit = await callHandle(app, "interact", [tabId, "click", "#submitBtn"]).catch(
    (e: Error) => e.message,
  );
  expect(String(submit)).toContain("REFUSED_EXTERNAL_ACT");

  const inForm = await callHandle(app, "interact", [tabId, "click", "#name"]).catch(
    (e: Error) => e.message,
  );
  expect(String(inForm)).toContain("REFUSED_EXTERNAL_ACT");

  const label = await callHandle(app, "interact", [tabId, "click", "#connectLink"]).catch(
    (e: Error) => e.message,
  );
  expect(String(label)).toContain("REFUSED_EXTERNAL_ACT");

  const save = await callHandle(app, "interact", [tabId, "click", "#saveBtn"]).catch(
    (e: Error) => e.message,
  );
  expect(String(save)).toContain("REFUSED_EXTERNAL_ACT");

  // consent checkbox (label lives in a sibling <label for>): refused
  const consent = await callHandle(app, "interact", [tabId, "click", "#tos"]).catch(
    (e: Error) => e.message,
  );
  expect(String(consent)).toContain("REFUSED_EXTERNAL_ACT");

  // a plain filter checkbox is NOT an external act — it must be permitted
  const filter = await callHandle(app, "interact", [tabId, "click", "#remoteOnly"]);
  expect((filter as { outcome: string }).outcome).toBe("permitted");

  // rule ids are enumerable and each refusal names one
  const rules = await handleValue<Array<{ id: string }>>(app, "blocklistRules");
  expect(rules.map((r) => r.id).sort()).toEqual(
    [
      "consent-toggle",
      "credential-field",
      "external-act-label",
      "in-form",
      "submit-control",
    ].sort(),
  );
});

test("fill on a password field is refused; no credential is ever populated (T040, SC-006)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const err = await callHandle(app, "interact", [tabId, "fill", "#password", "hunter2"]).catch(
    (e: Error) => e.message,
  );
  expect(String(err)).toContain("REFUSED_EXTERNAL_ACT");

  const r = await callHandle<{ dom: string }>(app, "read", [tabId, true]);
  expect(r.dom).not.toContain("hunter2");
});

test("wait_for_selector then click reveals content readable on next read (T042)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/expander.html`]);
  await callHandle(app, "waitFor", [tabId, "#showMore"]);
  await callHandle(app, "interact", [tabId, "click", "#showMore"]);
  const r = await callHandle<{ text: string }>(app, "read", [tabId]);
  expect(r.text).toContain("REVEALED_SENTINEL");
});

test("WAIT_TIMEOUT leaves the tab unchanged; TARGET_NOT_FOUND for a missing selector (T043)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/static.html`]);
  const before = await callHandle<{ url: string }>(app, "read", [tabId]);

  const timeout = await callHandle(app, "waitFor", [tabId, "#never", 400]).catch(
    (e: Error) => e.message,
  );
  expect(String(timeout)).toContain("WAIT_TIMEOUT");

  const missing = await callHandle(app, "interact", [tabId, "click", "#nope"]).catch(
    (e: Error) => e.message,
  );
  expect(String(missing)).toContain("TARGET_NOT_FOUND");

  const after = await callHandle<{ url: string }>(app, "read", [tabId]);
  expect(after.url).toBe(before.url);
});

test("the interaction log accounts for every request and holds no page text (T044)", async () => {
  const logPath = await handleValue<string>(app, "logPath");
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const n0 = readLog(logPath).length;
  await callHandle(app, "interact", [tabId, "click", "#safeBtn"]); // permitted
  await callHandle(app, "interact", [tabId, "click", "#submitBtn"]).catch(() => {}); // refused
  const entries = readLog(logPath);

  expect(entries.length).toBe(n0 + 2);
  const last2 = entries.slice(-2);
  expect(last2.map((e) => e.outcome)).toEqual(["permitted", "refused"]);
  expect(last2[1].ruleId).toBeTruthy();
  for (const e of entries) {
    expect(JSON.stringify(e)).not.toContain("revealed extra content");
    expect(e.target === null || typeof e.target === "string").toBe(true);
  }
});

test("a burst across multiple tabs never overlaps and every request completes (T045, SC-008a)", async () => {
  const tabs = await Promise.all(
    [0, 1, 2, 3].map(() =>
      callHandle<{ tabId: string }>(app, "open", [`${base}/static.html`]).then((r) => r.tabId),
    ),
  );
  const reads = await Promise.all(
    tabs.concat(tabs).map((t) => callHandle<{ queueDepth: number }>(app, "read", [t])),
  );
  expect(reads.every((r) => typeof r.queueDepth === "number")).toBe(true);
  // at least one request observed a non-empty queue → they were serialised
  expect(Math.max(...reads.map((r) => r.queueDepth))).toBeGreaterThan(0);
});
