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

// ─── feature 003: in-form fill + the Space key ────────────────────────────────

test("fill enters values into plain fields inside a <form> without submitting (US1, SC-001/SC-005)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const before = await callHandle<{ url: string }>(app, "read", [tabId]);

  const fields: Array<[string, string]> = [
    ["#first_name", "Iuliia"],
    ["#email", "iuliia@example.com"],
    ["#phone", "+49 30 123456"],
    ["#website", "https://example.com"],
    ["#age", "12"],
    ["#bio", "Two lines of bio."],
    ["#cover", "A short cover letter."],
  ];
  for (const [sel, val] of fields) {
    const r = await callHandle(app, "interact", [tabId, "fill", sel, val]);
    expect((r as { outcome: string }).outcome, sel).toBe("permitted");
    const got = await callHandle<string>(app, "probe", [
      tabId,
      `(() => { const el = document.querySelector(${JSON.stringify(sel)});
         return el.isContentEditable ? el.textContent : el.value; })()`,
    ]);
    expect(got, sel).toBe(val);
  }

  const submitted = await callHandle<boolean>(app, "probe", [tabId, "window.__submitted"]);
  expect(submitted).toBe(false);
  const after = await callHandle<{ url: string }>(app, "read", [tabId]);
  expect(after.url).toBe(before.url);
});

test("fill drives a React-style controlled input, not just the DOM attribute (US1, regression)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const r = await callHandle(app, "interact", [tabId, "fill", "#reactish", "Iuliia"]);
  expect((r as { outcome: string }).outcome).toBe("permitted");
  // the component's tracked state — not el.value — is what a framework renders from
  expect(await callHandle<string>(app, "probe", [tabId, "window.__reactishState"])).toBe("Iuliia");
});

test("fill replaces the existing value; repeated calls are idempotent (US1, FR-017)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  await callHandle(app, "interact", [tabId, "fill", "#first_name", "Iuliia"]);
  await callHandle(app, "interact", [tabId, "fill", "#first_name", "Xenia"]);
  await callHandle(app, "interact", [tabId, "fill", "#first_name", "Xenia"]);
  const got = await callHandle<string>(app, "probe", [
    tabId,
    "document.querySelector('#first_name').value",
  ]);
  expect(got).toBe("Xenia");
});

test("fill stays refused for file / select / combobox-container / consent / credential (US2, SC-002)", async () => {
  const logPath = await handleValue<string>(app, "logPath");
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const refusals: Array<[string, string, string | undefined, string]> = [
    ["click", "#submitBtn", undefined, "submit-control"],
    ["fill", "#resume", "x", "unsafe-fill-type"],
    ["fill", "#country", "de", "unsafe-fill-type"],
    ["fill", "#locationCombobox", "x", "unsafe-fill-type"],
    ["click", "#agree", undefined, "consent-toggle"],
    ["fill", "#password", "hunter2", "credential-field"],
  ];
  for (const [op, sel, val, ruleId] of refusals) {
    const args = val === undefined ? [tabId, op, sel] : [tabId, op, sel, val];
    const msg = await callHandle(app, "interact", args).catch((e: Error) => e.message);
    expect(String(msg), `${op} ${sel}`).toContain("REFUSED_EXTERNAL_ACT");
    const last = readLog(logPath).at(-1)!;
    expect(last.outcome, `${op} ${sel}`).toBe("refused");
    expect(last.ruleId, `${op} ${sel}`).toBe(ruleId);
  }

  const r = await callHandle<{ dom: string }>(app, "read", [tabId, true]);
  expect(r.dom).not.toContain("hunter2");
});

test("fill types a filter string into a combobox's text input (US2, FR-004)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const r = await callHandle(app, "interact", [tabId, "fill", "#locationInput", "Berlin"]);
  expect((r as { outcome: string }).outcome).toBe("permitted");
  expect(await callHandle<string>(app, "probe", [tabId, "document.querySelector('#locationInput').value"])).toBe(
    "Berlin",
  );
  expect(await callHandle<boolean>(app, "probe", [tabId, "window.__submitted"])).toBe(false);
  expect(await callHandle<string | null>(app, "probe", [tabId, "window.__chosenOption"])).toBe(null);
});

