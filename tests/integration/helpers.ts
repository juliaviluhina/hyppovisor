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
): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [mainEntry],
    env: { ...process.env, HYPPO_E2E: "1", ...extraEnv },
  });
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
): Promise<{
  app: ElectronApplication;
  userDataDir: string;
  /** Stop the app. Deletes the temp user-data dir only if this call created it. */
  close: () => Promise<void>;
}> {
  const userDataDir = reuseDir ?? (await mkdtemp(join(tmpdir(), "hyppo-e2e-")));
  const app = await electron.launch({
    args: [mainEntry],
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
