// Feature 028 — per-row settings copy end to end: two live instances, the
// visible panel reads the sibling's settings, and the copied token reaches
// the sibling (and only the sibling) over MCP. Offline — loopback only.
// Unreachable marking is unit-covered (it needs a dead pid whose file the
// list reaps by design); stdio variants are unit-covered in
// connection-snippets.test.ts.

import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { mcpPost } from "./helpers.js";

const mainEntry = fileURLToPath(new URL("../../dist/main/index.js", import.meta.url));

// Two instances under one shared app-support root so they discover each
// other via <base>/instances/<name>/ (instance-management.spec.ts pattern).
// No HYPPO_MCP_TOKEN env: each instance persists its own token, so the copied
// token is the effective one (research.md R4).
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

async function launchPair() {
  const base = await mkdtemp(join(tmpdir(), "hyppo-isc-"));
  const [pA, pB] = [await freePort(), await freePort()];
  const one = (name: string, port: number) =>
    electron.launch({
      args: [mainEntry, `--user-data-dir=${base}`, "--instance", name, "--port", String(port), "--background"],
      env: { ...process.env } as Record<string, string>,
    });
  const [appA, appB] = await Promise.all([one("visi", pA), one("hid", pB)]);
  // Wait for both test handles (HYPPO_E2E is unset here; poll the panel bridge instead).
  for (const app of [appA, appB]) {
    const page = await app.firstWindow();
    const deadline = Date.now() + 15_000;
    for (;;) {
      const ready = await page.evaluate(() => "hyppo" in window && typeof (window as unknown as { hyppo: { listInstances?: unknown } }).hyppo.listInstances === "function").catch(() => false);
      if (ready) break;
      if (Date.now() > deadline) throw new Error("panel bridge never appeared");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const close = async () => {
    await appA.close().catch(() => undefined);
    await appB.close().catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  };
  return { base, pA, pB, appA, appB, close };
}

const init = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "instance-settings-copy-spec", version: "0" },
  },
});

interface RowSettings {
  serverName: string;
  transport: "http" | "stdio";
  port: number | null;
  tokenRequired: boolean;
  token: string | null;
  state: string;
  authNote: string | null;
}

const rowSettings = (page: Page, pid: number) =>
  page.evaluate((p) => {
    const h = (window as unknown as { hyppo: { instanceSettings: (x: number) => Promise<RowSettings | null> } }).hyppo;
    return h.instanceSettings(p);
  }, pid);

const listRows = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as { hyppo: { listInstances: () => Promise<Array<{ pid: number; label: string }>> } }).hyppo;
    return h.listInstances();
  });

// US1/US2: a sibling row's settings reach the sibling over MCP.
test("US1/US2: copied sibling settings connect to the sibling (FR-001/FR-002/FR-007)", async () => {
  const { base, pB, appA, close } = await launchPair();
  // SC-004 baseline: profile files must be byte-identical after all reads.
  // runtime.json appears once each MCP server has bound — after first window
  // paint — so wait for both files before snapshotting.
  const profileFile = (inst: string, file: string) => join(base, "instances", inst, file);
  for (const inst of ["visi", "hid"]) {
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        readFileSync(profileFile(inst, "runtime.json"), "utf8");
        break;
      } catch {
        if (Date.now() > deadline) throw new Error(`runtime.json never appeared for ${inst}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
  const before = new Map<string, string>();
  for (const inst of ["visi", "hid"]) {
    for (const file of ["settings.json", "runtime.json"]) {
      before.set(`${inst}/${file}`, readFileSync(profileFile(inst, file), "utf8"));
    }
  }
  try {
    const pageA = await appA.firstWindow();
    let rowB;
    {
      const deadline = Date.now() + 15_000;
      for (;;) {
        rowB = (await listRows(pageA)).find((r) => r.label === "hid");
        if (rowB) break;
        if (Date.now() > deadline) throw new Error("hid row never appeared in the list");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    expect(rowB).toBeDefined();

    const rs = await rowSettings(pageA, rowB!.pid);
    expect(rs).toMatchObject({
      serverName: "hyppovisor-hid",
      transport: "http",
      port: pB,
      tokenRequired: true,
      state: "live",
      authNote: null,
    });
    // The copied token is B's persisted token — read straight from B's profile.
    const persisted = JSON.parse(
      readFileSync(join(base, "instances", "hid", "settings.json"), "utf8"),
    ) as { token: string };
    expect(rs!.token).toBe(persisted.token);

    // The copied settings reach B (and name B): a wrong-instance connection
    // would answer with a different server name.
    const res = await mcpPost(pB, init(1), { Authorization: `Bearer ${rs!.token}` });
    expect(res.status).toBe(200);
    const name = (res.json as { result?: { serverInfo?: { name?: string } } }).result?.serverInfo?.name;
    expect(name).toBe("hyppovisor-hid");

    // US2: the own row matches the panel's connection (single source of truth).
    const conn = await pageA.evaluate(() => {
      const h = (window as unknown as { hyppo: { getConnection: () => Promise<Record<string, unknown>> } }).hyppo;
      return h.getConnection();
    });
    const ownPid = (await listRows(pageA)).find((r) => r.label === "visi")!.pid;
    const own = await rowSettings(pageA, ownPid);
    expect(own).toMatchObject({
      serverName: conn.serverName,
      port: conn.port,
      tokenRequired: conn.tokenRequired,
      token: conn.token,
      state: "live",
    });

    // SC-004: listing and copying changed nothing on disk.
    for (const inst of ["visi", "hid"]) {
      for (const file of ["settings.json", "runtime.json"]) {
        const p = join(base, "instances", inst, file);
        expect(readFileSync(p, "utf8")).toBe(before.get(`${inst}/${file}`));
      }
    }
  } finally {
    await close();
  }
});

// US3: an unreadable sibling profile offers no copy (clarify Q2).
test("US3: unreadable sibling settings yield unavailable, never fabricated", async () => {
  const { base, appA, close } = await launchPair();
  const settingsPath = join(base, "instances", "hid", "settings.json");
  try {
    const pageA = await appA.firstWindow();
    // Sibling discovery is poll-based: wait for the hid row to appear.
    let rowB;
    {
      const deadline = Date.now() + 15_000;
      for (;;) {
        rowB = (await listRows(pageA)).find((r) => r.label === "hid");
        if (rowB) break;
        if (Date.now() > deadline) throw new Error("hid row never appeared in the list");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    // Make the file unreadable in a cross-platform way: POSIX chmod semantics
    // do not exist on Windows (the owner keeps read access), but replacing the
    // file with a directory fails the read everywhere.
    const original = readFileSync(settingsPath, "utf8");
    rmSync(settingsPath);
    mkdirSync(settingsPath);
    try {
      const rs = await rowSettings(pageA, rowB.pid);
      expect(rs?.state).toBe("unavailable");
      expect(rs?.token).toBeNull();
    } finally {
      rmSync(settingsPath, { recursive: true, force: true });
      writeFileSync(settingsPath, original);
    }
    // Restored files read again — the row recovers without relaunch.
    const rs = await rowSettings(pageA, rowB.pid);
    expect(rs?.state).toBe("live");
    expect(rs?.token).not.toBeNull();
  } finally {
    await close();
  }
});
