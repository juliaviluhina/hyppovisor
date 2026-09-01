// Feature 014 (T006) — User Story 1: the local instance-management panel.
// Driven through the real app (no HYPPO_E2E) so chrome:list-instances /
// chrome:close-instance run for real. Instances share one --user-data-dir so
// they live under <base>/instances/<name>/ and can discover each other via their
// own runtime.json files. Offline — loopback + local sockets only.
// See specs/014-instance-management/quickstart.md §1–§3.

import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpPost } from "./helpers.js";

const mainEntry = fileURLToPath(new URL("../../dist/main/index.js", import.meta.url));

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

interface InstanceRow {
  pid: number;
  label: string;
  port: number | null;
  mode: "foreground" | "background";
  state: "responding" | "not-responding" | "stdio";
  isCurrent: boolean;
}

const listFrom = (page: Page): Promise<InstanceRow[]> =>
  page.evaluate(() =>
    (window as unknown as { hyppo: { listInstances: () => Promise<InstanceRow[]> } }).hyppo.listInstances(),
  ) as Promise<InstanceRow[]>;

const closeFrom = (page: Page, pid: number) =>
  page.evaluate(
    (p) =>
      (
        window as unknown as { hyppo: { closeInstance: (n: number) => Promise<unknown> } }
      ).hyppo.closeInstance(p),
    pid,
  );

const pidOf = (app: ElectronApplication) => app.evaluate(() => process.pid);

/** A trio of real instances under one shared app-support root. */
async function launchTrio() {
  const base = await mkdtemp(join(tmpdir(), "hyppo-im-"));
  const ports = { acme: await freePort(), contoso: await freePort(), initech: await freePort() };
  const one = (name: string, port: number, background: boolean) =>
    electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${base}`,
        "--instance",
        name,
        "--port",
        String(port),
        ...(background ? ["--background"] : []),
      ],
      env: { ...process.env },
    });
  // acme is the "viewer" (foreground); the other two are background (SC-005:
  // background instances are the ones that are otherwise hard to see / stop).
  const acme = await one("acme", ports.acme, false);
  await acme.firstWindow();
  const contoso = await one("contoso", ports.contoso, true);
  await contoso.firstWindow();
  const initech = await one("initech", ports.initech, true);
  await initech.firstWindow();

  const apps = { acme, contoso, initech };
  const close = async () => {
    for (const a of Object.values(apps)) await a.close().catch(() => {});
    await rm(base, { recursive: true, force: true });
  };
  return { apps, ports, base, close };
}

const init = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "instance-management-spec", version: "0" },
  },
});

// ── US1 scenarios 1 + 3, SC-001, SC-004 ────────────────────────────────────
test("US1: lists every local instance with correct identity; the current row is not closable", async () => {
  const trio = await launchTrio();
  try {
    const acmePage = await trio.apps.acme.firstWindow();
    const acmePid = await pidOf(trio.apps.acme);

    // SC-001 — all three appear (each with name / port / mode / state) within 3 s.
    await expect
      .poll(async () => (await listFrom(acmePage)).length, { timeout: 3000 })
      .toBe(3);

    const rows = await listFrom(acmePage);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(Object.keys(byLabel).sort()).toEqual(["acme", "contoso", "initech"]);
    expect(byLabel.acme).toMatchObject({
      port: trio.ports.acme,
      mode: "foreground",
      state: "responding",
      isCurrent: true,
      pid: acmePid,
    });
    expect(byLabel.contoso).toMatchObject({ port: trio.ports.contoso, mode: "background", isCurrent: false });
    expect(byLabel.initech).toMatchObject({ port: trio.ports.initech, mode: "background", isCurrent: false });

    // Exactly one row is the current instance (FR-003).
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);

    // SC-004 — the current instance can never be shut down from the list.
    expect(await closeFrom(acmePage, acmePid)).toEqual({
      ok: false,
      error: "can't close the current instance",
    });

    // The background instances see the same three, each marked current in its own.
    const contosoPage = await trio.apps.contoso.firstWindow();
    await expect
      .poll(async () => (await listFrom(contosoPage)).find((r) => r.isCurrent)?.label, { timeout: 3000 })
      .toBe("contoso");
  } finally {
    await trio.close();
  }
});

// ── US1 scenario 2, SC-002, SC-003, SC-005 ─────────────────────────────────
test("US1: closing a non-current instance frees its MCP port and drops it from every list", async () => {
  const trio = await launchTrio();
  try {
    const acmePage = await trio.apps.acme.firstWindow();
    const contosoPage = await trio.apps.contoso.firstWindow();
    const initechPid = await pidOf(trio.apps.initech);

    await expect.poll(async () => (await listFrom(acmePage)).length, { timeout: 3000 }).toBe(3);
    // initech is serving MCP before the shutdown.
    expect((await mcpPost(trio.ports.initech, init(1))).status).toBe(200);

    // Shut it down from acme's panel path (no confirmation prompt in the IPC —
    // that is the renderer's job; here we exercise the mechanism).
    expect(await closeFrom(acmePage, initechPid)).toEqual({ ok: true });

    // SC-003 — its MCP port stops answering within 10 s.
    await expect
      .poll(() => mcpPost(trio.ports.initech, init(2)).then((r) => r.status), { timeout: 10_000 })
      .toBe(0);

    // SC-005 — its row is gone from acme's list and from contoso's within 5 s.
    await expect
      .poll(async () => (await listFrom(acmePage)).some((r) => r.label === "initech"), { timeout: 5000 })
      .toBe(false);
    await expect
      .poll(async () => (await listFrom(contosoPage)).some((r) => r.label === "initech"), { timeout: 5000 })
      .toBe(false);

    // acme + contoso are untouched — still listed, still serving.
    expect((await mcpPost(trio.ports.acme, init(3))).status).toBe(200);
    expect((await mcpPost(trio.ports.contoso, init(4))).status).toBe(200);
  } finally {
    await trio.close();
  }
});

// ── US1 scenario 4 — an instance closed outside the panel ──────────────────
test("US1: an instance closed outside the panel drops from the list on the next poll", async () => {
  const trio = await launchTrio();
  try {
    const acmePage = await trio.apps.acme.firstWindow();
    await expect.poll(async () => (await listFrom(acmePage)).length, { timeout: 3000 }).toBe(3);

    await trio.apps.contoso.close(); // a real quit, nothing to do with the panel

    await expect
      .poll(async () => (await listFrom(acmePage)).map((r) => r.label).sort(), { timeout: 5000 })
      .toEqual(["acme", "initech"]);
  } finally {
    await trio.close();
  }
});
