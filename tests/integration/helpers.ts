// Shared setup for the Playwright _electron integration tests: launch the built
// app with the test handle enabled, and serve the local fixtures over http so
// open_url's http(s)-only policy is satisfied (FR-004) without live traffic.

import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication } from "@playwright/test";

const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
const mainEntry = fileURLToPath(new URL("../../dist/main/index.js", import.meta.url));

/** The `--instance` name every harness launch uses unless a spec overrides it (feature 012). */
export const E2E_INSTANCE = "e2e";
/** The MCP server name / snippet key that follows from {@link E2E_INSTANCE}. */
export const E2E_SERVER_NAME = "hyppovisor-e2e";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

export async function startFixtureServer(): Promise<{ server: Server; base: string }> {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent((req.url ?? "/").split("?")[0]);
    // A real HTTP redirect, so loadURL() follows it before resolving.
    if (pathname === "/redirect") {
      res.writeHead(302, { location: "/static.html" }).end();
      return;
    }
    try {
      const name = pathname.replace(/^\/+/, "") || "static.html";
      const body = await readFile(join(fixturesDir, name));
      res.writeHead(200, { "content-type": MIME[extname(name)] ?? "text/plain" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, base: `http://127.0.0.1:${port}` };
}

export async function launchApp(
  extraEnv: Record<string, string> = {},
  opts: { background?: boolean } = {},
): Promise<ElectronApplication> {
  // Give every launch its own throwaway HYPPO_USER_DATA_DIR (feature 012, R11):
  // the single-instance lock is keyed on userData, so sharing the real dev
  // profile would make back-to-back specs — or a spec run while `npm start` is
  // open — hit the collision guard. A caller that needs a specific dir passes it
  // in extraEnv, which wins and is left for the caller to clean up.
  const ownDir = !extraEnv.HYPPO_USER_DATA_DIR;
  const userDataDir = ownDir
    ? await mkdtemp(join(tmpdir(), "hyppo-e2e-"))
    : extraEnv.HYPPO_USER_DATA_DIR;
  // --background by default (feature 013): local `npm run test:e2e` shows no
  // windows (SC-005). Playwright hooks window *creation*, not visibility, so the
  // test handle and firstWindow() are unaffected. A spec that needs a real
  // rendered surface — `screenshot.spec.ts` — passes `{ background: false }`:
  // capturePage() / CDP Page.captureScreenshot on a never-shown window has no
  // surface and hangs the renderer on headless CI.
  const background = opts.background !== false;
  const app = await electron.launch({
    // A fixed --instance so the window title, MCP server name, and panel label
    // are deterministic (feature 012): "HYPPO_USER_DATA_DIR alone" would derive
    // the label from the random temp-dir basename.
    args: [mainEntry, "--instance", E2E_INSTANCE, ...(background ? ["--background"] : [])],
    env: { ...process.env, HYPPO_E2E: "1", HYPPO_USER_DATA_DIR: userDataDir, ...extraEnv },
  });
  if (ownDir) {
    const origClose = app.close.bind(app);
    app.close = async (...args: Parameters<typeof origClose>) => {
      try {
        await origClose(...args);
      } finally {
        await rm(userDataDir, { recursive: true, force: true });
      }
    };
  }
  // main() wires globalThis.__hyppo asynchronously after app.whenReady() and
  // window setup; wait for it before any test calls in.
  const deadline = Date.now() + 15_000;
  for (;;) {
    const ready = await app.evaluate(() => "__hyppo" in globalThis).catch(() => false);
    if (ready) break;
    if (Date.now() > deadline) throw new Error("app test handle (__hyppo) never appeared");
    await new Promise((r) => setTimeout(r, 100));
  }
  return app;
}

/** A throwaway user-data directory for a test that relaunches into the same dir. */
export function tempUserDataDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hyppo-e2e-"));
}

/**
 * Launch the built app the way a person runs it — no `HYPPO_E2E`, so the real
 * HTTP MCP server and the connection IPC handlers are live — with an isolated,
 * throwaway `HYPPO_USER_DATA_DIR` so `settings.json` and the interaction log do
 * not touch dev state. Used by the connection-panel spec (feature 007).
 */
export async function launchAppFull(
  extraEnv: Record<string, string> = {},
  reuseDir?: string,
  extraArgs: string[] = [],
): Promise<{
  app: ElectronApplication;
  userDataDir: string;
  /** Stop the app. Deletes the temp user-data dir only if this call created it. */
  close: () => Promise<void>;
}> {
  const userDataDir = reuseDir ?? (await mkdtemp(join(tmpdir(), "hyppo-e2e-")));
  const hasInstance = extraArgs.some((a) => a === "--instance" || a.startsWith("--instance="));
  // --background by default (feature 013) so a local run shows no windows
  // (SC-005). A spec that needs a visible window passes "--no-background" in
  // extraArgs — it is stripped here and suppresses the default.
  const optOut = extraArgs.includes("--no-background");
  const args = extraArgs.filter((a) => a !== "--no-background");
  const app = await electron.launch({
    // Deterministic identity by default (feature 012); a spec that passes its own
    // --instance in extraArgs opts out.
    args: [
      mainEntry,
      ...(hasInstance ? [] : ["--instance", E2E_INSTANCE]),
      ...(optOut ? [] : ["--background"]),
      ...args,
    ],
    env: { ...process.env, HYPPO_USER_DATA_DIR: userDataDir, ...extraEnv },
  });
  const page = await app.firstWindow();

  // Wait until the renderer has its connection state and — for the HTTP
  // transport — the listener is actually accepting, so a test can hit it
  // immediately after launch.
  const conn = (await page.evaluate(() =>
    (
      window as unknown as { hyppo: { getConnection: () => Promise<{ transport: string; port: number }> } }
    ).hyppo.getConnection(),
  )) as { transport: string; port: number };
  if (conn.transport === "http") {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const { status } = await mcpPost(conn.port, { jsonrpc: "2.0", id: 0, method: "ping" });
      if (status !== 0) break;
      if (Date.now() > deadline) throw new Error(`MCP HTTP server never came up on ${conn.port}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return {
    app,
    userDataDir,
    close: async () => {
      await app.close();
      if (!reuseDir) await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

/** POST a JSON body to a running MCP HTTP server on loopback and read the reply. */
export function mcpPost(
  port: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const parse = (text: string, status: number) => {
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        const line = text.split("\n").find((l) => l.startsWith("data:"));
        if (line) {
          try {
            json = JSON.parse(line.slice(5).trim());
          } catch {
            /* leave json as the raw text */
          }
        }
      }
      return { status, json };
    };
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        agent: false,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": String(payload.length),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          done(() => resolve(parse(Buffer.concat(chunks).toString("utf8"), res.statusCode ?? 0))),
        );
        // A mid-stream abort (server tore the transport down) still counts as a
        // reply if we have a status — never let it become an unhandled 'error'.
        res.on("error", () =>
          done(() => {
            if (res.statusCode) resolve(parse(Buffer.concat(chunks).toString("utf8"), res.statusCode));
            else reject(new Error("response stream error"));
          }),
        );
      },
    );
    req.on("error", (e) => done(() => resolve({ status: 0, json: String(e) })));
    req.setTimeout(5000, () => done(() => resolve({ status: 0, json: "timeout" })));
    req.end(payload);
  });
}

/** Call a method on the main-process test handle (`globalThis.__hyppo`). */
export function callHandle<T = unknown>(
  app: ElectronApplication,
  method: string,
  args: unknown[] = [],
): Promise<T> {
  return app.evaluate(
    async (_electron, { method, args }) => {
      const h = (globalThis as Record<string, unknown>).__hyppo as Record<
        string,
        (...a: unknown[]) => Promise<unknown>
      >;
      return h[method](...args);
    },
    { method, args },
  ) as Promise<T>;
}

export function handleValue<T = unknown>(app: ElectronApplication, prop: string): Promise<T> {
  return app.evaluate((_e, prop) => {
    const h = (globalThis as Record<string, unknown>).__hyppo as Record<string, unknown>;
    const v = h[prop];
    return typeof v === "function" ? (v as () => unknown)() : v;
  }, prop) as Promise<T>;
}
