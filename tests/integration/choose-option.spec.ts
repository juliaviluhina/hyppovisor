// Feature 006 — choose_option, end to end against the fixture app.
// US1 (T015): native <select> inside a form.
// US2/US3/US4 cases are added in their own phases.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
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

function readLog(logPath: string) {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

const logPath = () => handleValue<string>(app, "logPath");
const probe = <T>(tabId: string, expr: string) => callHandle<T>(app, "probe", [tabId, expr]);

type ChooseResult = {
  operation: string;
  outcome: string;
  chosenOption?: { label: string; value: string };
};

/** e2e handle: interact(tabId, operation, selector?, value?, label?). */
const choose = (tabId: string, selector: string, opts: { label?: string; value?: string }) =>
  callHandle<ChooseResult>(app, "interact", [tabId, "choose_option", selector, opts.value, opts.label]);

test("US1: choose_option sets a native <select> by label and by value, nothing submitted (T015)", async () => {
  const lp = await logPath();
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
  const before = await callHandle<{ url: string }>(app, "read", [tabId]);

  const n0 = readLog(lp).length;
  const byLabel = await choose(tabId, "#country", { label: "United States" });
  expect(byLabel.operation).toBe("choose_option");
  expect(byLabel.outcome).toBe("permitted");
  expect(byLabel.chosenOption).toEqual({ label: "United States", value: "us" });
  expect(await probe<string>(tabId, `document.querySelector("#country").value`)).toBe("us");
  expect(await probe<boolean>(tabId, "window.__submitted")).toBe(false);

  // by value
  const byValue = await choose(tabId, "#country", { value: "de" });
  expect(byValue.chosenOption).toEqual({ label: "Germany", value: "de" });
  expect(await probe<string>(tabId, `document.querySelector("#country").value`)).toBe("de");

  // idempotent repeat
  const again = await choose(tabId, "#country", { value: "de" });
  expect(again.outcome).toBe("permitted");
  expect(await probe<string>(tabId, `document.querySelector("#country").value`)).toBe("de");

  const after = await callHandle<{ url: string }>(app, "read", [tabId]);
  expect(after.url).toBe(before.url);

  // one log line per call, all permitted, target "#country"
  const added = readLog(lp).slice(n0);
  expect(added.length).toBe(3);
  for (const e of added) {
    expect(e.operation).toBe("choose_option");
    expect(e.outcome).toBe("permitted");
    expect(e.target).toBe("#country");
    expect(e.ruleId).toBeNull();
  }
});

// ─── US2: custom combobox (T018) ─────────────────────────────────────────────

test("US2: a closed react-select combobox opens, selects, and closes again", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const r = await choose(tabId, "#closedCombo", { label: "Toronto, Canada" });
  expect(r.outcome).toBe("permitted");
  expect(r.chosenOption).toEqual({ label: "Toronto, Canada", value: "toronto" });
  expect(await probe<string>(tabId, `document.querySelector("#closedCombo").getAttribute("aria-expanded")`)).toBe(
    "false",
  );
  expect(await probe<string>(tabId, `document.querySelector("#closedComboValue").textContent`)).toBe(
    "Toronto, Canada",
  );
  expect(await probe<string>(tabId, "window.__chosen006.closedCombo")).toBe("toronto");
  expect(await probe<boolean>(tabId, "window.__submitted")).toBe(false);
});

test("US2: a filter combobox is narrowed by typing; a prefix-only label is not a match", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const ok = await choose(tabId, "#filterCombo", { label: "France" });
  expect(ok.outcome).toBe("permitted");
  expect(ok.chosenOption).toEqual({ label: "France", value: "fr" });
  expect(await probe<string>(tabId, "window.__chosen006.filterCombo")).toBe("fr");

  const prefix = await callHandle(app, "interact", [
    tabId,
    "choose_option",
    "#filterCombo",
    undefined,
    "Fran",
  ]).catch((e: Error) => e.message);
  expect(String(prefix)).toContain("CHOOSE_OPTION_FAILED");
  expect(String(prefix)).toContain("no-option-match");
  // nothing new selected
  expect(await probe<string>(tabId, "window.__chosen006.filterCombo")).toBe("fr");
});

