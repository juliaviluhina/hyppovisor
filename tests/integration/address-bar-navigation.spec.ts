// Feature 015 — the address bar reflects and navigates the active tab, driven
// through the real renderer top bar against the local fixture server.
//
// US1  #address shows the active tab's current (post-redirect) URL, tracking
//      activation / redirect / agent navigate; empty when no tab is open; an
//      in-progress edit (input focused) is never clobbered.
// US2  Enter / → navigate the active tab in place (no new tab, still active),
//      under the same URL policy / link-shim unwrap / failure messaging as a
//      new-tab open; a successful navigation feeds recent-URLs. With no tab
//      active, Enter opens a new tab.
// US3  the dedicated "+" (#newtab) button opens a new tab without disturbing the
//      active tab, whether or not a tab is active.
//
// Uses launchApp({ background:false }): a real visible window AND the __hyppo
// test handle (for the FR-003 background-navigate case). The person paths still
// go through the real chrome IPC (chrome:open-url / chrome:navigate-active).

import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { launchApp, startFixtureServer, callHandle } from "./helpers.js";
import type { Server } from "node:http";
import type { Page } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";

let server: Server;
let base: string;

test.beforeAll(async () => {
  ({ server, base } = await startFixtureServer());
});
test.afterAll(() => {
  server.close();
});

const enc = encodeURIComponent;

/** The open tabs' URLs, in strip order. */
const listUrls = (page: Page): Promise<string[]> =>
  page.evaluate(async () =>
    (await (window as unknown as { hyppo: { listTabs: () => Promise<{ url: string }[]> } }).hyppo.listTabs()).map(
      (t) => t.url,
    ),
  );

