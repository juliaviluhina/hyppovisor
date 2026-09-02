// Local instance registry (feature 014) — discovery + shutdown for the
// instance-management panel. See specs/014-instance-management/data-model.md §4
// and contracts/instance-registry.md / contracts/instance-shutdown.md.
//
// This module touches only the filesystem, loopback TCP, and `process.kill` — it
// never imports Electron, so `tests/unit` drives it directly. Discovery is N
// independent per-instance files (`<profile>/runtime.json`), each written by its
// owner alone: no shared index, no lock, no daemon (Principle III, 1.5.0).

import { connect } from "node:net";
import { readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InstanceMode, InstanceRuntime, InstanceSummary } from "../../shared/types.js";

export const RUNTIME_FILENAME = "runtime.json";

/** The authoritative in-process view of the current instance, passed from `index.ts`
 *  so the current row never depends on this process's own file being readable. */
export interface SelfRecord {
  pid: number;
  label: string;
  port: number | null;
  mode: InstanceMode;
  startedAt: string;
}

type CloseResult =
  | { ok: true; forced?: boolean; alreadyGone?: boolean }
  | { ok: false; error: string };

// ── runtime.json read / write ──────────────────────────────────────────────

/** Atomic overwrite of `<profileDir>/runtime.json` (temp write + rename), like `settings.ts`. */
export function writeRuntimeFile(
  profileDir: string,
  r: Omit<InstanceRuntime, "schema">,
): void {
  const doc: InstanceRuntime = { schema: 1, ...r };
  const target = join(profileDir, RUNTIME_FILENAME);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n");
  renameSync(tmp, target);
}

/** Re-write the file with a new `port`, preserving `startedAt` and the rest.
 *  A no-op when the file is absent or unreadable (nothing to patch). */
export function rewriteRuntimePort(profileDir: string, port: number | null): void {
  const cur = readRuntimeFile(profileDir);
  if (!cur) return;
  writeRuntimeFile(profileDir, {
    pid: cur.pid,
    port,
    mode: cur.mode,
    label: cur.label,
    startedAt: cur.startedAt,
  });
}

/** Best-effort removal of `<profileDir>/runtime.json`; swallows "not there". */
export function clearRuntimeFile(profileDir: string): void {
  try {
    unlinkSync(join(profileDir, RUNTIME_FILENAME));
  } catch {
    /* ENOENT / races — nothing to clear */
  }
}

/** Parse + schema-guard `<profileDir>/runtime.json`. `null` on any problem
 *  (absent, unreadable, non-JSON, wrong `schema`, missing / wrong-typed field). */
export function readRuntimeFile(profileDir: string): InstanceRuntime | null {
  let text: string;
  try {
    text = readFileSync(join(profileDir, RUNTIME_FILENAME), "utf8");
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.schema !== 1) return null;
  if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) return null;
  if (o.port !== null && (typeof o.port !== "number" || !Number.isInteger(o.port))) return null;
  if (o.mode !== "foreground" && o.mode !== "background") return null;
  if (typeof o.label !== "string") return null;
  if (typeof o.startedAt !== "string") return null;
  return {
    schema: 1,
    pid: o.pid,
    port: o.port as number | null,
    mode: o.mode,
    label: o.label,
    startedAt: o.startedAt,
  };
}

// ── enumeration / liveness / probe ─────────────────────────────────────────

/** `[appSupportRoot, ...each immediate subdirectory of appSupportRoot/instances/]`.
 *  Tolerates a missing `instances/` directory (returns just the root). */
export function enumerateProfiles(appSupportRoot: string): string[] {
  const dirs = [appSupportRoot];
  try {
    for (const ent of readdirSync(join(appSupportRoot, "instances"), { withFileTypes: true })) {
      if (ent.isDirectory()) dirs.push(join(appSupportRoot, "instances", ent.name));
    }
  } catch {
    /* no instances/ dir yet — the root alone is fine */
  }
  return dirs;
}

/** `true` when a process with `pid` exists. `EPERM` ⇒ alive but owned by another
 *  user (still counts as alive); `ESRCH` / anything else ⇒ not alive. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Bare loopback TCP connect to `127.0.0.1:port`. Resolves `true` on connect,
 *  `false` on error / timeout. No HTTP, no MCP call, no token (Principle V). */
export function probePort(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    const sock = connect({ host: "127.0.0.1", port });
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

// ── list / close ──────────────────────────────────────────────────────────

/**
 * Enumerate the live instances of this user on this machine and merge in the
 * authoritative current-instance row. Never throws — a filesystem error on one
 * directory drops that directory only.
 */
export async function listInstances(
  appSupportRoot: string,
  self: SelfRecord,
  cfg: { probeTimeoutMs: number },
): Promise<InstanceSummary[]> {
  const survivors: InstanceRuntime[] = [];
  const seen = new Set<number>([self.pid]);

  for (const dir of enumerateProfiles(appSupportRoot)) {
    let r: InstanceRuntime | null;
    try {
      r = readRuntimeFile(dir);
    } catch {
      continue;
    }
    if (!r) continue;
    if (!isPidAlive(r.pid)) {
      try {
        unlinkSync(join(dir, RUNTIME_FILENAME));
      } catch {
        /* best-effort stale-file reclaim */
      }
      continue;
    }
    if (seen.has(r.pid)) continue;
    seen.add(r.pid);
    survivors.push(r);
  }

  const probed = await Promise.all(
    survivors.map(async (r): Promise<InstanceSummary> => {
      const state: InstanceSummary["state"] =
        r.port === null
          ? "stdio"
          : (await probePort(r.port, cfg.probeTimeoutMs))
            ? "responding"
            : "not-responding";
      return {
        pid: r.pid,
        label: r.label,
        port: r.port,
        mode: r.mode,
        state,
        isCurrent: false,
        startedAt: r.startedAt,
      };
    }),
  );

  const selfRow: InstanceSummary = {
    pid: self.pid,
    label: self.label,
    port: self.port,
    mode: self.mode,
    state: self.port === null ? "stdio" : "responding",
    isCurrent: true,
    startedAt: self.startedAt,
  };

  const rest = probed.sort(
    (a, b) => a.label.localeCompare(b.label) || (a.port ?? 0) - (b.port ?? 0),
  );
  return [selfRow, ...rest];
}

/**
 * Shut down another instance: `SIGTERM`, poll liveness every 250 ms, escalate to
 * `SIGKILL` after `graceMs`. Idempotent — a already-gone target resolves `{ ok:
 * true, alreadyGone: true }`. See contracts/instance-shutdown.md.
 */
export async function closeInstance(
  pid: number,
  cfg: { graceMs: number },
): Promise<CloseResult> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return { ok: true, alreadyGone: true };
    if (code === "EPERM") return { ok: false, error: "not permitted (different user)" };
    return { ok: false, error: (e as Error).message };
  }

  const deadline = Date.now() + cfg.graceMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return { ok: true };
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!isPidAlive(pid)) return { ok: true };

  try {
    process.kill(pid, "SIGKILL");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") return { ok: true };
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true, forced: true };
}
