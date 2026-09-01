// Electron main entry: one window, the tab manager, the app-wide queue, the
// interaction log, and the MCP server — wired together (FR-023).

import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { ActionQueue } from "./queue/action-queue.js";
import { InteractionLog } from "./safety/interaction-log.js";
import { TabManager } from "./tabs/tab-manager.js";
import {
  startStdioMcpServer,
  startHttpMcpServer,
  generateToken,
  type HttpMcpHandle,
} from "./mcp/server.js";
import {
  loadSettings,
  saveSettings,
  readEnvOverrides,
  resolveEffective,
} from "./settings.js";
import {
  loadRecentUrls,
  saveRecentUrls,
  addRecentUrl,
} from "./recent-urls.js";
import { readPage } from "./page/read.js";
import { interact, fillBatch, waitForSelector } from "./page/interact.js";
import { readFormFields } from "./page/form-fields.js";
import { takeScreenshot } from "./page/screenshot.js";
import { listBlocklistRules } from "./safety/blocklist.js";
import type {
  InteractOperation,
  BatchFillField,
  ConnectionSettings,
  EffectiveConnection,
  StdioLaunch,
} from "../shared/types.js";

const here = dirname(fileURLToPath(import.meta.url));

// The embedded MCP server drives third-party transport code; a stray rejection
// or throw from it must not take the window down — the app is useful standalone
// (FR: "a transport failure must not take the window down").
process.on("unhandledRejection", (reason) => {
  console.error("[hyppovisor] unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[hyppovisor] uncaught exception:", err);
});

