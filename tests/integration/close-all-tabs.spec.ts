// Feature 014 (T014) — User Story 2: "Close all tabs". Driven through the real
// app (no HYPPO_E2E) so chrome:close-all-tabs and the MCP server run for real.
// Offline — local fixture server + loopback MCP only.
// See specs/014-instance-management/quickstart.md §4.

import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { launchAppFull, mcpPost, startFixtureServer } from "./helpers.js";
import type { Server } from "node:http";

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "close-all-tabs-spec", version: "0" },
  },
};

/** `settings.json` content, or null when the file does not exist. */
async function settingsSnapshot(userDataDir: string): Promise<string | null> {
  try {
    return await readFile(join(userDataDir, "settings.json"), "utf8");
  } catch {
    return null;
  }
}

let fixtures: { server: Server; base: string };
test.beforeAll(async () => {
  fixtures = await startFixtureServer();
});
test.afterAll(() => {
  fixtures.server.close();
});

test("US2: 'Close all tabs' clears every tab, leaves the instance running and serving MCP", async () => {
  const { app, userDataDir, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();
    const hy = () =>
      page.evaluate(() => window as unknown as { hyppo: Record<string, (...a: unknown[]) => Promise<unknown>> });

    const port = (
      (await page.evaluate(() =>
        (
          window as unknown as { hyppo: { getConnection: () => Promise<{ port: number }> } }
        ).hyppo.getConnection(),
      )) as { port: number }
    ).port;

    const before = await settingsSnapshot(userDataDir);

    // Open three real tabs against the local fixture server.
    for (const name of ["static.html", "form.html", "tall.html"]) {
      await page.evaluate((u) => (window as unknown as { hyppo: { openUrl: (s: string) => Promise<unknown> } }).hyppo.openUrl(u), `${fixtures.base}/${name}`);
    }
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { hyppo: { listTabs: () => Promise<unknown[]> } }).hyppo.listTabs().then((t) => t.length)))
      .toBe(3);

    // Close them all in one call.
    const result = await page.evaluate(() =>
      (window as unknown as { hyppo: { closeAllTabs: () => Promise<{ closed: number }> } }).hyppo.closeAllTabs(),
    );
    expect(result).toEqual({ closed: 3 });

    // Zero content tabs — the freshly-launched state (no placeholder/home tab).
    expect(
      await page.evaluate(() => (window as unknown as { hyppo: { listTabs: () => Promise<unknown[]> } }).hyppo.listTabs()),
    ).toEqual([]);

    // The same instance is still up: MCP handshake works and list_open_tabs is [].
    expect((await mcpPost(port, INIT)).status).toBe(200);
    const listed = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_open_tabs", arguments: {} },
    });
    const text = (listed.json as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text ?? "";
    expect(JSON.parse(text).tabs).toEqual([]);

    // settings.json is byte-unchanged (US2: config untouched).
    expect(await settingsSnapshot(userDataDir)).toBe(before);
    void hy;
  } finally {
    await close();
  }
});

test("US2: 'Close all tabs' is a no-op with no tabs open, and the panel button is disabled", async () => {
  const { app, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();

    // No tabs → the IPC call reports zero closed (FR-013 no-op).
    expect(
      await page.evaluate(() =>
        (window as unknown as { hyppo: { closeAllTabs: () => Promise<{ closed: number }> } }).hyppo.closeAllTabs(),
      ),
    ).toEqual({ closed: 0 });

    // Open the connection panel → the "Close all tabs" button is disabled.
    await page.locator("#hyppo").click();
    await expect(page.locator("#close-all-tabs")).toBeDisabled();

    // Open a tab → it becomes enabled; click it → back to disabled.
    await page.evaluate(
      (u) => (window as unknown as { hyppo: { openUrl: (s: string) => Promise<unknown> } }).hyppo.openUrl(u),
      `${fixtures.base}/static.html`,
    );
    await expect(page.locator("#close-all-tabs")).toBeEnabled();
    await page.locator("#close-all-tabs").click();
    await expect(page.locator("#close-all-tabs")).toBeDisabled();
    await expect(page.locator("#panel-body")).toContainText("Closed 1 tab.");
  } finally {
    await close();
  }
});