test("US2: an already-open listbox combobox commits the option (aria-owns + descendant)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const loc = await choose(tabId, "#locationCombobox", { label: "Berlin, Germany" });
  expect(loc.outcome).toBe("permitted");
  expect(loc.chosenOption?.label).toBe("Berlin, Germany");
  expect(await probe<string | null>(tabId, "window.__chosenOption")).toBe("locationOptionBerlin");
  expect(await probe<boolean>(tabId, "window.__submitted")).toBe(false);

  const owned = await choose(tabId, "#ownedCombo", { label: "Oslo, Norway" });
  expect(owned.outcome).toBe("permitted");
  expect(owned.chosenOption).toEqual({ label: "Oslo, Norway", value: "oslo" });
  expect(await probe<string>(tabId, "window.__chosen006.ownedCombo")).toBe("oslo");
});

test("US2: an async list that never renders in budget is refused option-not-appeared", async () => {
  const small = await startFixtureServer();
  const fast = await launchApp({ HYPPO_CHOOSE_OPTION_WAIT_MS: "300" });
  try {
    const { tabId } = await callHandle<{ tabId: string }>(fast, "open", [`${small.base}/form.html`]);
    const before = await callHandle<string>(fast, "probe", [
      tabId,
      `document.querySelector("#asyncComboValue").textContent`,
    ]);
    const err = await callHandle(fast, "interact", [
      tabId,
      "choose_option",
      "#asyncCombo",
      undefined,
      "Late Option",
    ]).catch((e: Error) => e.message);
    expect(String(err)).toContain("CHOOSE_OPTION_FAILED");
    expect(String(err)).toContain("option-not-appeared");
    expect(
      await callHandle<string>(fast, "probe", [tabId, `document.querySelector("#asyncComboValue").textContent`]),
    ).toBe(before);
    expect(
      await callHandle<string>(fast, "probe", [
        tabId,
        `document.querySelector("#asyncCombo").getAttribute("aria-expanded")`,
      ]),
    ).toBe("false");
  } finally {
    await fast.close();
    small.server.close();
  }
});

// ─── US3: wrong / dangerous targets refuse, control unchanged (T021) ──────────

test("US3: every wrong or dangerous target refuses with its own code/reason, changes nothing", async () => {
  const lp = await logPath();
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const expectRefusal = async (
    args: (string | undefined)[],
    contains: string,
    logCheck: (e: Record<string, unknown>) => void,
  ) => {
    const n = readLog(lp).length;
    const msg = await callHandle(app, "interact", args).catch((e: Error) => e.message);
    expect(String(msg), args.join(" ")).toContain(contains);
    const after = readLog(lp);
    expect(after.length, `one log line for ${args.join(" ")}`).toBe(n + 1);
    const last = after.at(-1)!;
    expect(last.operation).toBe("choose_option");
    expect(last.outcome).toBe("refused");
    logCheck(last);
  };

  // not a chooser
  await expectRefusal(
    [tabId, "choose_option", "#first_name", undefined, "x"],
    "not-a-dropdown",
    (e) => expect(e.reason).toBe("not-a-dropdown"),
  );
  // submit control
  await expectRefusal(
    [tabId, "choose_option", "#submitBtn", undefined, "x"],
    "REFUSED_EXTERNAL_ACT",
    (e) => expect(e.ruleId).toBe("submit-control"),
  );
  // consent-worded <select>
  await expectRefusal(
    [tabId, "choose_option", "#marketingSelect", undefined, "Daily"],
    "REFUSED_EXTERNAL_ACT",
    (e) => expect(e.ruleId).toBe("external-act-label"),
  );
  // credential field
  await expectRefusal(
    [tabId, "choose_option", "#password", undefined, "x"],
    "REFUSED_EXTERNAL_ACT",
    (e) => expect(e.ruleId).toBe("credential-field"),
  );
  // no option match — control unchanged
  await expectRefusal(
    [tabId, "choose_option", "#country", undefined, "Atlantis"],
    "no-option-match",
    (e) => expect(e.reason).toBe("no-option-match"),
  );
  expect(await probe<string>(tabId, `document.querySelector("#country").value`)).toBe("");
  // ambiguous label — candidates, control unchanged
  await expectRefusal(
    [tabId, "choose_option", "#otherSelect", undefined, "Other"],
    "ambiguous-option",
    (e) => expect(e.reason).toBe("ambiguous-option"),
  );
  expect(await probe<string>(tabId, `document.querySelector("#otherSelect").value`)).toBe("");
  // disabled option
  await expectRefusal(
    [tabId, "choose_option", "#pronounSelect", undefined, "Prefer not to say"],
    "option-disabled",
    (e) => expect(e.reason).toBe("option-disabled"),
  );
  // multi-select
  await expectRefusal(
    [tabId, "choose_option", "#skillsSelect", undefined, "JavaScript"],
    "multi-select",
    (e) => expect(e.reason).toBe("multi-select"),
  );
  // creatable combobox, unknown label — no option created
  await expectRefusal(
    [tabId, "choose_option", "#creatableCombo", undefined, "Purple"],
    "no-option-match",
    (e) => expect(e.reason).toBe("no-option-match"),
  );
  expect(await probe<number>(tabId, `document.querySelectorAll("#creatableComboListbox [role='option']").length`)).toBe(2);

  // the disambiguating value makes the ambiguous case permitted
  const ok = await choose(tabId, "#otherSelect", { value: "other-a" });
  expect(ok.outcome).toBe("permitted");
  expect(ok.chosenOption).toEqual({ label: "Other", value: "other-a" });
  expect(await probe<string>(tabId, `document.querySelector("#otherSelect").value`)).toBe("other-a");
});

