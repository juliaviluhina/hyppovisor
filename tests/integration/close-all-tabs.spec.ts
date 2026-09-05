// Feature 014 (T014) — top-bar tab actions: "Close all tabs" (US2) and "Reload
// the current tab" (US3). Driven through the real app (no HYPPO_E2E) so
// chrome:close-all-tabs / chrome:reload-tab and the MCP server run for real.
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
    const token = (
      (await page.evaluate(() =>
        (window as unknown as { hyppo: { getConnection: () => Promise<{ token: string }> } }).hyppo.getConnection(),
      )) as { token: string }
    ).token;
    const auth = { Authorization: `Bearer ${token}` };

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
    expect((await mcpPost(port, INIT, auth)).status).toBe(200);
    const listed = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_open_tabs", arguments: {} },
    }, auth);
    const text = (listed.json as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text ?? "";
    expect(JSON.parse(text).tabs).toEqual([]);

    // settings.json is byte-unchanged (US2: config untouched).
    expect(await settingsSnapshot(userDataDir)).toBe(before);
    void hy;
  } finally {
    await close();
  }
});

test("US2: the top-bar 'Close all tabs' icon is disabled at zero tabs, enabled with tabs, clears in one click", async () => {
  const { app, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();
    const openUrl = (u: string) =>
      page.evaluate(
        (url) => (window as unknown as { hyppo: { openUrl: (s: string) => Promise<unknown> } }).hyppo.openUrl(url),
        u,
      );

    // No tabs → the button is disabled and the IPC call is a no-op (FR-013).
    await expect(page.locator("#close-all-tabs")).toBeDisabled();
    expect(
      await page.evaluate(() =>
        (window as unknown as { hyppo: { closeAllTabs: () => Promise<{ closed: number }> } }).hyppo.closeAllTabs(),
      ),
    ).toEqual({ closed: 0 });

    // Two tabs → enabled; one click clears them; back to disabled.
    await openUrl(`${fixtures.base}/static.html`);
    await openUrl(`${fixtures.base}/form.html`);
    await expect(page.locator("#close-all-tabs")).toBeEnabled();
    await page.locator("#close-all-tabs").click();
    await expect(page.locator("#close-all-tabs")).toBeDisabled();
    await expect(page.locator("#notice-text")).toContainText("closed 2 tabs");
    expect(
      await page.evaluate(() => (window as unknown as { hyppo: { listTabs: () => Promise<unknown[]> } }).hyppo.listTabs()),
    ).toEqual([]);
  } finally {
    await close();
  }
});

test("US3: the top-bar 'Reload' icon is disabled at zero tabs and reloads the active tab in place", async () => {
  const { app, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();

    await expect(page.locator("#refresh-tab")).toBeDisabled();

    await page.evaluate(
      (u) => (window as unknown as { hyppo: { openUrl: (s: string) => Promise<unknown> } }).hyppo.openUrl(u),
      `${fixtures.base}/static.html`,
    );
    await expect(page.locator("#refresh-tab")).toBeEnabled();

    const urlBefore = await page.evaluate(
      () =>
        (window as unknown as { hyppo: { listTabs: () => Promise<Array<{ url: string }>> } }).hyppo
          .listTabs()
          .then((t) => t[0]?.url),
    );

    // Click reload → the tab briefly re-enters "loading" then settles "loaded"
    // on the same URL (reloaded in place, not closed, not navigated away).
    await page.locator("#refresh-tab").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                hyppo: { listTabs: () => Promise<Array<{ url: string; loadState: string }>> };
              }
            ).hyppo.listTabs().then((t) => (t[0] ? `${t[0].loadState}` : "gone")),
        ),
      )
      .toBe("loaded");
    const urlAfter = await page.evaluate(
      () =>
        (window as unknown as { hyppo: { listTabs: () => Promise<Array<{ url: string }>> } }).hyppo
          .listTabs()
          .then((t) => t[0]?.url),
    );
    expect(urlAfter).toBe(urlBefore);
  } finally {
    await close();
  }
});
