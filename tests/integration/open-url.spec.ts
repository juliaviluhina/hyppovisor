// US1: open a URL in a tab; refuse bad schemes; report final URL after redirect.
// Covers T018, T019, T020.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startFixtureServer, launchApp, callHandle } from "./helpers.js";
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

test("opens a URL and returns tab id, final URL, and title (T018)", async () => {
  const r = await callHandle<{ tabId: string; url: string; title: string; loadState: string }>(
    app,
    "open",
    [`${base}/static.html`],
  );
  expect(r.tabId).toMatch(/^tab-\d+$/);
  expect(r.url).toBe(`${base}/static.html`);
  expect(r.title).toBe("Static Fixture Page");
  expect(r.loadState).toBe("loaded");

  const list = await callHandle<{ tabs: Array<{ tabId: string }> }>(app, "list");
  expect(list.tabs.map((t) => t.tabId)).toContain(r.tabId);
});

test("refuses non-http(s) schemes and malformed URLs, opening no tab (T019)", async () => {
  for (const [url, code] of [
    ["file:///etc/hosts", "SCHEME_NOT_ALLOWED"],
    ["javascript:alert(1)", "SCHEME_NOT_ALLOWED"],
    ["data:text/html,<h1>x</h1>", "SCHEME_NOT_ALLOWED"],
    ["not-a-url", "INVALID_URL"],
  ] as const) {
    const before = (await callHandle<{ tabs: unknown[] }>(app, "list")).tabs.length;
    const err = await callHandle(app, "open", [url]).catch((e: Error) => e.message);
    expect(String(err)).toContain(code);
    const after = (await callHandle<{ tabs: unknown[] }>(app, "list")).tabs.length;
    expect(after).toBe(before);
  }
});

test("reports the final landed URL after a redirect (T020)", async () => {
  const r = await callHandle<{ url: string }>(app, "open", [`${base}/redirect`]);
  expect(r.url).toBe(`${base}/static.html`);
});
