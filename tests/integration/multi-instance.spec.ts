// Feature 012 — run more than one HyppoVisor on one machine. Driven through the
// real app (no HYPPO_E2E): two live instances, the profile-collision guard, and
// the port-unavailable connection state. Offline — loopback only, no live-site
// traffic. See specs/012-multi-instance/quickstart.md.

import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_INSTANCE, launchAppFull, mcpPost } from "./helpers.js";

const mainEntry = fileURLToPath(new URL("../../dist/main/index.js", import.meta.url));

const init = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "multi-instance-spec", version: "0" },
  },
});

/** An OS-assigned free loopback port, released before it is returned. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

const getConn = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { hyppo: { getConnection: () => Promise<Record<string, unknown>> } }).hyppo.getConnection(),
  );

const windowTitle = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? null);

// ── US1 + US4 — two named instances, parallel and tellable apart ─────────────
test("US1/US4: two named instances bind their own ports, keep their own identity, serve in parallel", async () => {
  const [pA, pB] = [await freePort(), await freePort()];
  const A = await launchAppFull({}, undefined, ["--instance", "work", "--port", String(pA)]);
  const B = await launchAppFull({}, undefined, ["--instance", "personal", "--port", String(pB)]);
  try {
    // Distinct profile directories (isolation — FR-024 / SC-002).
    expect(A.userDataDir).not.toBe(B.userDataDir);

    // Each MCP handshake carries its own server name (FR-018).
    const initA = await mcpPost(pA, init(1));
    const initB = await mcpPost(pB, init(1));
    expect(initA.status).toBe(200);
    expect(initB.status).toBe(200);
    const nameOf = (r: { json: unknown }) =>
      (r.json as { result?: { serverInfo?: { name?: string } } }).result?.serverInfo?.name;
    expect(nameOf(initA)).toBe("hyppovisor-work");
    expect(nameOf(initB)).toBe("hyppovisor-personal");

    // Window titles are tellable apart (FR-016 / SC-005).
    expect(await windowTitle(A.app)).toBe("HyppoVisor — work");
    expect(await windowTitle(B.app)).toBe("HyppoVisor — personal");

    // Each renderer reflects its own label + port (FR-017), port source is "cli".
    const cA = await getConn(await A.app.firstWindow());
    const cB = await getConn(await B.app.firstWindow());
    expect(cA.instanceLabel).toBe("work");
    expect(cA.port).toBe(pA);
    expect(cA.portSource).toBe("cli");
    expect(cA.serverName).toBe("hyppovisor-work");
    expect(cB.instanceLabel).toBe("personal");
    expect(cB.port).toBe(pB);

    // Interleaved calls to both — every one is served (non-interfering, SC-001).
    const calls: Promise<{ status: number }>[] = [];
    for (let i = 0; i < 4; i++) {
      calls.push(mcpPost(pA, init(100 + i)));
      calls.push(mcpPost(pB, init(200 + i)));
    }
    for (const r of await Promise.all(calls)) expect(r.status).toBe(200);
  } finally {
    await A.close();
    await B.close();
  }
});

// ── US4 — the plain default instance is byte-identical (SC-007) ─────────────
test("US4: no --instance and an unusable env-dir basename → bare title and server name", async () => {
  // A profile dir whose basename ("-") derives to an empty label exercises the
  // FR-004a fallback: identical to a truly flag-free launch.
  const parent = await mkdtemp(join(tmpdir(), "hyppo-e2e-"));
  const dir = join(parent, "-");
  await mkdir(dir);
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      // --background (feature 013): this spec only reads label / server name /
      // title / handshake — no window needs to be visible (SC-005).
      args: [mainEntry, "--background"],
      env: { ...process.env, HYPPO_USER_DATA_DIR: dir },
    });
    const page = await app.firstWindow();
    const c = await getConn(page);
    expect(c.instanceLabel).toBe("");
    expect(c.serverName).toBe("hyppovisor");
    expect(await windowTitle(app)).toBe("HyppoVisor");
    const handshake = await mcpPost(c.port as number, init(1));
    expect(
      (handshake.json as { result?: { serverInfo?: { name?: string } } }).result?.serverInfo?.name,
    ).toBe("hyppovisor");
  } finally {
    await app?.close();
    await rm(parent, { recursive: true, force: true });
  }
});

// ── US2 — profile-collision guard ──────────────────────────────────────────
test("US2: a second launch into the same profile opens no window; the first stays live", async () => {
  const D = await launchAppFull();
  try {
    let openedWindow = false;
    let second: ElectronApplication | undefined;
    try {
      second = await electron.launch({
        // Same profile as the first instance → the lock guard refuses it.
        // HYPPO_E2E suppresses the (blocking, native) error dialog; the exit still happens.
        args: [mainEntry, "--instance", E2E_INSTANCE],
        env: { ...process.env, HYPPO_E2E: "1", HYPPO_USER_DATA_DIR: D.userDataDir },
      });
      const win = await second.firstWindow({ timeout: 4000 }).catch(() => null);
      openedWindow = win !== null;
    } catch {
      // launch() rejected because the process exited immediately — also a pass.
    } finally {
      await second?.close().catch(() => {});
    }
    expect(openedWindow).toBe(false);

    // The original instance is untouched and still serving.
    const c = await getConn(await D.app.firstWindow());
    expect((await mcpPost(c.port as number, init(1))).status).toBe(200);
  } finally {
    await D.close();
  }
});

// ── US3 — port-unavailable is a first-class, recoverable state ──────────────
test("US3: an in-use port surfaces as port-unavailable; browser still works; panel recovers", async () => {
  const busy = await freePort();
  const blocker = createServer((_q, r) => r.end("x"));
  await new Promise<void>((res) => blocker.listen(busy, "127.0.0.1", res));
  const dir = await mkdtemp(join(tmpdir(), "hyppo-e2e-"));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [mainEntry, "--port", String(busy), "--background"],
      env: { ...process.env, HYPPO_USER_DATA_DIR: dir },
    });
    const page = await app.firstWindow();

    await expect
      .poll(async () => (await getConn(page)).serverStatus, { timeout: 10_000 })
      .toBe("port-unavailable");

    // FR-014 — every non-MCP capability still works.
    const tabs = await page.evaluate(() =>
      (window as unknown as { hyppo: { listTabs: () => Promise<unknown[]> } }).hyppo.listTabs(),
    );
    expect(Array.isArray(tabs)).toBe(true);

    // FR-013 — it never bound a different port on its own.
    expect((await getConn(page)).port).toBe(busy);

    // FR-015 — free the port, set a fresh one in the panel: binds, state clears, no restart.
    await new Promise<void>((res) => blocker.close(() => res()));
    const fresh = await freePort();
    const r = (await page.evaluate(
      (p) => (window as unknown as { hyppo: { setPort: (n: number) => Promise<{ ok: boolean }> } }).hyppo.setPort(p),
      fresh,
    )) as { ok: boolean };
    expect(r.ok).toBe(true);
    await expect
      .poll(async () => (await getConn(page)).serverStatus, { timeout: 5000 })
      .toBe("listening");
    expect((await mcpPost(fresh, init(1))).status).toBe(200);
  } finally {
    await app?.close();
    blocker.close();
    await rm(dir, { recursive: true, force: true });
  }
});