async function main(): Promise<void> {
  // Test isolation: point userData at a throwaway dir so settings.json and the
  // interaction log never touch dev state (research.md R13).
  if (process.env.HYPPO_USER_DATA_DIR) {
    app.setPath("userData", process.env.HYPPO_USER_DATA_DIR);
  }

  await app.whenReady();

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "HyppoVisor",
    // Repo-root build/icon.png (from dist/main). Used for the dev / Linux / Windows
    // window + taskbar; the macOS packaged .icns is wired once packaging config exists.
    icon: join(here, "../../build/icon.png"),
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

  // Recent-URLs history for the address-bar dropdown (feature 009). Loaded once
  // at startup; the only writer is a person-initiated open that reached
  // "loaded", plus the panel's "Clear recent URLs" action.
  let recentUrls = loadRecentUrls(app.getPath("userData"));

  const tabs = new TabManager(win, {
    onChange: () => send("tabs:changed", tabs.list()),
    onBlockedAction: (kind, detail) => send("tabs:blocked-action", { kind, detail }),
    onActivity: (tabId, description) => send("tabs:activity", { tabId, description }),
    onPersonOpen: (url) => {
      recentUrls = addRecentUrl(recentUrls, url, config.recentUrlsCap);
      saveRecentUrls(app.getPath("userData"), recentUrls);
      send("recent-urls:changed", recentUrls);
    },
  });

  // MCP connection state (feature 007): persisted settings + the environment,
  // folded into one effective view the panel and status line render.
  const loaded = loadSettings(app.getPath("userData"));
  let curSettings: ConnectionSettings = loaded.settings;
  let existed = loaded.existed;
  const env = readEnvOverrides();
  let httpHandle: HttpMcpHandle | undefined;

  const currentEffective = (): EffectiveConnection => ({
    ...resolveEffective(curSettings, env, existed),
    lastRequest: httpHandle?.lastRequest() ?? null,
  });
  const computeStdioLaunch = (): StdioLaunch => ({
    command: process.execPath,
    args: [join(here, "index.js")],
    env: { HYPPO_MCP_STDIO: "1" },
  });
  const pushConnection = () => send("connection:changed", currentEffective());

  // Person-initiated actions from the renderer chrome.
  ipcMain.handle("chrome:open-url", (_e, url: string) =>
    queue
      .run(() => tabs.open(url, "person"))
      .then((r) => ({ ...r.value, queueDepth: r.queueDepth })),
  );
  ipcMain.handle("chrome:activate-tab", (_e, tabId: string) => tabs.setActive(tabId));
  ipcMain.handle("chrome:close-tab", (_e, tabId: string) => tabs.close(tabId));
  ipcMain.handle("chrome:list-tabs", () => tabs.list());

  // Recent-URLs dropdown (feature 009). Registered before win.loadFile so the
  // renderer's first read can't race them (feature-007 lesson).
  ipcMain.handle("chrome:recent-urls", () => recentUrls);
  ipcMain.handle("chrome:clear-recent-urls", () => {
    recentUrls = [];
    saveRecentUrls(app.getPath("userData"), []);
    send("recent-urls:changed", []);
  });

  // ── Connection panel IPC (feature 007, contracts/ipc-connection.md) ──────────
  ipcMain.handle("chrome:get-connection", () => ({
    ...currentEffective(),
    stdioLaunch: computeStdioLaunch(),
    appVersion: app.getVersion(),
    license: "Apache-2.0" as const,
  }));
  ipcMain.handle("chrome:set-panel-open", (_e, open: unknown) => {
    tabs.setChromeOverlay(!!open);
  });

  ipcMain.handle("chrome:set-port", async (_e, port: unknown) => {
    if (env.stdio) return { ok: false, error: "stdio mode has no network port" };
    if (currentEffective().portSource === "env")
      return { ok: false, error: "port is set by the HYPPO_MCP_PORT environment variable" };
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
      return { ok: false, error: "port must be an integer between 1 and 65535" };
    if (!httpHandle) return { ok: false, error: "the HTTP MCP server is not running" };
    if (port === httpHandle.port) return { ok: true, port };
    try {
      await httpHandle.rebind(port);
      curSettings = { ...curSettings, port };
      saveSettings(app.getPath("userData"), curSettings);
      existed = true;
      pushConnection();
      return { ok: true, port };
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      return {
        ok: false,
        error: /EADDRINUSE|in use/i.test(msg) ? `port ${port} is already in use` : msg,
      };
    }
  });

  const guardTokenMutation = (): { ok: false; error: string } | null => {
    if (env.stdio) return { ok: false, error: "stdio mode uses no token" };
    if (currentEffective().tokenSource === "env")
      return { ok: false, error: "token is set by the HYPPO_MCP_TOKEN environment variable" };
    if (!httpHandle) return { ok: false, error: "the HTTP MCP server is not running" };
    return null;
  };

  ipcMain.handle("chrome:set-token-required", (_e, required: unknown) => {
    const blocked = guardTokenMutation();
    if (blocked) return blocked;
    const token = required ? generateToken() : null;
    httpHandle!.setToken(token);
    curSettings = { ...curSettings, tokenRequired: !!required, token };
    saveSettings(app.getPath("userData"), curSettings);
    existed = true;
    pushConnection();
    return { ok: true, ...currentEffective() };
  });

  ipcMain.handle("chrome:regenerate-token", (_e) => {
    const blocked = guardTokenMutation();
    if (blocked) return blocked;
    if (!currentEffective().tokenRequired)
      return { ok: false, error: "no token to regenerate" };
    const token = generateToken();
    httpHandle!.setToken(token);
    curSettings = { ...curSettings, token };
    saveSettings(app.getPath("userData"), curSettings);
    existed = true;
    pushConnection();
    return { ok: true, ...currentEffective() };
  });

  // Expose the MCP server. Default is an HTTP listener on loopback; the port and
  // token come from the effective settings (env > settings.json > default).
  // HYPPO_MCP_STDIO=1 switches to the spawn model (no open port). A transport
  // failure must not take the window down — the app is still useful standalone.
  // Nudge the renderer when the last-request record changes, at most once per
  // second but never dropping the final update (leading + trailing edge).
  let lastPushAt = 0;
  let trailing: NodeJS.Timeout | undefined;
  const throttledPush = () => {
    const wait = 1000 - (Date.now() - lastPushAt);
    if (wait <= 0) {
      lastPushAt = Date.now();
      pushConnection();
    } else if (!trailing) {
      trailing = setTimeout(() => {
        trailing = undefined;
        lastPushAt = Date.now();
        pushConnection();
      }, wait);
    }
  };

  try {
    const deps = { queue, tabs, log, onToolInvoked: () => throttledPush() };
    if (env.stdio) {
      await startStdioMcpServer(deps);
    } else {
      const eff = resolveEffective(curSettings, env, existed);
      httpHandle = await startHttpMcpServer(deps, {
        port: eff.port,
        token: eff.token,
        onActivity: throttledPush,
      });
    }
  } catch (err) {
    console.error("[hyppovisor] MCP server did not start:", err);
  }

  // Load the renderer only once every IPC handler and the MCP server are ready,
  // so the panel's first getConnection() / status push can't race them.
  await win.loadFile(join(here, "../renderer/index.html"));
  send("tabs:changed", tabs.list());
  pushConnection();

  const e2e = process.env.HYPPO_E2E === "1";

  // Test-only handle: same code paths the MCP tools use, reachable from
  // Playwright's electronApp.evaluate(). The HTTP MCP server and the connection
  // IPC are already started above, so the panel e2e can exercise a real socket.
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
      interact: (
        tabId: string,
        operation: InteractOperation,
        selector?: string,
        value?: string,
        label?: string,
      ) =>
        withCode(() =>
          queue
            .run(() =>
              interact(tabs.webContentsFor(tabId), log, tabId, operation, selector, value, label),
            )
            .then((r) => {
              // list_options returns an option enumeration, not a permitted-action ack.
              if (operation === "list_options") {
                const v = r.value as {
                  options: unknown;
                  optionsPresent: boolean;
                  optionsTruncated: boolean;
                };
                return {
                  tabId,
                  selector,
                  options: v.options,
                  optionsPresent: v.optionsPresent,
                  optionsTruncated: v.optionsTruncated,
                  queueDepth: r.queueDepth,
                };
              }
              return {
                tabId,
                operation,
                outcome: "permitted",
                ...(r.value && typeof r.value === "object" && "chosenOption" in r.value
                  ? { chosenOption: r.value.chosenOption }
                  : {}),
                ...(r.value && typeof r.value === "object" && "currentValue" in r.value
                  ? { currentValue: (r.value as { currentValue: string }).currentValue }
                  : {}),
                queueDepth: r.queueDepth,
              };
            }),
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
      readFormFields: (
        tabId: string,
        containerSelector?: string,
        opts?: {
          fields?: string[];
          includeNonInteractive?: boolean;
          only?: "required-unfilled";
        },
      ) =>
        withCode(() =>
          queue
            .run((d) =>
              readFormFields(tabs.webContentsFor(tabId), tabId, containerSelector, d, opts ?? {}),
            )
            .then((r) => r.value),
        ),
      waitFor: (tabId: string, selector: string, timeoutMs?: number) =>
        withCode(() =>
          queue
            .run(() => waitForSelector(tabs.webContentsFor(tabId), log, tabId, selector, timeoutMs))
            .then((r) => ({ tabId, selector, found: true, queueDepth: r.queueDepth })),
        ),
      // Feature 008: returns the metadata plus the encoded byte length (the raw
      // image does not need to cross the evaluate() boundary for assertions).
      screenshot: (
        tabId: string,
        opts: {
          selector?: string;
          fullPage?: boolean;
          format?: "jpeg" | "png";
          maxBytes?: number;
        } = {},
      ) =>
        withCode(() =>
          queue
            .run(() => takeScreenshot(tabs.webContentsFor(tabId), { tabId, ...opts }))
            .then((r) => ({ ...r.value.meta, byteLength: r.value.bytes.length })),
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
    return; // e2e drives the test handle; the MCP server started above still runs
  }
}

app.on("window-all-closed", () => app.quit());

main().catch((e) => {
  console.error("[hyppovisor] fatal:", e);
  app.exit(1);
});
