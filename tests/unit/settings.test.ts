// Feature 007 (T005) — settings.json load / save / corrupt-file fallback and the
// env → persisted → default precedence resolver. See quickstart.md §1.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULTS,
  SETTINGS_FILENAME,
  loadSettings,
  saveSettings,
  readEnvOverrides,
  resolveEffective,
  type EnvOverrides,
} from "../../src/main/settings.js";
import type { ConnectionSettings } from "../../src/shared/types.js";

let dir: string;
const file = () => join(dir, SETTINGS_FILENAME);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hyppo-settings-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadSettings / saveSettings", () => {
  it("empty dir → DEFAULTS, existed:false", () => {
    expect(loadSettings(dir)).toEqual({ settings: DEFAULTS, existed: false });
  });

  it("round-trips a saved document and reports existed:true", () => {
    const s: ConnectionSettings = { port: 8080, tokenRequired: true, token: "a".repeat(32) };
    saveSettings(dir, s);
    const { settings, existed } = loadSettings(dir);
    expect(settings).toEqual(s);
    expect(existed).toBe(true);
  });

  it("writes pretty JSON with a trailing newline", () => {
    saveSettings(dir, DEFAULTS);
    const text = readFileSync(file(), "utf8");
    expect(text).toBe(JSON.stringify(DEFAULTS, null, 2) + "\n");
  });

  it("corrupt file → DEFAULTS, existed:false, file left byte-identical", () => {
    writeFileSync(file(), "{ not json");
    expect(loadSettings(dir)).toEqual({ settings: DEFAULTS, existed: false });
    expect(readFileSync(file(), "utf8")).toBe("{ not json");
  });

  it.each([
    ["port: 0", { port: 0, tokenRequired: false, token: null }],
    ["port: 70000", { port: 70000, tokenRequired: false, token: null }],
    ["port: 3.5", { port: 3.5, tokenRequired: false, token: null }],
    ["tokenRequired: 'yes'", { port: 7357, tokenRequired: "yes", token: null }],
    ["token set while not required", { port: 7357, tokenRequired: false, token: "x".repeat(32) }],
    ["required but token null", { port: 7357, tokenRequired: true, token: null }],
    ["required but token not hex", { port: 7357, tokenRequired: true, token: "not-hex" }],
  ])("schema violation (%s) → DEFAULTS", (_label, bad) => {
    writeFileSync(file(), JSON.stringify(bad));
    expect(loadSettings(dir)).toEqual({ settings: DEFAULTS, existed: false });
  });
});

describe("readEnvOverrides", () => {
  it("parses the three MCP vars", () => {
    expect(readEnvOverrides({ HYPPO_MCP_PORT: "9000" } as NodeJS.ProcessEnv)).toEqual({
      port: 9000,
      token: undefined,
      stdio: false,
    });
    expect(
      readEnvOverrides({ HYPPO_MCP_TOKEN: "  tok  ", HYPPO_MCP_STDIO: "1" } as NodeJS.ProcessEnv),
    ).toEqual({ port: undefined, token: "tok", stdio: true });
  });

  it("ignores an out-of-range or empty value", () => {
    expect(readEnvOverrides({ HYPPO_MCP_PORT: "0", HYPPO_MCP_TOKEN: "   " } as NodeJS.ProcessEnv)).toEqual(
      { port: undefined, token: undefined, stdio: false },
    );
  });
});

describe("resolveEffective", () => {
  const noEnv: EnvOverrides = { stdio: false };

  it("no env, file existed → persisted", () => {
    const e = resolveEffective({ port: 9000, tokenRequired: false, token: null }, noEnv, true);
    expect(e.port).toBe(9000);
    expect(e.portSource).toBe("persisted");
    expect(e.endpointUrl).toBe("http://127.0.0.1:9000/mcp");
    expect(e.transport).toBe("http");
  });

  it("no env, no file → default", () => {
    const e = resolveEffective(DEFAULTS, noEnv, false);
    expect(e.port).toBe(7357);
    expect(e.portSource).toBe("default");
  });

  it("env.port wins over the file", () => {
    const e = resolveEffective({ port: 9000, tokenRequired: false, token: null }, { port: 5555, stdio: false }, true);
    expect(e.port).toBe(5555);
    expect(e.portSource).toBe("env");
  });

  it("env.token forces tokenRequired with that value", () => {
    const e = resolveEffective(DEFAULTS, { token: "tok", stdio: false }, false);
    expect(e.tokenRequired).toBe(true);
    expect(e.token).toBe("tok");
    expect(e.tokenSource).toBe("env");
  });

  it("persisted token is surfaced only when required", () => {
    const withTok = resolveEffective(
      { port: 7357, tokenRequired: true, token: "b".repeat(32) },
      noEnv,
      true,
    );
    expect(withTok.token).toBe("b".repeat(32));
    expect(withTok.tokenSource).toBe("persisted");
  });

  it("env.stdio → stdio transport, empty endpoint", () => {
    const e = resolveEffective(DEFAULTS, { stdio: true }, false);
    expect(e.transport).toBe("stdio");
    expect(e.endpointUrl).toBe("");
    expect(e.serverStatus).toBe("stdio");
  });

  // ── feature 012 — the --port launch flag (cliPort) ─────────────────────────
  it("cliPort sits between env and persisted: used when no env, over persisted", () => {
    const e = resolveEffective({ port: 9000, tokenRequired: false, token: null }, noEnv, true, 7358);
    expect(e.port).toBe(7358);
    expect(e.portSource).toBe("cli");
  });

  it("env.port still wins over cliPort", () => {
    const e = resolveEffective(DEFAULTS, { port: 5555, stdio: false }, false, 7358);
    expect(e.port).toBe(5555);
    expect(e.portSource).toBe("env");
  });

  it("no cliPort → persisted / default unchanged", () => {
    expect(resolveEffective(DEFAULTS, noEnv, false).portSource).toBe("default");
    expect(resolveEffective(DEFAULTS, noEnv, false).serverStatus).toBe("listening");
  });

  it("carries feature-012 placeholders the caller overrides", () => {
    const e = resolveEffective(DEFAULTS, noEnv, false);
    expect(e.instanceLabel).toBe("");
    expect(e.serverName).toBe("hyppovisor");
  });
});
