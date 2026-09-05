// Feature 009 — the recent-URLs dropdown, driven through the real renderer top
// bar (launchAppFull: no HYPPO_E2E, isolated temp HYPPO_USER_DATA_DIR) against
// the local fixture server.
//
// US1  a native <datalist> on #address fills with person-opened URLs, newest
//      first, live (no re-focus).
// US2  cap / dedupe / move-to-front / restart persistence / corrupt-file
//      tolerance / connection-panel "Clear recent URLs".
// US3  only person-initiated, successfully-loaded opens enter the history.

import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { launchAppFull, mcpPost, startFixtureServer, tempUserDataDir } from "./helpers.js";
import type { Server } from "node:http";
import type { Page } from "@playwright/test";

let server: Server;
let base: string;

test.beforeAll(async () => {
  ({ server, base } = await startFixtureServer());
});
test.afterAll(() => {
  server.close();
});

/** The datalist option values, in DOM order. */
const options = (page: Page) =>
  page.locator("#recent-urls option").evaluateAll((els) =>
    els.map((e) => (e as HTMLOptionElement).value),
  );

/** Type a URL into the address bar, open it in a NEW tab, and wait for the open
 *  to land (the renderer clears #address only after hyppo.openUrl resolves).
 *  Post-feature-015 the dedicated new-tab affordance is the "+" (#newtab) button
 *  — #go navigates the active tab in place once one is open. */
async function openFromBar(page: Page, url: string, expectLoad = true): Promise<void> {
  await page.locator("#address").fill(url);
  await page.locator("#newtab").click();
  if (expectLoad) {
    // Cleared only after hyppo.openUrl resolves — the first WebContentsView on a
    // slow (Windows) CI runner can take well over the 5s default.
    await expect(page.locator("#address")).toHaveValue("", { timeout: 20000 });
  } else {
    // A failed load leaves the text in place and shows an error notice.
    await expect(page.locator("#notice")).toContainText("error", { timeout: 15000 });
  }
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "recent-urls-spec", version: "0" },
  },
};

// ── US1 ─────────────────────────────────────────────────────────────────────
test("US1: opening URLs from the address bar fills the datalist newest-first, live", async () => {
  // This spec observes tab loading through the renderer datalist, so it needs a
  // real visible window — opt out of the harness's default --background (013).
  const { app, close } = await launchAppFull({}, undefined, ["--no-background"]);
  try {
    const page = await app.firstWindow();
    expect(await options(page)).toEqual([]);

    await openFromBar(page, `${base}/static.html`);
    await expect(page.locator("#recent-urls option")).toHaveCount(1);
    expect(await options(page)).toEqual([`${base}/static.html`]);

    // A second distinct open — no manual re-focus.
    await openFromBar(page, `${base}/tall.html`);
    await expect(page.locator("#recent-urls option")).toHaveCount(2);
    expect(await options(page)).toEqual([`${base}/tall.html`, `${base}/static.html`]);
  } finally {
    await close();
  }
});

