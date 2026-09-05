// Feature 013 — Unobtrusive / Background Window. Driven through the real app:
// a --background instance opens no window, still serves MCP and drives its tabs;
// a summon relaunch reveals it; closing a summoned window returns it to the
// background; a named instance shows without taking focus; quitting one instance
// leaves its siblings running. Offline — loopback + local fixtures only.
// See specs/013-background-window/quickstart.md.

import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_INSTANCE, launchApp, callHandle, mcpPost, startFixtureServer } from "./helpers.js";

const mainEntry = fileURLToPath(new URL("../../dist/main/index.js", import.meta.url));
const AUTH = { Authorization: "Bearer background-test-token" };

const init = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "background-window-spec", version: "0" },
  },
});

/** An OS-assigned free loopback port, released before it is returned. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

const isVisible = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? null);

const focusedTitle = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle() ?? null);

/** macOS Dock visibility for this app; null off macOS (no `app.dock`). */
const dockVisible = (app: ElectronApplication) =>
  app.evaluate(({ app }) => {
    const d = (app as unknown as { dock?: { isVisible?: () => boolean } }).dock;
    return d && typeof d.isVisible === "function" ? d.isVisible() : null;
  });

// ── US1 — several instances, no windows, MCP + tabs fully working ────────────
test("US1: two --background instances open no window yet serve MCP and drive their tabs", async () => {
  const { server, base } = await startFixtureServer();
  const [pA, pB] = [await freePort(), await freePort()];
  const A = await launchApp({ HYPPO_MCP_PORT: String(pA), HYPPO_MCP_TOKEN: "background-test-token" });
  const B = await launchApp({ HYPPO_MCP_PORT: String(pB), HYPPO_MCP_TOKEN: "background-test-token" });
  try {
    // No window on screen for either (SC-001 / FR-001).
    expect(await isVisible(A)).toBe(false);
    expect(await isVisible(B)).toBe(false);
    // Neither launch took focus.
    expect(await focusedTitle(A)).toBeNull();
    // macOS: no Dock icon / ⌘-Tab entry while hidden (FR-005).
    const dockA = await dockVisible(A);
    if (dockA !== null) expect(dockA).toBe(false);

    // Each MCP server answers on its own port (FR-002 / SC-002).
    expect((await mcpPost(pA, init(1), AUTH)).status).toBe(200);
    expect((await mcpPost(pB, init(1), AUTH)).status).toBe(200);

    // open / read / fill / list_tabs all work against a window that is never
    // shown (SC-002). `screenshot` is NOT asserted here: a never-shown window has
    // no compositor surface, so `capturePage()` fails in real standalone use
    // (INTERNAL "Current display surface not available for capture"). Under this
    // harness Playwright's CDP attachment keeps the hidden window painting, which
    // would mask that — so the limitation is covered by the screenshot.ts
    // NO_SURFACE mapping + its unit test, and documented (docs/configuration.md
    // "Background instances", tools.md, SKILL.md). See research.md R2.
    for (const app of [A, B]) {
      const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/form.html`]);
      const page = await callHandle<{ text: string }>(app, "read", [tabId]);
      expect(page.text.length).toBeGreaterThan(0);
      await callHandle(app, "fillBatch", [tabId, [["#name", "Ada Lovelace"]]]);
      const tabs = await callHandle<{ tabs: unknown[] }>(app, "list", []);
      expect(tabs.tabs.length).toBeGreaterThan(0);
    }

    // Still hidden after all that activity.
    expect(await isVisible(A)).toBe(false);
    expect(await isVisible(B)).toBe(false);
  } finally {
    await A.close();
    await B.close();
    server.close();
  }
});

// ── US2 — summon a background instance, then close it back to the background ──
test("US2: relaunch reveals a --background instance; closing the window returns it to the background", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hyppo-e2e-"));
  const pA = await freePort();
  const pSib = await freePort();
  const A = await launchApp({ HYPPO_USER_DATA_DIR: dir, HYPPO_MCP_PORT: String(pA), HYPPO_MCP_TOKEN: "background-test-token" });
  const sib = await launchApp({ HYPPO_MCP_PORT: String(pSib), HYPPO_MCP_TOKEN: "background-test-token" });
  try {
    expect(await isVisible(A)).toBe(false);

    // Summon gesture: relaunch the same profile. The second process fails the
    // single-instance lock, which fires `second-instance` in A and exits.
    let second: ElectronApplication | undefined;
    try {
      second = await electron.launch({
        args: [mainEntry, "--instance", E2E_INSTANCE],
        env: { ...process.env, HYPPO_E2E: "1", HYPPO_USER_DATA_DIR: dir },
      });
    } catch {
      /* the process exiting immediately is the expected outcome */
    } finally {
      await second?.close().catch(() => {});
    }

    // The summon revealed A's window (FR-007). OS focus is not assertable in the
    // _electron harness (no active display session), so visibility is the check.
    await expect.poll(() => isVisible(A), { timeout: 5000 }).toBe(true);
    // The sibling was untouched by the summon (FR-010).
    expect(await isVisible(sib)).toBe(false);
    expect((await mcpPost(pSib, init(1), AUTH)).status).toBe(200);

    // Close the summoned window → back to the background, NOT quit (FR-009).
    await A.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => isVisible(A), { timeout: 5000 }).toBe(false);
    expect((await mcpPost(pA, init(2), AUTH)).status).toBe(200); // still serving
  } finally {
    await A.close();
    await sib.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ── US3 — a named instance is shown but never focused ────────────────────────
// A real `source === "instance"` launch: no HYPPO_USER_DATA_DIR, so the profile
// resolves to <userData>/instances/<name>/ — cleaned up afterwards.
test("US3: a named instance without --background is visible but does not take focus", async () => {
  const p = await freePort();
  const name = "bgspec013";
  const app = await electron.launch({
    args: [mainEntry, "--instance", name, "--port", String(p)],
    env: { ...process.env, HYPPO_MCP_TOKEN: "background-test-token" }, // deliberately no HYPPO_USER_DATA_DIR → source "instance"
  });
  const userData = await app.evaluate(({ app }) => app.getPath("userData"));
  try {
    await app.firstWindow();
    // showInactive() shows the window without activating the app, so the app
    // holds no focused window — this is the FR-003 guarantee (no focus stolen).
    const focused = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow());
    expect(focused).toBeNull();
    // The window exists and is not minimized/destroyed. Whether isVisible()
    // reports true for an inactive window is macOS-session-dependent in the
    // _electron harness; visible-on-screen is verified by hand (quickstart.md
    // step 3). The MCP server proves the instance is fully up.
    const alive = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return !!w && !w.isDestroyed() && !w.isMinimized();
    });
    expect(alive).toBe(true);
    expect((await mcpPost(p, init(1), AUTH)).status).toBe(200);
    // SC-007 (plain `npx electron .` shows AND focuses) is verified by hand —
    // quickstart.md step 3 — a true source "default" launch touches the real
    // default profile, so it is not exercised here.
  } finally {
    await app.close();
    await rm(join(userData, "instances", name), { recursive: true, force: true });
  }
});

// ── US5 — quitting one background instance leaves the others running ─────────
test("US5: quitting one --background instance does not stop its siblings", async () => {
  const [pA, pB] = [await freePort(), await freePort()];
  const A = await launchApp({ HYPPO_MCP_PORT: String(pA), HYPPO_MCP_TOKEN: "background-test-token" });
  const B = await launchApp({ HYPPO_MCP_PORT: String(pB), HYPPO_MCP_TOKEN: "background-test-token" });
  try {
    expect((await mcpPost(pA, init(1), AUTH)).status).toBe(200);
    expect((await mcpPost(pB, init(1), AUTH)).status).toBe(200);

    await A.close(); // a real quit (app.quit path)

    await expect.poll(() => mcpPost(pA, init(2)).then((r) => r.status), { timeout: 5000 }).toBe(0);
    expect((await mcpPost(pB, init(3), AUTH)).status).toBe(200);
  } finally {
    await A.close().catch(() => {});
    await B.close();
  }
});
