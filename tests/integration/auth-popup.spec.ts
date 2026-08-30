// A page cannot open a free-standing window. A plain http(s) window.open / _blank
// navigation becomes a new tab; a sign-in popup to an allowlisted identity
// provider becomes a transient modal child window (allowlist stubbed here via
// HYPPO_AUTH_POPUP_HOSTS). Non-http / autonomous spawning stays blocked.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startFixtureServer, launchApp, callHandle } from "./helpers.js";
import type { ElectronApplication } from "@playwright/test";

let server: Server;
let base: string;
let baseHost: string; // always 127.0.0.1 for the fixture server

test.beforeAll(async () => {
  ({ server, base } = await startFixtureServer());
  baseHost = new URL(base).hostname;
});

test.afterAll(() => server.close());

async function openTab(app: ElectronApplication): Promise<string> {
  const r = await callHandle<{ tabId: string }>(app, "open", [`${base}/static.html`]);
  return r.tabId;
}

/** Count of real top-level BrowserWindows (a tab is a WebContentsView, not one). */
const browserWindows = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

test("a plain window.open http(s) navigation opens a new tab, not a window", async () => {
  const app = await launchApp();
  try {
    const tabId = await openTab(app);
    const wndBefore = await browserWindows(app);
    const tabsBefore = (await callHandle<{ tabs: unknown[] }>(app, "list")).tabs.length;
    await callHandle(app, "probe", [
      tabId,
      `window.open(${JSON.stringify(`${base}/popup-child.html`)}, "_blank", "width=400,height=400"), "x"`,
    ]);
    await new Promise((r) => setTimeout(r, 800));
    expect(await browserWindows(app)).toBe(wndBefore); // no free-standing window
    const tabs = (await callHandle<{ tabs: { url: string }[] }>(app, "list")).tabs;
    expect(tabs.length).toBe(tabsBefore + 1);
    expect(tabs.some((t) => t.url.endsWith("/popup-child.html"))).toBe(true);
  } finally {
    await app.close();
  }
});

test("a non-http popup target is blocked and opens nothing", async () => {
  const app = await launchApp();
  try {
    const tabId = await openTab(app);
    const wndBefore = await browserWindows(app);
    const tabsBefore = (await callHandle<{ tabs: unknown[] }>(app, "list")).tabs.length;
    await callHandle(app, "probe", [
      tabId,
      `window.open("about:blank", "_blank"), "x"`,
    ]);
    await new Promise((r) => setTimeout(r, 500));
    expect(await browserWindows(app)).toBe(wndBefore);
    expect((await callHandle<{ tabs: unknown[] }>(app, "list")).tabs.length).toBe(tabsBefore);
  } finally {
    await app.close();
  }
});

test("window.open to an allowlisted host opens a transient child window", async () => {
  const app = await launchApp({ HYPPO_AUTH_POPUP_HOSTS: baseHost });
  try {
    const tabId = await openTab(app);
    const before = await browserWindows(app);
    const popupPromise = app.waitForEvent("window", { timeout: 5000 });
    await callHandle(app, "probe", [
      tabId,
      `window.open(${JSON.stringify(`${base}/popup-child.html`)}, "_blank", "width=400,height=400"), "x"`,
    ]);
    const popup = await popupPromise;
    expect(await browserWindows(app)).toBe(before + 1); // a real modal child window
    await expect(popup.locator("#marker")).toHaveText("POPUP_CHILD_LOADED");
    // It shares the tab's session and can be closed like any script-opened window.
    await popup.evaluate(() => window.close());
  } finally {
    await app.close();
  }
});