/** The recent-URLs datalist option values, DOM order. */
const recent = (page: Page): Promise<string[]> =>
  page.locator("#recent-urls option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));

/** Type a URL and open it in a NEW tab via #go (no tab active) or #newtab. Waits
 *  for the open to land — the renderer clears #address only after it resolves. */
async function openNewTab(page: Page, url: string, via: "#go" | "#newtab" = "#go"): Promise<void> {
  await page.locator("#address").fill(url);
  await page.locator(via).click();
  await expect(page.locator("#address")).toHaveValue("", { timeout: 20000 });
}

/** A TCP port with nothing listening — a load against it fails. */
async function deadPort(): Promise<number> {
  const s = createServer();
  const port: number = await new Promise((res) =>
    s.listen(0, "127.0.0.1", () => res((s.address() as { port: number }).port)),
  );
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function withApp(fn: (page: Page, app: ElectronApplication) => Promise<void>): Promise<void> {
  const app = await launchApp({}, { background: false });
  try {
    await fn(await app.firstWindow(), app);
  } finally {
    await app.close();
  }
}

// ── US1 — the bar reflects the active tab ───────────────────────────────────

test("US1: #address shows the active tab's URL on activation (strip + dropdown)", async () => {
  await withApp(async (page) => {
    await openNewTab(page, `${base}/static.html`);
    await openNewTab(page, `${base}/tall.html`, "#newtab");
    expect(await listUrls(page)).toEqual([`${base}/static.html`, `${base}/tall.html`]);

    // Switch to the first tab via the strip → bar reflects it.
    await page.locator(".tab").nth(0).click();
    await expect(page.locator("#address")).toHaveValue(`${base}/static.html`);

    // Switch to the second tab via the #tabselect dropdown → bar reflects it.
    const secondId = await page.evaluate(async () =>
      (await (window as unknown as { hyppo: { listTabs: () => Promise<{ tabId: string }[]> } }).hyppo.listTabs())[1]
        .tabId,
    );
    await page.locator("#tabselect").selectOption(secondId);
    await expect(page.locator("#address")).toHaveValue(`${base}/tall.html`);
  });
});

test("US1: the bar tracks a redirect (post-redirect URL) and clears when the last tab closes", async () => {
  await withApp(async (page) => {
    await openNewTab(page, `${base}/static.html`);

    // Navigate the active tab through a 302 → bar settles on the landing URL.
    await page.locator("#address").fill(`${base}/redirect`);
    await page.locator("#address").press("Enter");
    await page.locator("#address").blur();
    await expect(page.locator("#address")).toHaveValue(`${base}/static.html`);
    expect(await listUrls(page)).toEqual([`${base}/static.html`]);

    // Close the last tab → bar goes empty (placeholder shows).
    await page.locator("#close-all-tabs").click();
    await expect(page.locator("#address")).toHaveValue("");
  });
});

test("US1 / FR-003: an in-progress edit survives a background navigate; switching tabs discards it", async () => {
  await withApp(async (page, app) => {
    await openNewTab(page, `${base}/static.html`);
    await openNewTab(page, `${base}/tall.html`, "#newtab");
    const activeId = await page.locator("#tabselect").inputValue(); // = the active tab (2 tabs ⇒ dropdown shown)

    // Person is mid-edit: focus + partial text.
    await page.locator("#address").fill("https://example.c");
    // Agent navigates the active tab in the background.
    await callHandle(app, "navigate", [activeId, `${base}/form.html`]);
    await page.waitForTimeout(300);
    await expect(page.locator("#address")).toHaveValue("https://example.c"); // untouched

    // Now switch tabs without submitting → the edit is discarded, bar shows the
    // newly-active tab's URL.
    await page.locator(".tab").nth(0).click();
    await expect(page.locator("#address")).toHaveValue(`${base}/static.html`);
  });
});

// ── US2 — Enter / → navigate the active tab in place ────────────────────────

test("US2: Enter navigates the active tab in place — no new tab, still active", async () => {
  await withApp(async (page) => {
    await openNewTab(page, `${base}/form.html`);

    await page.locator("#address").fill(`${base}/static.html`);
    await page.locator("#address").press("Enter");
    await page.locator("#address").blur();

    await expect(page.locator("#address")).toHaveValue(`${base}/static.html`);
    expect(await listUrls(page)).toEqual([`${base}/static.html`]);
    await expect(page.locator(".tab.active")).toHaveCount(1);
  });
});

test("US2: the → button navigates the active tab in place too", async () => {
  await withApp(async (page) => {
    await openNewTab(page, `${base}/form.html`);

    await page.locator("#address").fill(`${base}/tall.html`);
    await page.locator("#go").click();
    await page.locator("#address").blur(); // leaving the field resyncs it to the tab
    await expect(page.locator("#address")).toHaveValue(`${base}/tall.html`);
    expect(await listUrls(page)).toEqual([`${base}/tall.html`]);
  });
});

test("US2: a URL-policy refusal leaves the active tab put, with a notice", async () => {
  await withApp(async (page) => {
    await openNewTab(page, `${base}/static.html`);

    await page.locator("#address").fill("ftp://example.com/");
    await page.locator("#address").press("Enter");

    await expect(page.locator("#notice")).toContainText("error");
    expect(await listUrls(page)).toEqual([`${base}/static.html`]);
  });
});

test("US2: a failed load shows the notice and never spawns a fallback tab (FR-009)", async () => {
  const port = await deadPort();
  await withApp(async (page) => {
    await openNewTab(page, `${base}/static.html`);

    await page.locator("#address").fill(`http://127.0.0.1:${port}/`);
    await page.locator("#address").press("Enter");

    await expect(page.locator("#notice")).toContainText("error", { timeout: 15000 });
    // The active tab shows its failed-load state; crucially no fallback tab was
    // spawned (FR-009) — still exactly one tab.
    await expect(page.locator(".tab")).toHaveCount(1);
    expect(await listUrls(page)).toHaveLength(1);
  });
});

test("US2 / FR-010: a successful in-place navigation feeds recent-URLs; a failed one does not", async () => {
  const port = await deadPort();
  await withApp(async (page) => {
    await openNewTab(page, `${base}/static.html`);

    // Successful navigate-in-place → entered URL recorded.
    await page.locator("#address").fill(`${base}/tall.html`);
    await page.locator("#address").press("Enter");
    await page.locator("#address").blur();
    await expect(page.locator("#recent-urls option")).toHaveCount(2);
    expect(await recent(page)).toEqual([`${base}/tall.html`, `${base}/static.html`]);

    // Failed navigate-in-place → nothing added.
    await page.locator("#address").fill(`http://127.0.0.1:${port}/`);
    await page.locator("#address").press("Enter");
    await expect(page.locator("#notice")).toContainText("error", { timeout: 15000 });
    expect(await recent(page)).toEqual([`${base}/tall.html`, `${base}/static.html`]);
  });
});

test("US2 / FR-010: navigating in place through a redirect records the entered URL, not the landing URL", async () => {
  await withApp(async (page) => {
    await openNewTab(page, `${base}/form.html`); // first tab on a URL distinct from the redirect target

    // /redirect 302s to /static.html — the tab lands on static.html but the
    // history must record what the person typed.
    await page.locator("#address").fill(`${base}/redirect`);
    await page.locator("#address").press("Enter");
    await page.locator("#address").blur();

    await expect(page.locator("#address")).toHaveValue(`${base}/static.html`); // landed
    expect(await recent(page)).toEqual([`${base}/redirect`, `${base}/form.html`]); // recorded the entered URL
  });
});

test("US2: navigateActive rejects NO_ACTIVE_TAB when no tab is open (defence in depth)", async () => {
  await withApp(async (page) => {
    const err = await page.evaluate(async () => {
      try {
        await (window as unknown as { hyppo: { navigateActive: (u: string) => Promise<unknown> } }).hyppo.navigateActive(
          "https://example.com/",
        );
        return null;
      } catch (e) {
        return String((e as Error).message ?? e);
      }
    });
    expect(err).toMatch(/No active tab/i);
    expect(await listUrls(page)).toEqual([]); // no fallback tab was created
  });
});

test("US2 / FR-007: with no tab open, Enter opens a new tab", async () => {
  await withApp(async (page) => {
    await page.locator("#address").fill(`${base}/static.html`);
    await page.locator("#address").press("Enter");
    await expect(page.locator("#address")).toHaveValue("", { timeout: 20000 });
    expect(await listUrls(page)).toEqual([`${base}/static.html`]);
  });
});

test("US2 / FR-007: with no tab open, the → button also opens a new tab (and feeds recent-URLs)", async () => {
  await withApp(async (page) => {
    await page.locator("#address").fill(`${base}/static.html`);
    await page.locator("#go").click();
    await expect(page.locator("#address")).toHaveValue("", { timeout: 20000 });
    expect(await listUrls(page)).toEqual([`${base}/static.html`]);
    // Same terms as a new-tab open: the successful person-initiated open is recorded.
    expect(await recent(page)).toEqual([`${base}/static.html`]);
  });
});

test("US2 / FR-008: a link-shim URL is unwrapped, then loaded in place", async () => {
  await withApp(async (page) => {
    await openNewTab(page, `${base}/form.html`);

    const wrapped = `https://www.linkedin.com/safety/go/?url=${enc(`${base}/static.html`)}`;
    await page.locator("#address").fill(wrapped);
    await page.locator("#address").press("Enter");
    await page.locator("#address").blur();

    await expect(page.locator("#address")).toHaveValue(`${base}/static.html`);
    expect(await listUrls(page)).toEqual([`${base}/static.html`]); // unwrapped target, in place, no new tab
  });
});

// ── US3 — the "+" button opens a new tab without disturbing the active tab ───

test("US3: #newtab opens a new tab and leaves the previously-active tab untouched", async () => {
  await withApp(async (page) => {
    await openNewTab(page, `${base}/static.html`);

    await page.locator("#address").fill(`${base}/tall.html`);
    await page.locator("#newtab").click();
    await expect(page.locator("#address")).toHaveValue("", { timeout: 20000 }); // open landed

    await expect(page.locator(".tab")).toHaveCount(2);
    expect(await listUrls(page)).toEqual([`${base}/static.html`, `${base}/tall.html`]);
    // The new tab is the active one.
    const activeId = await page.locator("#tabselect").inputValue();
    const secondId = await page.evaluate(async () =>
      (await (window as unknown as { hyppo: { listTabs: () => Promise<{ tabId: string }[]> } }).hyppo.listTabs())[1]
        .tabId,
    );
    expect(activeId).toBe(secondId);
  });
});

test("US3: with no tab open, #newtab just opens a tab", async () => {
  await withApp(async (page) => {
    await page.locator("#address").fill(`${base}/static.html`);
    await page.locator("#newtab").click();
    await expect(page.locator("#address")).toHaveValue("", { timeout: 20000 });
    expect(await listUrls(page)).toEqual([`${base}/static.html`]);
  });
});
