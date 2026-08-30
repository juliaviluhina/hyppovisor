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