test("US3 SC-004: in-form does not gate choose_option, but still gates a raw click on the option", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  // #country is inside #theform — choose_option proceeds
  const ok = await choose(tabId, "#country", { label: "Germany" });
  expect(ok.outcome).toBe("permitted");

  // a raw click on an option element inside the same form is still refused by in-form
  const clickErr = await callHandle(app, "interact", [
    tabId,
    "click",
    "#locationOptionBerlin",
  ]).catch((e: Error) => e.message);
  expect(String(clickErr)).toContain("REFUSED_EXTERNAL_ACT");
  const lp = await logPath();
  expect(readLog(lp).at(-1)!.ruleId).toBe("in-form");
});

// ─── US4: audited and verifiable (T022, T023) ───────────────────────────────

test("US4: one permitted + one refused call grow the log by exactly two lines", async () => {
  const lp = await logPath();
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const n0 = readLog(lp).length;
  const ok = await choose(tabId, "#country", { label: "United States" });
  expect(ok.outcome).toBe("permitted");
  await callHandle(app, "interact", [tabId, "choose_option", "#country", undefined, "Nowhere"]).catch(
    () => {},
  );

  const added = readLog(lp).slice(n0);
  expect(added.length).toBe(2);
  expect(added.map((e) => e.outcome)).toEqual(["permitted", "refused"]);
  expect(added[0].operation).toBe("choose_option");
  expect(added[0].target).toBe("#country");
  expect(added[0].ruleId).toBeNull();
  expect(added[1].reason).toBe("no-option-match");

  // SC-002: after the permitted call the control reports the chosen value
  expect(await probe<string>(tabId, `document.querySelector("#country").value`)).toBe("us");
});

test("US4/T023: a widget that swallows the option click fails read-back, control unchanged", async () => {
  const lp = await logPath();
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  const n0 = readLog(lp).length;
  const err = await callHandle(app, "interact", [
    tabId,
    "choose_option",
    "#sabotageCombo",
    undefined,
    "Sabotage Option",
  ]).catch((e: Error) => e.message);
  expect(String(err)).toContain("CHOOSE_OPTION_FAILED");
  expect(String(err)).toContain("option-not-appeared");

  expect(await probe<string>(tabId, `document.querySelector("#sabotageComboValue").textContent`)).toBe(
    "",
  );
  expect(
    await probe<string>(tabId, `document.querySelector("#sabotageCombo").getAttribute("aria-expanded")`),
  ).toBe("false");

  const added = readLog(lp).slice(n0);
  expect(added.length).toBe(1);
  expect(added[0].outcome).toBe("refused");
  expect(added[0].reason).toBe("option-not-appeared");
});

test("SC-007: read_form_fields → choose_option → batch fill produces a draft, nothing submitted", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);

  // 005: discover the options for #country
  const map = await callHandle<FormFieldMap>(app, "readFormFields", [tabId, "#theform"]);
  const country = map.records.find((r) => r.selector === "#country")!;
  expect(country.kind).toBe("select");
  const wanted = country.options.find((o) => o.value !== "")!;

  // 006: choose that option
  const chose = await choose(tabId, "#country", { label: wanted.label });
  expect(chose.outcome).toBe("permitted");
  expect(await probe<string>(tabId, `document.querySelector("#country").value`)).toBe(wanted.value);

  // 004: batch fill the plain fields discovered as fill-permitted
  const plain = map.records
    .filter((r) => r.fillVerdict?.verdict === "permitted" && r.selector && r.visible && r.kind === "text")
    .slice(0, 4)
    .map((r) => [r.selector as string, "draft"] as [string, string]);
  const batch = await callHandle<{ outcome: string }>(app, "fillBatch", [tabId, plain]);
  expect(batch.outcome).toBe("permitted");

  expect(await probe<boolean>(tabId, "window.__submitted")).toBe(false);
});
