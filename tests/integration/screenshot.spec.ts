// Feature 008 US4 (T029) — the `screenshot` tool, end to end. Retrieval only:
// nothing written to disk, no interaction-audit entry.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { startFixtureServer, launchApp, callHandle, handleValue } from "./helpers.js";
import type { ElectronApplication } from "@playwright/test";

type Shot = {
  tabId: string;
  width: number;
  height: number;
  scale: number;
  format: "jpeg" | "png";
  fullPage: boolean;
  element?: string;
  limitNotMet: boolean;
  byteLength: number;
};

function readLogLen(logPath: string): number {
  try {
    return readFileSync(logPath, "utf8").split("\n").filter(Boolean).length;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
}

test.describe("screenshot", () => {
  let app: ElectronApplication;
  let server: Server;
  let base: string;

  test.beforeAll(async () => {
    ({ server, base } = await startFixtureServer());
    // A visible window: capturePage() / CDP Page.captureScreenshot need a
    // rendered surface, which a --background instance never has (feature 013,
    // research.md R2 — verified: it hangs the renderer on headless CI).
    app = await launchApp({}, { background: false });
  });
  test.afterAll(async () => {
    await app.close();
    server.close();
  });

  const shot = (tabId: string, opts: Record<string, unknown> = {}) =>
    callHandle<Shot>(app, "screenshot", [tabId, opts]);

  test("viewport: image + metadata, scale 1, jpeg, under the 256 KB budget", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
    const r = await shot(tabId);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.scale).toBe(1);
    expect(r.format).toBe("jpeg");
    expect(r.fullPage).toBe(false);
    expect(r.byteLength).toBeLessThanOrEqual(262144);
    expect(r.byteLength).toBeGreaterThan(0);
  });

  test("a tight maxBytes forces compression / downscaling and reports it truthfully", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/big.html`]);
    const r = await shot(tabId, { maxBytes: 2000 });
    // either it fit within the (clamped, ≥1000) budget, or it is honestly flagged
    expect(r.byteLength <= 2000 || r.limitNotMet).toBe(true);
    // a full 1280-wide viewport cannot fit 2 KB without shrinking
    expect(r.scale).toBeLessThan(1);
  });

  test("element clip: dimensions match the element's box and `element` echoes the selector", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
    const r = await shot(tabId, { selector: "#first_name" });
    expect(r.element).toBe("#first_name");
    expect(r.width).toBeGreaterThan(10);
    expect(r.width).toBeLessThan(600);
    expect(r.height).toBeGreaterThan(4);
    expect(r.height).toBeLessThan(120);
  });

  test("a zero-size / hidden element → SCREENSHOT_FAILED", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
    const err = await shot(tabId, { selector: "#hiddenField" }).catch((e: Error) => e.message);
    expect(String(err)).toContain("SCREENSHOT_FAILED");
  });

  test("a non-CSS selector → INVALID_SELECTOR", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
    const err = await shot(tabId, { selector: "div:has-text('x')" }).catch((e: Error) => e.message);
    expect(String(err)).toContain("INVALID_SELECTOR");
  });

  test("fullPage: height far exceeds the viewport and fullPage is reported", async () => {
    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/tall.html`]);
    const r = await shot(tabId, { fullPage: true });
    expect(r.fullPage).toBe(true);
    expect(r.height).toBeGreaterThan(2000);
  });

  test("retrieval only: no file under userData, interaction log unchanged", async () => {
    const logPath = await handleValue<string>(app, "logPath");
    const userData = await app.evaluate(async ({ app }) => app.getPath("userData"));
    const before = readLogLen(logPath);
    const filesBefore = readdirSync(userData).length;

    const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
    await shot(tabId);
    await shot(tabId, { selector: "#first_name" });
    await shot(tabId, { format: "png" });

    expect(readLogLen(logPath)).toBe(before);
    expect(readdirSync(userData).length).toBe(filesBefore);
  });
});
