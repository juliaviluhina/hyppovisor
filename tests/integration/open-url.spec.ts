// US1: open a URL in a tab; refuse bad schemes; report final URL after redirect.
// Covers T018, T019, T020.

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

// ─── feature 002: link-shim URL resolution ────────────────────────────────────

const enc = encodeURIComponent;

async function logLines(): Promise<Array<Record<string, unknown>>> {
  const path = await handleValue<string>(app, "logPath");
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

test("US1: open_url on a link-shim URL lands on the stated destination (SC-001)", async () => {
  const dest = `${base}/static.html`;
  const wrapper = `https://www.linkedin.com/safety/go/?url=${enc(dest)}`;
  const r = await callHandle<{ tabId: string; url: string }>(app, "open", [wrapper]);
  expect(r.url).toBe(dest); // not a linkedin.com/safety URL

  const page = await callHandle<{ text: string }>(app, "read", [r.tabId]);
  expect(page.text).toContain("Hello from the static fixture");
});

test("US1: navigate on a Google /url wrapper points the tab at the destination", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/static.html`]);
  const dest = `${base}/static.html`;
  const r = await callHandle<{ url: string }>(app, "navigate", [
    tabId,
    `https://www.google.com/url?q=${enc(dest)}&sa=D`,
  ]);
  expect(r.url).toBe(dest);
});

test("US1: an unwrap writes exactly one operation:'unwrap' audit entry (SC-005)", async () => {
  const before = (await logLines()).length;
  const dest = `${base}/static.html`;
  const wrapper = `https://l.facebook.com/l.php?u=${enc(dest)}&h=xyz`;
  await callHandle(app, "open", [wrapper]);

  const after = await logLines();
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({
    operation: "unwrap",
    url: wrapper,
    target: dest,
    outcome: "permitted",
    ruleId: null,
    unwrap: { hops: 1 },
  });
});

test("US2: a non-shim URL with a q= param opens verbatim, no audit entry (SC-002, FR-011)", async () => {
  const before = (await logLines()).length;
  const u = `${base}/static.html?q=https://evil.test`;
  const r = await callHandle<{ url: string }>(app, "open", [u]);
  expect(r.url).toBe(u); // query preserved, unchanged

  const after = await logLines();
  expect(after.length).toBe(before); // no unwrap entry
});

test("US2: an ordinary open writes no audit entry (FR-011)", async () => {
  const before = (await logLines()).length;
  await callHandle(app, "open", [`${base}/static.html`]);
  expect((await logLines()).length).toBe(before);
});

// US3 (SC-003): a shim whose extracted destination is not http(s) — javascript:,
// data:, mailto:, an unparseable value — must not be navigated to. `unwrapUrl` is
// a pure transform that can only ever return an http(s) URL or the verbatim
// input, so the app *cannot* navigate to such a destination; this is proved
// exhaustively offline in tests/unit/unwrap-url.test.ts (6 scheme cases). No
// integration test is added here — exercising it would require loading a real
// shim host (linkedin.com), which the suite deliberately avoids.
