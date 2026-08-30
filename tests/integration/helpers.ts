// Shared setup for the Playwright _electron integration tests: launch the built
// app with the test handle enabled, and serve the local fixtures over http so
// open_url's http(s)-only policy is satisfied (FR-004) without live traffic.

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
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