// ── US2 ─────────────────────────────────────────────────────────────────────
test("US2: cap eviction, move-to-front dedupe, restart persistence", async () => {
  const userDataDir = await tempUserDataDir();
  try {
    // Cap of 2 so a third distinct open evicts the oldest.
    const first = await launchAppFull({ HYPPO_RECENT_URLS_CAP: "2" }, userDataDir, [
      "--no-background",
    ]);
    try {
      const page = await first.app.firstWindow();
      await openFromBar(page, `${base}/static.html`);
      await openFromBar(page, `${base}/tall.html`);
      await openFromBar(page, `${base}/form.html`);
      await expect(page.locator("#recent-urls option")).toHaveCount(2);
      expect(await options(page)).toEqual([`${base}/form.html`, `${base}/tall.html`]);

      // Re-open an entry already present → front, no duplicate.
      await openFromBar(page, `${base}/tall.html`);
      await expect(page.locator("#recent-urls option")).toHaveCount(2);
      expect(await options(page)).toEqual([`${base}/tall.html`, `${base}/form.html`]);
    } finally {
      await first.app.close();
    }

    // Relaunch, same user-data dir, no cap override → identical datalist on load.
    const again = await launchAppFull({}, userDataDir, ["--no-background"]);
    try {
      const page = await again.app.firstWindow();
      await expect(page.locator("#recent-urls option")).toHaveCount(2);
      expect(await options(page)).toEqual([`${base}/tall.html`, `${base}/form.html`]);
      const saved = JSON.parse(readFileSync(join(userDataDir, "recent-urls.json"), "utf8"));
      expect(saved).toEqual([`${base}/tall.html`, `${base}/form.html`]);
    } finally {
      await again.app.close();
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("US2: a malformed recent-urls.json → empty datalist, file left untouched until the next person-open", async () => {
  const userDataDir = await tempUserDataDir();
  const file = join(userDataDir, "recent-urls.json");
  writeFileSync(file, "{ not json");
  try {
    const { app, close } = await launchAppFull({}, userDataDir, ["--no-background"]);
    try {
      const page = await app.firstWindow();
      expect(await options(page)).toEqual([]);
      expect(readFileSync(file, "utf8")).toBe("{ not json");

      // The next legitimate person-open rewrites it cleanly.
      await openFromBar(page, `${base}/static.html`);
      await expect(page.locator("#recent-urls option")).toHaveCount(1);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([`${base}/static.html`]);
    } finally {
      await close();
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("US2: the connection panel's Clear recent URLs empties the datalist and the file", async () => {
  const { app, userDataDir, close } = await launchAppFull({}, undefined, ["--no-background"]);
  try {
    const page = await app.firstWindow();
    await openFromBar(page, `${base}/static.html`);
    await expect(page.locator("#recent-urls option")).toHaveCount(1);

    await page.locator("#hyppo").click();
    await expect(page.locator("#panel")).toBeVisible();
    await page.locator("#clear-recent-urls").click();

    await expect(page.locator("#recent-urls option")).toHaveCount(0);
    expect(JSON.parse(readFileSync(join(userDataDir, "recent-urls.json"), "utf8"))).toEqual([]);
    await expect(page.locator("#clear-recent-urls")).toBeDisabled();

    // No other setting touched — the clear never writes settings.json.
    expect(existsSync(join(userDataDir, "settings.json"))).toBe(true);
  } finally {
    await close();
  }
});

// ── US3 ─────────────────────────────────────────────────────────────────────
test("US3: an agent open_url and a failed load never enter the history; a redirect records the entered URL", async () => {
  // A port nothing listens on → the load fails.
  const dead = createServer();
  const deadPort: number = await new Promise((res) =>
    dead.listen(0, "127.0.0.1", () => res((dead.address() as { port: number }).port)),
  );
  await new Promise<void>((r) => dead.close(() => r()));

  const { app, close } = await launchAppFull({}, undefined, ["--no-background"]);
  try {
    const page = await app.firstWindow();
    const port = ((await page.evaluate(() =>
      (window as unknown as {
        hyppo: { getConnection: () => Promise<{ port: number }> };
      }).hyppo.getConnection(),
    )) as { port: number }).port;

    // Agent-initiated open via the real MCP server → NOT in the datalist.
    await mcpPost(port, INIT);
    await mcpPost(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "open_url", arguments: { url: `${base}/form.html` } },
    });
    await page.waitForTimeout(300);
    expect(await options(page)).toEqual([]);

    // A person open that fails to load → NOT in the datalist.
    await openFromBar(page, `http://127.0.0.1:${deadPort}/`, false);
    expect(await options(page)).toEqual([]);

    // A person open that redirects → records the URL they entered, not the landing URL.
    await openFromBar(page, `${base}/redirect`);
    await expect(page.locator("#recent-urls option")).toHaveCount(1);
    expect(await options(page)).toEqual([`${base}/redirect`]);
  } finally {
    await close();
  }
});
