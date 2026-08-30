// Feature 006 — choose_option, end to end against the fixture app.
// US1 (T015): native <select> inside a form.
// US2/US3/US4 cases are added in their own phases.

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