test("space activates the focused element under the click rules (US3, SC-003/SC-004)", async () => {
  const logPath = await handleValue<string>(app, "logPath");
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  // plain (non-consent) checkbox: permitted, toggles
  await callHandle(app, "focus", [tabId, "#remoteOnly"]);
  const n0 = readLog(logPath).length;
  const chk = await callHandle(app, "interact", [tabId, "space"]);
  expect((chk as { outcome: string }).outcome).toBe("permitted");
  expect(
    await callHandle<boolean>(app, "probe", [tabId, "document.querySelector('#remoteOnly').checked"]),
  ).toBe(true);
  const chkEntry = readLog(logPath).at(-1)!;
  expect(readLog(logPath).length).toBe(n0 + 1);
  expect(chkEntry.operation).toBe("space");
  expect(typeof chkEntry.target).toBe("string");

  // consent checkbox inside the form: refused with consent-toggle, same as a click
  await callHandle(app, "focus", [tabId, "#agree"]);
  const consent = await callHandle(app, "interact", [tabId, "space"]).catch((e: Error) => e.message);
  expect(String(consent)).toContain("REFUSED_EXTERNAL_ACT");
  expect(readLog(logPath).at(-1)!.ruleId).toBe("consent-toggle");

  // submit button: refused with submit-control, same as a click
  await callHandle(app, "focus", [tabId, "#submitBtn"]);
  const sub = await callHandle(app, "interact", [tabId, "space"]).catch((e: Error) => e.message);
  expect(String(sub)).toContain("REFUSED_EXTERNAL_ACT");
  expect(readLog(logPath).at(-1)!.ruleId).toBe("submit-control");

  // plain non-submit <button> inside the form: click is refused by in-form, space is permitted
  await callHandle(app, "focus", [tabId, "#addAnother"]);
  const btn = await callHandle(app, "interact", [tabId, "space"]);
  expect((btn as { outcome: string }).outcome).toBe("permitted");
  const clickBtn = await callHandle(app, "interact", [tabId, "click", "#addAnother"]).catch(
    (e: Error) => e.message,
  );
  expect(String(clickBtn)).toContain("REFUSED_EXTERNAL_ACT");
  expect(readLog(logPath).at(-1)!.ruleId).toBe("in-form");

  // text field: inserts one space, does not submit
  await callHandle(app, "interact", [tabId, "fill", "#first_name", "Ann"]);
  await callHandle(app, "focus", [tabId, "#first_name"]);
  await callHandle(app, "interact", [tabId, "space"]);
  expect(
    await callHandle<string>(app, "probe", [tabId, "document.querySelector('#first_name').value"]),
  ).toBe("Ann ");
  expect(await callHandle<boolean>(app, "probe", [tabId, "window.__submitted"])).toBe(false);

  // listbox option: permitted, option chosen
  await callHandle(app, "focus", [tabId, "#locationOptionBerlin"]);
  await callHandle(app, "interact", [tabId, "space"]);
  expect(await callHandle<string | null>(app, "probe", [tabId, "window.__chosenOption"])).toBe(
    "locationOptionBerlin",
  );

  // nothing focused: refused with a "no focused target" reason
  await callHandle(app, "blur", [tabId]);
  const none = await callHandle(app, "interact", [tabId, "space"]).catch((e: Error) => e.message);
  expect(String(none)).toContain("TARGET_NOT_FOUND");
  expect(String(none).toLowerCase()).toContain("focus");
  const noneEntry = readLog(logPath).at(-1)!;
  expect(noneEntry.outcome).toBe("refused");
  expect(noneEntry.ruleId).toBe(null);
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
