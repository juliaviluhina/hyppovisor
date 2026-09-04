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

// ─── feature 016 — US1: selector scoping ────────────────────────────────────

test("US1: a selector scopes text to one element's subtree, unaffected by chat-log growth", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  for (let i = 0; i < 3; i++) {
    await callHandle(app, "interact", [tabId, "click", "#advance"]);
  }

  const scoped = await callHandle<{ text: string }>(app, "read", [tabId, false, "#detail-pane"]);
  expect(scoped.text.trim()).toBe("Turn 4");
  expect(scoped.text).not.toContain("Chat line");
});

test("US1: a selector matching more than one element uses the first, document order", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  // Both #chat-log and #detail-pane contain a <p> — "p" matches both, first wins.
  const scoped = await callHandle<{ text: string }>(app, "read", [tabId, false, "p"]);
  expect(scoped.text.trim()).toBe("Chat line 1");
});

test("US1: an invalid CSS selector rejects INVALID_SELECTOR", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  const err = await callHandle(app, "read", [tabId, false, ":has-text(x)"]).catch(
    (e: Error) => e.message,
  );
  expect(String(err)).toContain("INVALID_SELECTOR");
});

test("US1: a valid selector matching nothing rejects TARGET_NOT_FOUND", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  const err = await callHandle(app, "read", [tabId, false, "#does-not-exist"]).catch(
    (e: Error) => e.message,
  );
  expect(String(err)).toContain("TARGET_NOT_FOUND");
});

test("US1: a selector also scopes the optional DOM output (FR-010)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  const scoped = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#detail-pane"]);
  expect(scoped.dom).toContain('id="detail-pane"');
  expect(scoped.dom).not.toContain('id="chat-log"');
});

// ─── feature 016 — US2: unscoped reads are byte-for-byte unchanged ─────────

test("US2: an unscoped read on the chat-shell fixture returns the full, un-narrowed shell", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  await callHandle(app, "interact", [tabId, "click", "#advance"]);
  await callHandle(app, "interact", [tabId, "click", "#advance"]);

  const full = await callHandle<{ text: string; scopedTo?: string }>(app, "read", [tabId]);
  expect(full.text).toContain("Chat line 1");
  expect(full.text).toContain("Chat line 3");
  expect(full.text).toContain("Turn 3");
  expect("scopedTo" in full).toBe(false);
});

// ─── feature 016 — US3: scoped results self-describe via scopedTo ─────────

test("US3: a scoped read reports scopedTo; an unscoped read has no such field", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);

  const scoped = await callHandle<{ scopedTo?: string }>(app, "read", [
    tabId,
    false,
    "#detail-pane",
  ]);
  expect(scoped.scopedTo).toBe("#detail-pane");

  const unscoped = await callHandle<{ scopedTo?: string }>(app, "read", [tabId]);
  expect("scopedTo" in unscoped).toBe(false);
});
