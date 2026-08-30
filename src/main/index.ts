// Electron main entry: one window, the tab manager, the app-wide queue, the
// interaction log, and the MCP server — wired together (FR-023).

import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ActionQueue } from "./queue/action-queue.js";
import { InteractionLog } from "./safety/interaction-log.js";
import { TabManager } from "./tabs/tab-manager.js";
import { startStdioMcpServer, startHttpMcpServer } from "./mcp/server.js";
import { readPage } from "./page/read.js";
import { interact, fillBatch, waitForSelector } from "./page/interact.js";
import { readFormFields } from "./page/form-fields.js";
import { listBlocklistRules } from "./safety/blocklist.js";
import type { InteractOperation, BatchFillField } from "../shared/types.js";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  await app.whenReady();

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "HyppoVisor",
    webPreferences: {
      preload: join(here, "../preload/chrome.cjs"),
      contextIsolation: true,
      // Our own chrome UI, not untrusted web content. Tab views (which host the
      // web) keep sandbox: true — see tab-manager.ts.
      sandbox: false,
    },
  });

  const send = (channel: string, ...args: unknown[]) => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  };

  const queue = new ActionQueue();
  const log = new InteractionLog(app.getPath("userData"));
  const tabs = new TabManager(win, {
    onChange: () => send("tabs:changed", tabs.list()),
    onBlockedAction: (kind, detail) => send("tabs:blocked-action", { kind, detail }),
    onActivity: (tabId, description) => send("tabs:activity", { tabId, description }),
  });

  await win.loadFile(join(here, "../renderer/index.html"));
  send("tabs:changed", tabs.list());

  // Person-initiated actions from the renderer chrome.
  ipcMain.handle("chrome:open-url", (_e, url: string) =>
    queue
      .run(() => tabs.open(url, "person"))
      .then((r) => ({ ...r.value, queueDepth: r.queueDepth })),
  );
  ipcMain.handle("chrome:activate-tab", (_e, tabId: string) => tabs.setActive(tabId));
  ipcMain.handle("chrome:close-tab", (_e, tabId: string) => tabs.close(tabId));
  ipcMain.handle("chrome:list-tabs", () => tabs.list());

  const e2e = process.env.HYPPO_E2E === "1";

  // Test-only handle: same code paths the MCP tools use, reachable from
  // Playwright's electronApp.evaluate(). Installed BEFORE the MCP server so a
  // transport hiccup can never leave the handle unset.
  if (e2e) {
    // Rejections must carry the error CODE in the message: only `.message`
    // survives Playwright's app.evaluate() boundary, not custom fields.
    const withCode = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        const e = err as { code?: string; message?: string };
        throw new Error(e.code ? `${e.code}: ${e.message}` : String(e.message ?? err));
      }
    };
    (globalThis as Record<string, unknown>).__hyppo = {
      logPath: log.filePath,
      blocklistRules: () => listBlocklistRules(),
      open: (url: string) =>
        withCode(() =>
          queue
            .run(() => tabs.open(url, "orchestrator"))
            .then((r) => ({ ...r.value, queueDepth: r.queueDepth })),
        ),
      list: () =>
        queue
          .run(async () => tabs.list())
          .then((r) => ({ tabs: r.value, queueDepth: r.queueDepth })),
      navigate: (tabId: string, url: string) =>
        withCode(() =>
          queue
            .run(() => tabs.navigate(tabId, url))
            .then((r) => ({ ...r.value, queueDepth: r.queueDepth })),
        ),
      read: (tabId: string, includeDom = false) =>
        withCode(() =>
          queue
            .run((d) => readPage(tabs.webContentsFor(tabId), tabId, includeDom, d))
            .then((r) => r.value),
        ),
      interact: (tabId: string, operation: InteractOperation, selector?: string, value?: string) =>
        withCode(() =>
          queue
            .run(() => interact(tabs.webContentsFor(tabId), log, tabId, operation, selector, value))
            .then((r) => ({ tabId, operation, outcome: "permitted", queueDepth: r.queueDepth })),
        ),
      // Tests pass terse [selector, value] tuples; the MCP tool uses the
      // { selector, value } object form.
      fillBatch: (tabId: string, fields: Array<[string, string] | BatchFillField>) =>
        withCode(() => {
          const pairs: BatchFillField[] = fields.map((f) =>
            Array.isArray(f) ? { selector: f[0], value: f[1] } : f,
          );
          return queue
            .run((depth) => fillBatch(tabs.webContentsFor(tabId), log, tabId, pairs, depth))
            .then((r) => r.value);
        }),
      readFormFields: (tabId: string, containerSelector?: string) =>
        withCode(() =>
          queue
            .run((d) => readFormFields(tabs.webContentsFor(tabId), tabId, containerSelector, d))
            .then((r) => r.value),
        ),
      waitFor: (tabId: string, selector: string, timeoutMs?: number) =>
        withCode(() =>
          queue
            .run(() => waitForSelector(tabs.webContentsFor(tabId), log, tabId, selector, timeoutMs))
            .then((r) => ({ tabId, selector, found: true, queueDepth: r.queueDepth })),
        ),
      // Test-only scaffolding (never wired to MCP): move focus / read a value
      // back out of the tab so assertions can check what `fill` and `space` did.
      focus: (tabId: string, selector: string) =>
        withCode(() =>
          queue
            .run(() =>
              tabs
                .webContentsFor(tabId)
                .executeJavaScript(
                  `(() => { const el = document.querySelector(${JSON.stringify(selector)});
                     if (!el) return false; el.focus(); return document.activeElement === el; })()`,
                  true,
                ),
            )
            .then((r) => r.value),
        ),
      blur: (tabId: string) =>
        withCode(() =>
          queue
            .run(() =>
              tabs
                .webContentsFor(tabId)
                .executeJavaScript(
                  `(() => { if (document.activeElement && document.activeElement.blur)
                     document.activeElement.blur(); return document.activeElement &&
                     document.activeElement.tagName; })()`,
                  true,
                ),
            )
            .then((r) => r.value),
        ),
      probe: (tabId: string, expr: string) =>
        withCode(() =>
          queue
            .run(() => tabs.webContentsFor(tabId).executeJavaScript(expr, true))
            .then((r) => r.value),
        ),
    };
    return; // e2e drives the test handle; the stdio MCP server is not used here
  }

  // Normal run: expose the MCP server. Default is an HTTP listener on loopback
  // (start the app, then connect Claude Code to the URL); HYPPO_MCP_STDIO=1
  // switches to the spawn model (no open port). A transport failure must not
  // take the window down — the app is still useful standalone.
  try {
    if (process.env.HYPPO_MCP_STDIO === "1") {
      await startStdioMcpServer({ queue, tabs, log });
    } else {
      const port = Number(process.env.HYPPO_MCP_PORT) || 7357;
      const token = process.env.HYPPO_MCP_TOKEN || undefined;
      const mcp = await startHttpMcpServer({ queue, tabs, log }, { port, token });
      send("mcp:ready", { url: mcp.url, requiresToken: mcp.requiresToken });
    }
  } catch (err) {
    console.error("[hyppovisor] MCP server did not start:", err);
  }
}

app.on("window-all-closed", () => app.quit());

main().catch((e) => {
  console.error("[hyppovisor] fatal:", e);
  app.exit(1);
});
