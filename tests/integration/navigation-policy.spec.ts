import { test, expect } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import type { Server } from "node:http";
import { startFixtureServer, launchApp, callHandle } from "./helpers.js";

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

test("blocks a server redirect to a disallowed destination and keeps the tab", async () => {
  const before = (await callHandle<{ tabs: Array<{ tabId: string }> }>(app, "list")).tabs.length;
  await callHandle(app, "open", [`${base}/navigation-policy-redirect`]).catch(() => undefined);
  const tabs = (await callHandle<{ tabs: Array<{ tabId: string; url: string }> }>(app, "list"))
    .tabs;

  expect(tabs).toHaveLength(before + 1);
  expect(tabs.at(-1)?.url).not.toBe("about:blank");
});

test("blocks script-triggered top-level navigation without adding a tab", async () => {
  const before = (await callHandle<{ tabs: Array<unknown> }>(app, "list")).tabs.length;
  const opened = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/navigation-policy-script.html`,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const tabs = (await callHandle<{ tabs: Array<{ tabId: string; url: string }> }>(app, "list"))
    .tabs;
  const detail = tabs.find((tab) => tab.tabId === opened.tabId);

  expect(detail?.tabId).toBe(opened.tabId);
  expect(detail?.url).not.toBe("file:///etc/hosts");
  expect(tabs).toHaveLength(before + 1);
});

test("allows a normal follow-on http navigation in the existing tab", async () => {
  const before = (await callHandle<{ tabs: Array<unknown> }>(app, "list")).tabs.length;
  const opened = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/navigation-policy-allowed.html`,
  ]);
  const navigated = await callHandle<{ tabId: string; url: string }>(app, "navigate", [
    opened.tabId,
    `${base}/static.html`,
  ]);

  expect(navigated.tabId).toBe(opened.tabId);
  expect(navigated.url).toBe(`${base}/static.html`);
  expect((await callHandle<{ tabs: Array<{ tabId: string }> }>(app, "list")).tabs).toHaveLength(
    before + 1,
  );
});
