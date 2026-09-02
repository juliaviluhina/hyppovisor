// Feature 014 (T005) — the local instance registry: runtime.json parse / schema
// guard, profile enumeration, PID liveness, the loopback probe, the
// enumerate-filter-merge-sort of listInstances, and the SIGTERM→grace→SIGKILL
// escalation of closeInstance. Filesystem + net + process.kill only — no
// Electron. See specs/014-instance-management/contracts/.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import {
  RUNTIME_FILENAME,
  writeRuntimeFile,
  rewriteRuntimePort,
  clearRuntimeFile,
  readRuntimeFile,
  enumerateProfiles,
  isPidAlive,
  probePort,
  listInstances,
  closeInstance,
  type SelfRecord,
} from "../../src/main/instances/registry.js";
import type { InstanceRuntime } from "../../src/shared/types.js";

let root: string;
const runtimePath = (dir: string) => join(dir, RUNTIME_FILENAME);
const DEAD_PID = 2_147_483_646; // no process; process.kill(_, 0) → ESRCH

const sampleRuntime = (over: Partial<InstanceRuntime> = {}): Omit<InstanceRuntime, "schema"> => ({
  pid: 4321,
  port: 7358,
  mode: "foreground",
  label: "work",
  startedAt: "2026-09-01T18:22:04.511Z",
  ...over,
});

/** An OS-assigned loopback port with a live listener; caller closes the server. */
function listening(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

/** An OS-assigned loopback port with nothing listening (bound then released). */
function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hyppo-registry-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── readRuntimeFile / writeRuntimeFile / rewriteRuntimePort / clearRuntimeFile ──
describe("runtime.json read / write", () => {
  it("round-trips a written file and stamps schema:1", () => {
    writeRuntimeFile(root, sampleRuntime());
    expect(readRuntimeFile(root)).toEqual({ schema: 1, ...sampleRuntime() });
  });

  it("absent / unreadable → null", () => {
    expect(readRuntimeFile(root)).toBeNull();
    expect(readRuntimeFile(join(root, "nope"))).toBeNull();
  });

  it("non-JSON → null", () => {
    writeFileSync(runtimePath(root), "{ not json");
    expect(readRuntimeFile(root)).toBeNull();
  });

  it.each([
    ["wrong schema", { schema: 2, ...sampleRuntime() }],
    ["missing pid", { schema: 1, ...sampleRuntime(), pid: undefined }],
    ["non-integer pid", { schema: 1, ...sampleRuntime(), pid: 3.5 }],
    ["bad mode", { schema: 1, ...sampleRuntime(), mode: "hidden" }],
    ["numeric label", { schema: 1, ...sampleRuntime(), label: 7 }],
    ["port as string", { schema: 1, ...sampleRuntime(), port: "7358" }],
  ])("schema violation (%s) → null", (_label, doc) => {
    writeFileSync(runtimePath(root), JSON.stringify(doc));
    expect(readRuntimeFile(root)).toBeNull();
  });

  it("port: null (stdio) is valid", () => {
    writeRuntimeFile(root, sampleRuntime({ port: null }));
    expect(readRuntimeFile(root)?.port).toBeNull();
  });

  it("rewriteRuntimePort patches only the port and keeps startedAt", () => {
    writeRuntimeFile(root, sampleRuntime());
    rewriteRuntimePort(root, 9100);
    expect(readRuntimeFile(root)).toEqual({ schema: 1, ...sampleRuntime({ port: 9100 }) });
  });

  it("rewriteRuntimePort is a no-op when the file is gone", () => {
    expect(() => rewriteRuntimePort(root, 9100)).not.toThrow();
    expect(existsSync(runtimePath(root))).toBe(false);
  });

  it("clearRuntimeFile removes the file and swallows a second call", () => {
    writeRuntimeFile(root, sampleRuntime());
    clearRuntimeFile(root);
    expect(existsSync(runtimePath(root))).toBe(false);
    expect(() => clearRuntimeFile(root)).not.toThrow();
  });
});

// ── enumerateProfiles ──────────────────────────────────────────────────────
describe("enumerateProfiles", () => {
  it("no instances/ dir → just the root", () => {
    expect(enumerateProfiles(root)).toEqual([root]);
  });

  it("root plus each subdirectory of instances/, files ignored", () => {
    mkdirSync(join(root, "instances", "a"), { recursive: true });
    mkdirSync(join(root, "instances", "b"), { recursive: true });
    writeFileSync(join(root, "instances", "note.txt"), "x");
    expect(enumerateProfiles(root).sort()).toEqual(
      [root, join(root, "instances", "a"), join(root, "instances", "b")].sort(),
    );
  });
});

// ── isPidAlive ─────────────────────────────────────────────────────────────
describe("isPidAlive", () => {
  it("true for this process, false for a dead pid", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(DEAD_PID)).toBe(false);
  });

  it("EPERM (alive, other user) counts as alive", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("EPERM") as NodeJS.ErrnoException;
      e.code = "EPERM";
      throw e;
    });
    expect(isPidAlive(12345)).toBe(true);
  });
});

// ── probePort ──────────────────────────────────────────────────────────────
describe("probePort", () => {
  it("true against a live listener, false against a closed port", async () => {
    const { server, port } = await listening();
    try {
      expect(await probePort(port, 400)).toBe(true);
    } finally {
      server.close();
    }
    expect(await probePort(await closedPort(), 400)).toBe(false);
  });
});

