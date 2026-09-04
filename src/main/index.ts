// Electron main entry: one window, the tab manager, the app-wide queue, the
// interaction log, and the MCP server — wired together (FR-023).

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  resolveInstance,
  isResolveError,
  serverNameFor,
  classifyListenError,
} from "./instance.js";
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
import {
  writeRuntimeFile,
  rewriteRuntimePort,
  clearRuntimeFile,
  listInstances,
  closeInstance,
  type SelfRecord,
} from "./instances/registry.js";
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

/**
 * Show a fatal startup message and quit (feature 012). `dialog.showErrorBox` is a
 * blocking native modal that does not reliably paint before `app.whenReady()` on
 * macOS — waiting for ready first makes it show and lets the process exit once it
 * is dismissed. Suppressed under the integration harness (it cannot click OK) and
 * on any platform with no display; the stderr line above is always printed.
 */
async function failStartup(title: string, message: string, code: number): Promise<never> {
  if (process.env.HYPPO_E2E !== "1") {
    try {
      await app.whenReady();
      dialog.showErrorBox(title, message);
    } catch {
      /* headless / no display — stderr is enough */
    }
  }
  app.exit(code);
  // app.exit() tears the process down synchronously; this is only for the type.
  return undefined as never;
}

async function main(): Promise<void> {
  // Resolve this process's instance (feature 012): profile directory, display
  // label, and an optional --port, from argv + the environment. Runs before
  // whenReady so setPath("userData") and the single-instance lock act on the
  // result. HYPPO_USER_DATA_DIR still wins for the directory (test isolation /
  // CI / wrapper scripts) and now also supplies the label from its basename.
  // The app-support root, captured BEFORE app.setPath below (feature 012's
  // `baseUserDataDir`). Used by the instance panel (feature 014) to enumerate
  // sibling `instances/<name>/` profile directories.
  const appSupportRoot = app.getPath("userData");
  const resolved = resolveInstance(process.argv, process.env, appSupportRoot);
  if (isResolveError(resolved)) {
    const title = resolved.error === "invalid-port" ? "Invalid --port" : "Invalid --instance name";
    console.error(`[hyppovisor] ${title}: ${resolved.reason}`);
    return failStartup(title, resolved.reason, 1);
  }

  if (resolved.userDataDir) {
    // setPath does not reliably create the directory on every platform; do it first.
    mkdirSync(resolved.userDataDir, { recursive: true });
    app.setPath("userData", resolved.userDataDir);
  }

  // One live process per profile directory (feature 012). The lock is keyed on
  // userData, so distinct instances/<name>/ dirs never collide and a dead
  // holder's lock is reclaimed automatically. A second launch of the same
  // profile is refused here, before any window.
  //
  // Re-launching a running profile is the **summon gesture** (feature 013
  // FR-007): the primary process's "second-instance" handler raises and un-hides
  // its window. This second process has nothing to add — exit quietly with a
  // stderr breadcrumb, no modal. (Feature 012 popped a collision dialog here; a
  // summon must be a no-op beyond bringing the window forward, and a --background
  // instance is summoned by exactly this relaunch.)
  if (!app.requestSingleInstanceLock()) {
    const which = resolved.label ? `"${resolved.label}"` : "the default profile";
    console.error(`[hyppovisor] ${which} is already running — raised its window (summon).`);
    app.exit(0);
    return;
  }

  const instanceLabel = resolved.label;
  const serverName = serverNameFor(instanceLabel);
  const windowTitle = instanceLabel ? `HyppoVisor — ${instanceLabel}` : "HyppoVisor";
  // feature 014: stable for this process's lifetime; written into runtime.json
  // and echoed by chrome:list-instances so the panel can show an "up for …" hint.
  const instanceStartedAt = new Date().toISOString();
  const instanceMode = resolved.background ? "background" : "foreground";

  await app.whenReady();

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: windowTitle,
    // Construct hidden (feature 013). The reveal decision runs once, after
    // loadFile — see below — so the window never appears blank-then-loading, and
    // a --background instance is never shown at all.
    show: false,
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

  // Keep our computed window title (feature 012): the renderer ships
  // <title>HyppoVisor</title>, which Electron would otherwise copy onto the
  // window on load. A no-op for the default instance (title unchanged).
  win.webContents.on("page-title-updated", (e) => {
    e.preventDefault();
    win.setTitle(windowTitle);
  });

  // Relaunching this same profile raises the running window (feature 012 FR-008)
  // and, for a --background instance, is the summon gesture (feature 013 FR-007):
  // win.show() also un-hides a hidden window; restore the Dock icon / taskbar
  // button that the background launch (or a close-to-background) suppressed.
  app.on("second-instance", () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.setSkipTaskbar(false);
    if (process.platform === "darwin") app.dock?.show();
  });

  // For a --background instance, closing a summoned window returns it to the
  // background (feature 013 FR-009) instead of quitting: the process and its MCP
  // server keep running. A real quit (Cmd/Ctrl-Q, SIGINT/SIGTERM, app.quit())
  // sets `quitting` first via before-quit, so the same handler lets the window go.
  let quitting = false;
  app.on("before-quit", () => {
    quitting = true;
    // feature 014: drop this instance's runtime.json and stop the MCP listener
    // accepting before teardown, so a panel-driven shutdown releases the port
    // cleanly (contracts/instance-shutdown.md).
    clearRuntimeFile(app.getPath("userData"));
    httpHandle?.close();
  });
  win.on("close", (e) => {
    if (quitting || !resolved.background) return;
    e.preventDefault();
    win.hide();
    win.setSkipTaskbar(true);
    if (process.platform === "darwin") app.dock?.hide();
  });

  // A --background instance often has no window and no menu in reach; make Ctrl-C
  // in the launching terminal a clean quit (feature 013 FR-011). app.quit() runs
  // before-quit → quitting = true → the close handler above lets the window close.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => app.quit());
  }


  const queue = new ActionQueue();
  const log = new InteractionLog(app.getPath("userData"));

  // Recent-URLs history for the address-bar dropdown (feature 009). Loaded once
  // at startup; the only writer is a person-initiated open that reached
  // "loaded", plus the panel's "Clear recent URLs" action.
  let recentUrls = loadRecentUrls(app.getPath("userData"));

  const tabs = new TabManager(win, {
    onChange: () => send("tabs:changed", { tabs: tabs.list(), activeTabId: tabs.activeTabId }),
    onBlockedAction: (kind, detail) => send("tabs:blocked-action", { kind, detail }),
    onActivity: (tabId, description) => send("tabs:activity", { tabId, description }),
    onPersonOpen: (url) => {
      recentUrls = addRecentUrl(recentUrls, url, config.recentUrlsCap);
      saveRecentUrls(app.getPath("userData"), recentUrls);
      send("recent-urls:changed", recentUrls);
    },
  }, log, resolved.background);

  // MCP connection state (feature 007): persisted settings + the environment,
  // folded into one effective view the panel and status line render.
  const loaded = loadSettings(app.getPath("userData"));
  let curSettings: ConnectionSettings = loaded.settings;
  let existed = loaded.existed;
  const env = readEnvOverrides();
  let httpHandle: HttpMcpHandle | undefined;
  // HTTP bind outcome (feature 012): flips to "port-unavailable" / "error" if the
  // listener throws at startup, and back to "listening" once the panel rebinds.
  let serverStatus: EffectiveConnection["serverStatus"] = env.stdio ? "stdio" : "listening";

  const currentEffective = (): EffectiveConnection => ({
    ...resolveEffective(curSettings, env, existed, resolved.cliPort),
    lastRequest: httpHandle?.lastRequest() ?? null,
    serverStatus,
    instanceLabel,
    serverName,
  });
  const computeStdioLaunch = (): StdioLaunch => ({
    command: process.execPath,
    // A named instance re-passes --instance so the copied config reselects the
    // same profile and keeps the hyppovisor-<name> handshake (feature 012).
    args: resolved.name
      ? [join(here, "index.js"), "--instance", resolved.name]
      : [join(here, "index.js")],
    env: { HYPPO_MCP_STDIO: "1" },
  });
  const pushConnection = () => send("connection:changed", currentEffective());

  // Shared tool dependencies for both the startup MCP listener and a later
  // panel-driven (re)start of a server that never bound (feature 012, FR-015).
  const mcpDeps = { queue, tabs, log, onToolInvoked: () => throttledPush() };

  // Person-initiated actions from the renderer chrome.
  ipcMain.handle("chrome:open-url", (_e, url: string) =>
    queue
      .run(() => tabs.open(url, "person"))
      .then((r) => ({ ...r.value, queueDepth: r.queueDepth })),
  );
  // feature 015: navigate the ACTIVE tab in place (never a new tab). Same queue,
  // same policy/unwrap path as chrome:open-url.
  ipcMain.handle("chrome:navigate-active", (_e, url: string) =>
    queue
      .run(() => tabs.navigateActive(url))
      .then((r) => ({ ...r.value, queueDepth: r.queueDepth })),
  );
  ipcMain.handle("chrome:activate-tab", (_e, tabId: string) => tabs.setActive(tabId));
  ipcMain.handle("chrome:close-tab", (_e, tabId: string) => tabs.close(tabId));
  ipcMain.handle("chrome:reload-tab", () => tabs.reloadActive());
  ipcMain.handle("chrome:list-tabs", () => tabs.list());

  // ── Local instance-management panel IPC (feature 014, data-model.md §6) ──────
  ipcMain.handle("chrome:list-instances", () => {
    const self: SelfRecord = {
      pid: process.pid,
      label: instanceLabel,
      port: env.stdio ? null : (httpHandle?.port ?? currentEffective().port),
      mode: instanceMode,
      startedAt: instanceStartedAt,
    };
    return listInstances(appSupportRoot, self, {
      probeTimeoutMs: config.instanceProbeTimeoutMs,
    });
  });
  ipcMain.handle("chrome:close-instance", (_e, pid: unknown) => {
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
      return { ok: false, error: "invalid pid" };
    // Defence in depth behind the renderer's disabled control (FR-005).
    if (pid === process.pid)
      return { ok: false, error: "can't close the current instance" };
    return closeInstance(pid, { graceMs: config.instanceShutdownGraceMs });
  });
  ipcMain.handle("chrome:close-all-tabs", () => {
    const closed = tabs.list().length;
    tabs.closeAll();
    return { closed };
  });

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

    const persistPort = () => {
      curSettings = { ...curSettings, port };
      saveSettings(app.getPath("userData"), curSettings);
      existed = true;
      // feature 014: keep runtime.json's advertised port in step with the rebind.
      rewriteRuntimePort(app.getPath("userData"), port);
    };
    const bindError = (e: unknown) => {
      const msg = String((e as Error).message ?? e);
      return {
        ok: false as const,
        error: /EADDRINUSE|in use/i.test(msg) ? `port ${port} is already in use` : msg,
      };
    };

    // The listener never bound (port-unavailable / error at startup) — start it
    // now on the requested port rather than only rebinding a live one (FR-015).
    if (!httpHandle) {
      try {
        httpHandle = await startHttpMcpServer(mcpDeps, {
          port,
          token: currentEffective().token,
          serverName,
          onActivity: throttledPush,
        });
        serverStatus = "listening";
        persistPort();
        pushConnection();
        return { ok: true, port };
      } catch (e) {
        serverStatus = classifyListenError(e);
        pushConnection();
        return bindError(e);
      }
    }

    if (port === httpHandle.port) return { ok: true, port };
    try {
      await httpHandle.rebind(port);
      persistPort();
      pushConnection();
      return { ok: true, port };
    } catch (e) {
      return bindError(e);
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
    if (env.stdio) {
      await startStdioMcpServer(mcpDeps, { serverName });
    } else {
      const eff = resolveEffective(curSettings, env, existed, resolved.cliPort);
      httpHandle = await startHttpMcpServer(mcpDeps, {
        port: eff.port,
        token: eff.token,
        serverName,
        onActivity: throttledPush,
      });
    }
  } catch (err) {
    // A bind failure is a first-class connection state, not just a log line
    // (feature 012, FR-011): the panel renders it with the remedy.
    serverStatus = classifyListenError(err);
    console.error("[hyppovisor] MCP server did not start:", err);
  }

  // Load the renderer only once every IPC handler and the MCP server are ready,
  // so the panel's first getConnection() / status push can't race them.
  await win.loadFile(join(here, "../renderer/index.html"));

  // Reveal decision (feature 013). The window was constructed show: false; pick
  // exactly one branch now that it has rendered:
  //   --background              → stay hidden; no Dock icon / ⌘-Tab / taskbar button.
  //                               Keep timers / rAF unthrottled so a hidden tab
  //                               still settles before a read (research.md R7).
  //   source === "instance"     → visible but never focused (FR-003, revises 012)
  //   default / env-dir (CI)    → show + focus (unchanged; SC-007)
  if (resolved.background) {
    win.setSkipTaskbar(true);
    if (process.platform === "darwin") app.dock?.hide();
    win.webContents.setBackgroundThrottling(false);
  } else if (resolved.source === "instance") {
    win.showInactive();
  } else {
    win.show();
  }

  send("tabs:changed", { tabs: tabs.list(), activeTabId: tabs.activeTabId });
  pushConnection();

  // feature 014: now the MCP server has bound (or failed) and the renderer is
  // up, advertise this instance to sibling panels via its own runtime.json. It
  // is removed again in the before-quit handler above.
  writeRuntimeFile(app.getPath("userData"), {
    pid: process.pid,
    port: env.stdio ? null : (httpHandle?.port ?? currentEffective().port),
    mode: instanceMode,
    label: instanceLabel,
    startedAt: instanceStartedAt,
  });

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
      read: (tabId: string, includeDom = false, selector?: string, reduceDom = true) =>
        withCode(() =>
          queue
            .run((d) =>
              readPage(tabs.webContentsFor(tabId), tabId, includeDom, d, selector, reduceDom),
            )
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
