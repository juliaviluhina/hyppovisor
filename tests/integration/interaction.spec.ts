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

  // plain non-submit <button type="button"> inside the form: space is permitted,
  // and since constitution 1.4.0 (feature 011) so is click — it is a reveal
  // control, not a submission. See the US4 test with expander.html for the full
  // carve-out boundary.
  await callHandle(app, "focus", [tabId, "#addAnother"]);
  const btn = await callHandle(app, "interact", [tabId, "space"]);
  expect((btn as { outcome: string }).outcome).toBe("permitted");
  const clickBtn = await callHandle<{ outcome: string }>(app, "interact", [
    tabId,
    "click",
    "#addAnother",
  ]);
  expect(clickBtn.outcome).toBe("permitted");
  expect(readLog(logPath).at(-1)!.outcome).toBe("permitted");

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

// ─── feature 008 US5: actionable feedback for an unusable selector (T035) ─────

test("US5: a non-CSS selector returns INVALID_SELECTOR (not TARGET_NOT_FOUND) across the tool surface", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const BAD = "a:has-text('Apply')";

  for (const op of ["click", "fill", "scroll", "space", "list_options"] as const) {
    // scroll/space ignore the selector, but the others must reject it up front
    if (op === "scroll" || op === "space") continue;
    const msg = String(
      await callHandle(app, "interact", [tabId, op, BAD, "x"]).catch((e: Error) => e.message),
    );
    expect(msg, op).toContain("INVALID_SELECTOR");
    // the message names the unsupported forms and points at the discovery tools
    expect(msg, op).toContain(":has-text()");
    expect(msg, op).toContain("read_form_fields");
  }

  // choose_option too
  const chooseMsg = String(
    await callHandle(app, "interact", [tabId, "choose_option", BAD, undefined, "x"]).catch(
      (e: Error) => e.message,
    ),
  );
  expect(chooseMsg).toContain("INVALID_SELECTOR");

  // wait_for_selector too — and it does not spend the whole timeout window
  const t0 = Date.now();
  const waitMsg = String(
    await callHandle(app, "waitFor", [tabId, BAD, 5000]).catch((e: Error) => e.message),
  );
  expect(waitMsg).toContain("INVALID_SELECTOR");
  expect(Date.now() - t0).toBeLessThan(2000);

  // a VALID selector that matches nothing still → TARGET_NOT_FOUND
  const nf = String(
    await callHandle(app, "interact", [tabId, "click", "#definitely-not-here"]).catch(
      (e: Error) => e.message,
    ),
  );
  expect(nf).toContain("TARGET_NOT_FOUND");
  const nfWait = String(
    await callHandle(app, "waitFor", [tabId, "#definitely-not-here", 300]).catch(
      (e: Error) => e.message,
    ),
  );
  expect(nfWait).toContain("WAIT_TIMEOUT");
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

// ─── feature 011: form-fill fidelity ───────────────────────────────────────────

test("US1: a masked field fills via real key events and the response confirms it (SC-001)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/masked.html`]);

  const r = await callHandle<{ outcome: string; currentValue?: string }>(app, "interact", [
    tabId,
    "fill",
    "#start_date",
    "09/1992",
  ]);
  expect(r.outcome).toBe("permitted");
  expect(r.currentValue).toBe("09/1992");

  // an independent read-back proves the value actually stuck in the DOM
  const got = await callHandle<string>(app, "probe", [
    tabId,
    "document.querySelector('#start_date').value",
  ]);
  expect(got).toBe("09/1992");

  const phone = await callHandle<{ currentValue?: string }>(app, "interact", [
    tabId,
    "fill",
    "#phone",
    "5551234567",
  ]);
  expect(phone.currentValue).toBe("(555) 123-4567");
});

test("US1: a value the mask will not accept is WRITE_NOT_APPLIED, not a bare success (SC-002)", async () => {
  const logPath = await handleValue<string>(app, "logPath");
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/masked.html`]);

  const msg = String(
    await callHandle(app, "interact", [tabId, "fill", "#start_date", "Present"]).catch(
      (e: Error) => e.message,
    ),
  );
  expect(msg).toContain("WRITE_NOT_APPLIED");
  // the message carries the read-back value so the caller sees the field is empty
  expect(msg).toContain('the field still reads ""');

  const got = await callHandle<string>(app, "probe", [
    tabId,
    "document.querySelector('#start_date').value",
  ]);
  expect(got).toBe("");

  // the attempt is logged as an error, not permitted / refused
  const entries = readLog(logPath).filter(
    (e) => e.operation === "fill" && e.target === "#start_date",
  );
  expect(entries.at(-1)?.outcome).toBe("error");
});

test("US1: a plain unmasked field still fills and now returns currentValue (regression)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/masked.html`]);
  const r = await callHandle<{ outcome: string; currentValue?: string }>(app, "interact", [
    tabId,
    "fill",
    "#plain",
    "hello world",
  ]);
  expect(r.outcome).toBe("permitted");
  expect(r.currentValue).toBe("hello world");
});

