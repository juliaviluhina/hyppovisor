// Feature 028 — per-row settings assembly: server names, sibling file
// reads, liveness mapping, and the never-fabricate rule. Filesystem-only
// (temp profiles); no Electron, no network beyond a loopback probe of a
// closed port. See research.md R1/R5.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  serverNameForLabel,
  findProfileDirByPid,
  readPersistedAuth,
  readInstanceSettings,
  type SelfAuth,
} from "../../src/main/instances/settings-copy.js";
import type { SelfRecord } from "../../src/main/instances/registry.js";

const TOKEN = "0123456789abcdef0123456789abcdef";
const selfAuth: SelfAuth = { tokenRequired: true, token: TOKEN };

let root = "";
const self = (over: Partial<SelfRecord> = {}): SelfRecord => ({
  pid: process.pid,
  label: "",
  port: 7357,
  mode: "foreground",
  startedAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hyppo-settings-copy-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function profile(
  name: string,
  runtime: Record<string, unknown>,
  settings: Record<string, unknown> | null,
): string {
  // enumerateProfiles scans <root> (the default instance) plus
  // <root>/instances/* — named profiles live in the latter.
  const dir = join(root, "instances", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "runtime.json"), JSON.stringify({ schema: 1, ...runtime }));
  if (settings !== null) {
    writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
  }
  return dir;
}

const settingsDoc = (tokenRequired: boolean) => ({
  port: 7358,
  tokenRequired,
  token: tokenRequired ? TOKEN : null,
});

describe("serverNameForLabel — research.md R3", () => {
  it("derives hyppovisor[-label]", () => {
    expect(serverNameForLabel("")).toBe("hyppovisor");
    expect(serverNameForLabel("hid")).toBe("hyppovisor-hid");
  });
});

describe("findProfileDirByPid / readPersistedAuth — strict file reads", () => {
  it("finds a profile by runtime pid and parses valid settings", () => {
    const dir = profile("a", { pid: 4242, port: 7358, mode: "background", label: "a", startedAt: "t" }, settingsDoc(true));
    expect(findProfileDirByPid(root, 4242)).toBe(dir);
    expect(readPersistedAuth(dir)).toEqual({ tokenRequired: true, token: TOKEN });
  });
  it("returns null for unknown pids, missing files, and corrupt content", () => {
    expect(findProfileDirByPid(root, 4243)).toBeNull();
    const dir = profile("b", { pid: 4244, port: 7358, mode: "background", label: "b", startedAt: "t" }, null);
    expect(readPersistedAuth(dir)).toBeNull();
    writeFileSync(join(dir, "settings.json"), "{not json");
    expect(readPersistedAuth(dir)).toBeNull();
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ port: "x", tokenRequired: true, token: TOKEN }));
    expect(readPersistedAuth(dir)).toBeNull();
  });
});

describe("readInstanceSettings — row assembly (data-model.md §1)", () => {
  // A real spawned sleeper stands in for the foreign instance: its pid is
  // alive on every platform (pid 1 is not, on Windows), while its closed port
  // never responds — so rows using it are deterministically "not-responding".
  let sleeper: ChildProcess | null = null;
  beforeEach(() => {
    sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
      stdio: "ignore",
    });
  });
  afterEach(() => {
    sleeper?.kill();
    sleeper = null;
  });
  const FOREIGN_PID = () => sleeper!.pid!;

  it("returns null for a pid with no listed row", async () => {
    await expect(
      readInstanceSettings(root, self(), selfAuth, { probeTimeoutMs: 50 }, 424299),
    ).resolves.toBeNull();
  });
  it("assembles the own row from in-process auth (FR-007)", async () => {
    const out = await readInstanceSettings(root, self(), selfAuth, { probeTimeoutMs: 50 }, process.pid);
    expect(out).toMatchObject({
      serverName: "hyppovisor",
      transport: "http",
      port: 7357,
      tokenRequired: true,
      token: TOKEN,
      state: "live",
      authNote: null,
    });
  });
  it("marks unreachable rows last-known with persisted token (FR-005)", async () => {
    profile("hid", { pid: FOREIGN_PID(), port: 7358, mode: "background", label: "hid", startedAt: "t" }, settingsDoc(true));
    const out = await readInstanceSettings(root, self(), selfAuth, { probeTimeoutMs: 50 }, FOREIGN_PID());
    expect(out).toMatchObject({
      serverName: "hyppovisor-hid",
      transport: "http",
      port: 7358,
      tokenRequired: true,
      token: TOKEN,
      state: "unreachable",
    });
  });
  it("omits the token with a note when auth is off (clarify Q1)", async () => {
    profile("open", { pid: FOREIGN_PID(), port: 7359, mode: "foreground", label: "open", startedAt: "t" }, settingsDoc(false));
    const out = await readInstanceSettings(root, self(), selfAuth, { probeTimeoutMs: 50 }, FOREIGN_PID());
    expect(out?.state).toBe("unreachable");
    expect(out?.tokenRequired).toBe(false);
    expect(out?.token).toBeNull();
    expect(out?.authNote).toMatch(/auth is off/);
  });
  it("yields unavailable — never fabricated — for unreadable settings (clarify Q2)", async () => {
    profile("bad", { pid: FOREIGN_PID(), port: 7360, mode: "background", label: "bad", startedAt: "t" }, null);
    const out = await readInstanceSettings(root, self(), selfAuth, { probeTimeoutMs: 50 }, FOREIGN_PID());
    expect(out?.state).toBe("unavailable");
    expect(out?.token).toBeNull();
  });
  it("serves stdio rows as live with null port and no token (bearer is HTTP-scoped)", async () => {
    profile(
      "std",
      { pid: FOREIGN_PID(), port: null, mode: "background", label: "std", startedAt: "t" },
      settingsDoc(true),
    );
    const out = await readInstanceSettings(root, self(), selfAuth, { probeTimeoutMs: 50 }, FOREIGN_PID());
    // stdio rows skip the TCP probe; pid 1 is alive so the row is live.
    expect(out).toMatchObject({
      transport: "stdio",
      port: null,
      state: "live",
      tokenRequired: false,
      token: null,
    });
  });
});
