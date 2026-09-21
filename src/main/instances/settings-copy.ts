// Per-row connection settings for the instance-list copy actions
// (feature 028, FR-001…FR-007, research.md R1).
//
// Filesystem only — never Electron, never the network — so `tests/unit`
// drives it directly. Reads the existing per-profile files at call time
// (`runtime.json` for the effective port via registry.ts, `settings.json`
// for the persisted token via settings.ts strict parse) and writes nothing.
// A sibling whose files are missing or invalid yields `unavailable`: the row
// offers no copy action rather than fabricated settings (clarify Q2).
//
// Known limitation (research.md R4): a sibling launched under
// `HYPPO_MCP_TOKEN` serves a token its file does not reflect. The copied
// block then 401s — fails closed, never misconnects.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RowSettings } from "../../shared/types.js";
import {
  enumerateProfiles,
  listInstances,
  readRuntimeFile,
  type SelfRecord,
} from "./registry.js";
import { parseSettingsContent, SETTINGS_FILENAME } from "../settings.js";

/** Canonical MCP server name (research.md R3, feature 012). Pure; unit-tested. */
export function serverNameForLabel(label: string): string {
  return label ? `hyppovisor-${label}` : "hyppovisor";
}

/** Profile directory whose runtime file names `pid`, or `null`. Pure filesystem scan. */
export function findProfileDirByPid(appSupportRoot: string, pid: number): string | null {
  for (const dir of enumerateProfiles(appSupportRoot)) {
    const r = readRuntimeFile(dir);
    if (r && r.pid === pid) return dir;
  }
  return null;
}

interface PersistedAuth {
  tokenRequired: boolean;
  token: string | null;
}

/** Strict read of a profile's persisted auth; `null` when absent/unreadable/invalid. */
export function readPersistedAuth(profileDir: string): PersistedAuth | null {
  let text: string;
  try {
    text = readFileSync(join(profileDir, SETTINGS_FILENAME), "utf8");
  } catch {
    return null;
  }
  const parsed = parseSettingsContent(text);
  if (!parsed) return null;
  return { tokenRequired: parsed.tokenRequired, token: parsed.token };
}

/** Shown when an instance runs with token auth off (clarify Q1). */
export const AUTH_OFF_NOTE =
  "Token auth is off on this instance — the block connects without a header.";

export interface SettingsProbe {
  probeTimeoutMs: number;
}

/** This process's own auth, supplied by the caller (index.ts) so the own row
 *  never depends on its settings file being readable (FR-007). */
export interface SelfAuth {
  tokenRequired: boolean;
  token: string | null;
}

/**
 * Assemble one list row's copyable connection data. Returns `null` when no
 * listed row has `pid` (unknown pid — nothing to copy). Never throws for
 * filesystem problems: those become `state: "unavailable"`.
 */
export async function readInstanceSettings(
  appSupportRoot: string,
  self: SelfRecord,
  selfAuth: SelfAuth,
  cfg: SettingsProbe,
  pid: number,
): Promise<RowSettings | null> {
  const rows = await listInstances(appSupportRoot, self, cfg);
  const row = rows.find((r) => r.pid === pid);
  if (!row) return null;

  const serverName = serverNameForLabel(row.label);
  const transport = row.port === null ? "stdio" : "http";
  // Bearer tokens are HTTP-scoped: a stdio row needs none, so it reports no
  // token regardless of what its settings file says (the file's auth flags
  // govern its HTTP listener, which a stdio instance does not run).
  if (transport === "stdio") {
    return {
      serverName,
      transport,
      port: null,
      tokenRequired: false,
      token: null,
      state: "live",
      authNote: null,
    };
  }
  const isSelf = pid === self.pid;
  const persisted = isSelf ? null : readPersistedAuthOf(appSupportRoot, pid);
  const auth: PersistedAuth | null = isSelf
    ? { tokenRequired: selfAuth.tokenRequired, token: selfAuth.token }
    : persisted;

  if (!auth) {
    // Unreadable settings (clarify Q2): the row offers no copy action rather
    // than fabricated settings — regardless of liveness.
    return {
      serverName,
      transport,
      port: row.port,
      tokenRequired: false,
      token: null,
      state: "unavailable",
      authNote: null,
    };
  }
  if (row.state === "not-responding") {
    return {
      serverName,
      transport,
      port: row.port,
      tokenRequired: auth.tokenRequired,
      token: auth.token,
      state: "unreachable",
      authNote: auth.tokenRequired ? null : AUTH_OFF_NOTE,
    };
  }
  if (!auth.tokenRequired) {
    return {
      serverName,
      transport,
      port: row.port,
      tokenRequired: false,
      token: null,
      state: "live",
      authNote: AUTH_OFF_NOTE,
    };
  }
  return {
    serverName,
    transport,
    port: row.port,
    tokenRequired: true,
    token: auth.token,
    state: "live",
    authNote: null,
  };
}

function readPersistedAuthOf(appSupportRoot: string, pid: number): PersistedAuth | null {
  const dir = findProfileDirByPid(appSupportRoot, pid);
  if (!dir) return null;
  return readPersistedAuth(dir);
}
