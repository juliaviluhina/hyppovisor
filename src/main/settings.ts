// Persisted connection settings for the MCP endpoint (feature 007).
//
// One small plaintext file, `<userData>/settings.json`, holding exactly
// `{ port, tokenRequired, token }`. Human-readable, safe to delete. This module
// touches the filesystem only — it takes `userDataDir` as an argument and never
// imports Electron — so `tests/unit` can drive it directly.
//
// Precedence for the value in force (contracts/settings-file.md): an environment
// variable wins over this file, which wins over the built-in default. A missing
// or malformed file falls back to defaults without throwing and without being
// rewritten on read (research.md R3).

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultMcpPort, mcpHost } from "./config.js";
import type {
  ConnectionSettings,
  ConnectionSource,
  EffectiveConnection,
} from "../shared/types.js";

export const SETTINGS_FILENAME = "settings.json";

export const DEFAULTS: ConnectionSettings = {
  port: defaultMcpPort,
  tokenRequired: false,
  token: null,
};

const isPort = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535;

const isHexToken = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{32}$/.test(s);

/** Validate a parsed object against the settings schema (contracts/settings-file.md). */
function validate(raw: unknown): ConnectionSettings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isPort(o.port)) return null;
  if (typeof o.tokenRequired !== "boolean") return null;
  if (o.tokenRequired) {
    if (!isHexToken(o.token)) return null;
  } else if (o.token !== null) {
    return null;
  }
  return { port: o.port, tokenRequired: o.tokenRequired, token: o.tokenRequired ? (o.token as string) : null };
}

/**
 * Read `<userDataDir>/settings.json`. Returns `DEFAULTS` with `existed: false`
 * when the file is absent, unreadable, not JSON, or fails the schema — and
 * never rewrites it in that case.
 */
export function loadSettings(userDataDir: string): {
  settings: ConnectionSettings;
  existed: boolean;
} {
  let text: string;
  try {
    text = readFileSync(join(userDataDir, SETTINGS_FILENAME), "utf8");
  } catch {
    return { settings: { ...DEFAULTS }, existed: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { settings: { ...DEFAULTS }, existed: false };
  }
  const valid = validate(parsed);
  if (!valid) return { settings: { ...DEFAULTS }, existed: false };
  return { settings: valid, existed: true };
}

/** Overwrite `<userDataDir>/settings.json` atomically (temp write + rename). */
export function saveSettings(userDataDir: string, settings: ConnectionSettings): void {
  const target = join(userDataDir, SETTINGS_FILENAME);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmp, target);
}

export interface EnvOverrides {
  /** `HYPPO_MCP_PORT`, parsed and range-checked; `undefined` when unset or invalid. */
  port?: number;
  /** `HYPPO_MCP_TOKEN` trimmed; `undefined` when unset or set-but-empty. */
  token?: string;
  /** `HYPPO_MCP_STDIO === "1"`. */
  stdio: boolean;
}

/** Read the three MCP environment variables, reproducing the pre-feature-007 parsing. */
export function readEnvOverrides(env: NodeJS.ProcessEnv = process.env): EnvOverrides {
  const rawPort = Number(env.HYPPO_MCP_PORT);
  const port = isPort(rawPort) ? rawPort : undefined;
  const token = env.HYPPO_MCP_TOKEN?.trim() || undefined;
  return { port, token, stdio: env.HYPPO_MCP_STDIO === "1" };
}

function sourceFor(fromEnv: boolean, existed: boolean): ConnectionSource {
  if (fromEnv) return "env";
  return existed ? "persisted" : "default";
}

/**
 * Fold the persisted settings and the environment into the read-only state the
 * panel renders. `lastRequest` is filled by the caller.
 */
export function resolveEffective(
  settings: ConnectionSettings,
  env: EnvOverrides,
  existed: boolean,
): EffectiveConnection {
  const port = env.port ?? settings.port;
  const tokenFromEnv = env.token !== undefined;
  const tokenRequired = tokenFromEnv ? true : settings.tokenRequired;
  const token = tokenFromEnv
    ? (env.token as string)
    : settings.tokenRequired
      ? settings.token
      : null;

  return {
    transport: env.stdio ? "stdio" : "http",
    port,
    endpointUrl: env.stdio ? "" : `http://${mcpHost}:${port}/mcp`,
    tokenRequired,
    token,
    portSource: sourceFor(env.port !== undefined, existed),
    tokenSource: sourceFor(tokenFromEnv, existed),
    lastRequest: null,
  };
}
