// Feature 008 US1 (T009) — `interact { operation: "list_options" }`, end to end.
// A read-only enumeration: it returns a dropdown's choices without selecting
// anything, without changing the control, and WITHOUT an interaction-log entry.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { startFixtureServer, launchApp, callHandle, handleValue } from "./helpers.js";
import type { ElectronApplication } from "@playwright/test";
import type { ListedOption } from "../../src/shared/types.js";

type ListOptionsResp = {
  selector: string;
  options: ListedOption[];
  optionsPresent: boolean;
  optionsTruncated: boolean;
};

function readLogLen(logPath: string): number {
  try {
    return readFileSync(logPath, "utf8").split("\n").filter(Boolean).length;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
}

test.describe("list_options", () => {
  let app: ElectronApplication;
  let server: Server;
  let base: string;

  test.beforeAll(async () => {
    ({ server, base } = await startFixtureServer());
    // A short option-wait so the never-populating widget resolves fast.
    app = await launchApp({ HYPPO_CHOOSE_OPTION_WAIT_MS: "500" });
  });
  test.afterAll(async () => {
    await app.close();
    server.close();
  });

  const list = (tabId: string, selector: string) =>
    callHandle<ListOptionsResp>(app, "interact", [tabId, "list_options", selector]);
  const probe = <T>(tabId: string, expr: string) => callHandle<T>(app, "probe", [tabId, expr]);

  test("scripted widget: every option + disabled flags; control unchanged; no audit entry", async () => {
    const logPath = await handleValue<string>(app, "logPath");
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/combobox.html`]);

    const n0 = readLogLen(logPath);
    const r = await list(tabId, "#roleCombo");

    expect(r.selector).toBe("#roleCombo");
    expect(r.optionsPresent).toBe(true);
    expect(r.optionsTruncated).toBe(false);
    expect(r.options).toEqual([
      { label: "Frontend Engineer", value: "fe", disabled: false },
      { label: "Backend Engineer", value: "be", disabled: false },
      { label: "Staff Engineer", value: "staff", disabled: true },
    ]);

    // the control's value-mirror is untouched and the menu is left closed
    expect(await probe<string>(tabId, `document.querySelector('#q_role').value`)).toBe("");
    expect(await probe<string>(tabId, `document.querySelector('#roleComboValue').textContent`)).toBe("");
    expect(
      await probe<string>(tabId, `document.querySelector('#roleCombo').getAttribute('aria-expanded')`),
    ).toBe("false");

    // a read writes NO interaction-log entry (FR-006, R1)
    expect(readLogLen(logPath)).toBe(n0);
  });

  test("native <select>: options returned with optionsPresent:true, value unchanged", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/combobox.html`]);
    const r = await list(tabId, "#plainSelect");
    expect(r.optionsPresent).toBe(true);
    expect(r.options).toEqual([
      { label: "Choose…", value: "", disabled: false },
      { label: "Engineering", value: "eng", disabled: false },
      { label: "Design", value: "design", disabled: false },
      { label: "Operations", value: "ops", disabled: true },
    ]);
    expect(await probe<string>(tabId, `document.querySelector('#plainSelect').value`)).toBe("");
  });

  test("a plain <div> and a <select multiple> are refused not-a-dropdown", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/combobox.html`]);

    const divErr = await list(tabId, "#plainDiv").catch((e: Error) => e.message);
    expect(String(divErr)).toContain("CHOOSE_OPTION_FAILED");
    expect(String(divErr)).toContain("not-a-dropdown");

    const multiErr = await list(tabId, "#multiSelect").catch((e: Error) => e.message);
    expect(String(multiErr)).toContain("CHOOSE_OPTION_FAILED");
    expect(String(multiErr)).toContain("not-a-dropdown");
  });

  test("a widget that never populates: options: [], optionsPresent: false, no error", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/combobox.html`]);
    const r = await list(tabId, "#deadCombo");
    expect(r.options).toEqual([]);
    expect(r.optionsPresent).toBe(false);
    expect(r.optionsTruncated).toBe(false);
    // menu left closed
    expect(
      await probe<string>(tabId, `document.querySelector('#deadCombo').getAttribute('aria-expanded')`),
    ).toBe("false");
  });

  test("blocklist parity: submit / consent / credential targets refused exactly as choose_option", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/combobox.html`]);

    for (const sel of ["#csubmit", "#cagree", "#cpassword"]) {
      const listErr = String(await list(tabId, sel).catch((e: Error) => e.message));
      const chooseErr = String(
        await callHandle(app, "interact", [tabId, "choose_option", sel, undefined, "x"]).catch(
          (e: Error) => e.message,
        ),
      );
      expect(listErr, sel).toContain("REFUSED_EXTERNAL_ACT");
      expect(chooseErr, sel).toContain("REFUSED_EXTERNAL_ACT");
      // same rule → identical refusal text once the operation name is normalised
      expect(listErr.replace(/list_options/g, "OP"), sel).toBe(
        chooseErr.replace(/choose_option/g, "OP"),
      );
    }
  });

  test("across every call above, the interaction log gained nothing", async () => {
    const logPath = await handleValue<string>(app, "logPath");
    const before = readLogLen(logPath);
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/combobox.html`]);
    await list(tabId, "#roleCombo");
    await list(tabId, "#plainSelect");
    await list(tabId, "#deadCombo");
    await list(tabId, "#plainDiv").catch(() => {});
    expect(readLogLen(logPath)).toBe(before);
  });
});