// ── listInstances ──────────────────────────────────────────────────────────
describe("listInstances", () => {
  const self: SelfRecord = {
    pid: process.pid,
    label: "current",
    port: 7357,
    mode: "foreground",
    startedAt: "2026-09-01T00:00:00.000Z",
  };

  it("filters dead / junk / empty, probes live ports, merges self, sorts", async () => {
    const { server, port: livePort } = await listening();
    const wedgedPort = await closedPort();
    const [ALIVE1, ALIVE2, ALIVE3] = [555_001, 555_002, 555_003];
    const alive = new Set([process.pid, ALIVE1, ALIVE2, ALIVE3]);
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (alive.has(Number(pid))) return true;
      const e = new Error("ESRCH") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });

    const mk = (name: string, r: Partial<InstanceRuntime>) => {
      const dir = join(root, "instances", name);
      mkdirSync(dir, { recursive: true });
      writeRuntimeFile(dir, sampleRuntime(r));
      return dir;
    };
    mk("zeta", { pid: ALIVE1, port: null, label: "zeta", mode: "background" }); // → stdio
    mk("alpha", { pid: ALIVE2, port: livePort, label: "alpha" }); // → responding
    mk("wedged", { pid: ALIVE3, port: wedgedPort, label: "wedged" }); // → not-responding
    const deadDir = mk("dead", { pid: DEAD_PID, label: "dead" });
    mkdirSync(join(root, "instances", "empty"), { recursive: true });
    mkdirSync(join(root, "instances", "junk"), { recursive: true });
    writeFileSync(join(root, "instances", "junk", RUNTIME_FILENAME), "nope");
    // A stale self file in the root: listInstances must dedupe it against the
    // authoritative in-process `self` (data-model.md §3).
    writeRuntimeFile(root, sampleRuntime({ pid: process.pid, port: 1, label: "STALE" }));

    let rows;
    try {
      rows = await listInstances(root, self, { probeTimeoutMs: 400 });
    } finally {
      server.close();
    }

    // current row first and authoritative (not the stale port:1 / label:"STALE")
    expect(rows[0]).toMatchObject({
      pid: process.pid,
      isCurrent: true,
      port: 7357,
      label: "current",
      state: "responding",
    });
    expect(rows.filter((r) => r.pid === process.pid)).toHaveLength(1);
    // dead-PID file was reclaimed
    expect(existsSync(join(deadDir, RUNTIME_FILENAME))).toBe(false);
    // junk / empty skipped; three survivors, sorted by label
    const others = rows.slice(1);
    expect(others.map((r) => r.label)).toEqual(["alpha", "wedged", "zeta"]);
    expect(others.find((r) => r.label === "alpha")).toMatchObject({ state: "responding", isCurrent: false });
    expect(others.find((r) => r.label === "wedged")).toMatchObject({ state: "not-responding" });
    expect(others.find((r) => r.label === "zeta")).toMatchObject({ state: "stdio", mode: "background" });
  });

  it("never throws on a broken tree and always returns the self row", async () => {
    writeFileSync(join(root, "instances"), "not a dir"); // readdir will ENOTDIR
    const rows = await listInstances(root, self, { probeTimeoutMs: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0].isCurrent).toBe(true);
  });
});

// ── closeInstance ──────────────────────────────────────────────────────────
describe("closeInstance", () => {
  it("SIGTERM on an already-gone pid → alreadyGone", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("ESRCH") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    expect(await closeInstance(DEAD_PID, { graceMs: 100 })).toEqual({ ok: true, alreadyGone: true });
  });

  it("EPERM → { ok: false }", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("EPERM") as NodeJS.ErrnoException;
      e.code = "EPERM";
      throw e;
    });
    const r = await closeInstance(12345, { graceMs: 100 });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("not permitted") });
  });

  it("graceful: target dies within the grace window → ok, not forced", async () => {
    vi.useFakeTimers();
    const alive = new Set([999_001]);
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, sig) => {
      if (sig === "SIGTERM") {
        setTimeout(() => alive.delete(Number(pid)), 600);
        return true;
      }
      if (alive.has(Number(pid))) return true;
      const e = new Error("ESRCH") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    const p = closeInstance(999_001, { graceMs: 5000 });
    await vi.advanceTimersByTimeAsync(5300);
    expect(await p).toEqual({ ok: true });
    expect(kill).toHaveBeenCalledWith(999_001, "SIGTERM");
    expect(kill).not.toHaveBeenCalledWith(999_001, "SIGKILL");
    vi.useRealTimers();
  });

  it("forced: target survives the grace window → SIGKILL, forced:true", async () => {
    vi.useFakeTimers();
    const alive = new Set([999_002]);
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, sig) => {
      if (sig === "SIGKILL") {
        alive.delete(Number(pid));
        return true;
      }
      if (sig === "SIGTERM") return true;
      if (alive.has(Number(pid))) return true;
      const e = new Error("ESRCH") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    const p = closeInstance(999_002, { graceMs: 5000 });
    await vi.advanceTimersByTimeAsync(5300);
    expect(await p).toEqual({ ok: true, forced: true });
    expect(kill).toHaveBeenCalledWith(999_002, "SIGKILL");
    vi.useRealTimers();
  });
});
