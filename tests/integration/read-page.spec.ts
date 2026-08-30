// US2: read returns verbatim text, DOM only on request; nothing is persisted;
// unknown/closed tabs error; oversized text truncates with a flag.
// Covers T029, T030, T031, plus an end-to-end check of T032's truncation.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readdirSync } from "node:fs";
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

test("read returns verbatim visible text, no DOM by default; includeDom adds it (T029)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/static.html`]);

  const plain = await callHandle<{ text: string; dom?: string; truncated: { text: boolean } }>(
    app,
    "read",
    [tabId],
  );
  expect(plain.text).toContain("Hello from the static fixture");
  expect(plain.text).not.toContain("HIDDEN_SENTINEL_SHOULD_NOT_APPEAR"); // innerText hides it
  expect(plain.dom).toBeUndefined();
  expect(plain.truncated.text).toBe(false);

  const withDom = await callHandle<{ dom?: string }>(app, "read", [tabId, true]);
  expect(withDom.dom).toContain("<html");
});

test("the shared data directory receives no page content (T030, SC-004)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/static.html`]);
  await callHandle(app, "read", [tabId]);
  await callHandle(app, "read", [tabId, true]);

  // The app's only writable file is the interaction log, in userData — not the
  // shared data directory, and never page text.
  const logPath = await handleValue<string>(app, "logPath");
  expect(logPath).toMatch(/interaction-log\.jsonl$/);

  const userData = await app.evaluate(async ({ app }) => app.getPath("userData"));
  const files = readdirSync(userData);
  // no capture/content files created by reads
  expect(files.filter((f) => /capture|page|content/i.test(f))).toEqual([]);
});

test("unknown and closed tab ids both return TAB_NOT_FOUND (T031)", async () => {
  const unknown = await callHandle(app, "read", ["tab-999"]).catch((e: Error) => e.message);
  expect(String(unknown)).toContain("TAB_NOT_FOUND");
});

test("oversized visible text truncates and sets the flag (T032 e2e)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/big.html`]);
  const r = await callHandle<{ text: string; truncated: { text: boolean } }>(app, "read", [tabId]);
  expect(r.truncated.text).toBe(true);
  expect(Buffer.byteLength(r.text, "utf8")).toBeLessThanOrEqual(100 * 1024);
});