test("US2: a plain field whose draft contains an outward-act word is still fillable (SC-003/SC-004)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  // #startup_q — innocuous own <label>, sits next to a submit button, id in the
  // CA_/submit_ shape. First draft lands.
  const first = await callHandle<{ outcome: string }>(app, "interact", [
    tabId,
    "fill",
    "#startup_q",
    "Yes — I applied to Y Combinator and joined an early-stage team.",
  ]);
  expect(first.outcome).toBe("permitted");

  // the revised draft must NOT be refused just because "apply" is now in the value
  const second = await callHandle<{ outcome: string }>(app, "interact", [
    tabId,
    "fill",
    "#startup_q",
    "Yes. I co-founded a startup and later applied that experience at a Series B company.",
  ]);
  expect(second.outcome).toBe("permitted");

  // read_form_fields agrees the verdict is still permitted
  const map = await callHandle<{
    records: Array<{ selector: string; fillVerdict: { verdict: string } }>;
  }>(app, "readFormFields", [tabId, undefined, { fields: ["#startup_q"] }]);
  expect(map.records[0]?.fillVerdict.verdict).toBe("permitted");
});

test("US2: a field whose OWN label reads as an outward act is still refused", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const msg = String(
    await callHandle(app, "interact", [tabId, "fill", "#submit_note", "anything"]).catch(
      (e: Error) => e.message,
    ),
  );
  expect(msg).toContain("REFUSED_EXTERNAL_ACT");
});

test("US3: a field's fill verdict is identical across repeated reads of an unchanged page (SC-005)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  await callHandle(app, "interact", [tabId, "fill", "#startup_q", "Applied and joined a startup."]);

  const verdicts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const map = await callHandle<{
      records: Array<{ fillVerdict: { verdict: string } }>;
    }>(app, "readFormFields", [tabId, undefined, { fields: ["#startup_q"] }]);
    verdicts.push(map.records[0]?.fillVerdict.verdict);
  }
  expect(new Set(verdicts)).toEqual(new Set(["permitted"]));
});

test("US3: fill then immediately fill again on the same selector is not refused (SC-006)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const a = await callHandle<{ outcome: string }>(app, "interact", [
    tabId,
    "fill",
    "#bio",
    "Posted a summary and applied for the role.",
  ]);
  const b = await callHandle<{ outcome: string }>(app, "interact", [
    tabId,
    "fill",
    "#bio",
    "Revised: shipped and published a redesign.",
  ]);
  expect(a.outcome).toBe("permitted");
  expect(b.outcome).toBe("permitted");
});

test("US4: an in-form non-submit reveal button is clickable; its sub-form becomes fillable (SC-007)", async () => {
  const logPath = await handleValue<string>(app, "logPath");
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/expander.html`]);
  const before = await callHandle<{ url: string }>(app, "read", [tabId]);

  // the "Add Experience" button: <button type="button">, no formaction, inside a
  // <form> that also has a submit control — permitted (constitution 1.4.0 / B1)
  const click = await callHandle<{ outcome: string }>(app, "interact", [
    tabId,
    "click",
    "#addExperience",
  ]);
  expect(click.outcome).toBe("permitted");
  expect(readLog(logPath).at(-1)).toMatchObject({
    operation: "click",
    target: "#addExperience",
    outcome: "permitted",
  });

  // the revealed sub-form's fields are now readable and fillable
  const revealed = await callHandle<boolean>(app, "probe", [
    tabId,
    "!document.getElementById('expSection').hidden",
  ]);
  expect(revealed).toBe(true);
  const fill = await callHandle<{ outcome: string }>(app, "interact", [
    tabId,
    "fill",
    "#exp_title",
    "Staff Engineer",
  ]);
  expect(fill.outcome).toBe("permitted");

  // no submission / navigation happened
  expect(await callHandle<boolean>(app, "probe", [tabId, "window.__submitted"])).toBe(false);
  expect((await callHandle<{ url: string }>(app, "read", [tabId])).url).toBe(before.url);
});

test("US4: submit / Save / formaction buttons inside the same form stay refused (SC-007/SC-009)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/expander.html`]);

  for (const sel of ["#submitBtn", "#saveDraftBtn", "#formActionBtn"]) {
    const msg = String(
      await callHandle(app, "interact", [tabId, "click", sel]).catch((e: Error) => e.message),
    );
    expect(msg, sel).toContain("REFUSED_EXTERNAL_ACT");
  }
});

test("US4: the reveal button is permitted even in a form with no submit control (B1, SC-007)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/expander.html`]);
  const click = await callHandle<{ outcome: string }>(app, "interact", [
    tabId,
    "click",
    "#addEducation",
  ]);
  expect(click.outcome).toBe("permitted");
  expect(
    await callHandle<boolean>(app, "probe", [tabId, "!document.getElementById('eduSection').hidden"]),
  ).toBe(true);
});
