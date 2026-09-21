// Feature 007 (T009) — connection snippet builders and the About-text
// consistency guard. See contracts/connection-snippets.md §8.

import { describe, it, expect } from "vitest";
import { TOOL_NAMES } from "../../src/main/mcp/tools.js";
import {
  ABOUT_TEXT,
  endpointUrl,
  mcpAddCommand,
  mcpJsonConfig,
  stdioJsonConfig,
  blocksForRow,
  type SnippetState,
} from "../../src/renderer/snippets.js";

const FORBIDDEN = /Bearer|Authorization|HyppoGraph|orchestrator|dashboard|queue|pipeline/i;

describe("ABOUT_TEXT", () => {
  it("names the app and every MCP tool", () => {
    expect(ABOUT_TEXT).toContain("HyppoVisor");
    for (const name of TOOL_NAMES) expect(ABOUT_TEXT).toContain(name);
    expect(ABOUT_TEXT).toContain("choose_option");
  });

  it("states the never-does guarantees", () => {
    for (const verb of ["submit", "send", "apply", "connect", "authenticat", "Enter", "logged"]) {
      expect(ABOUT_TEXT).toContain(verb);
    }
  });

  it("carries no secret and no orchestrator/board wording", () => {
    expect(ABOUT_TEXT).not.toMatch(FORBIDDEN);
  });
});

describe("endpointUrl", () => {
  it("is loopback with the given port", () => {
    expect(endpointUrl(7357)).toBe("http://127.0.0.1:7357/mcp");
    expect(endpointUrl(8080)).toBe("http://127.0.0.1:8080/mcp");
  });
});

const noToken: SnippetState = { port: 7357, tokenRequired: false, token: null };
const withToken: SnippetState = { port: 7357, tokenRequired: true, token: "abc123" };

describe("mcpAddCommand", () => {
  it("no token → no Authorization header argument", () => {
    const cmd = mcpAddCommand(noToken);
    expect(cmd).toBe(
      "claude mcp add --transport http --scope user hyppovisor http://127.0.0.1:7357/mcp",
    );
    expect(cmd).not.toContain("Authorization");
  });

  it("token → one appended --header argument", () => {
    const cmd = mcpAddCommand(withToken);
    expect(cmd).toContain('--header "Authorization: Bearer abc123"');
    expect(cmd.startsWith("claude mcp add --transport http --scope user hyppovisor ")).toBe(true);
  });
});

describe("mcpJsonConfig", () => {
  it("parses for every combination with exactly one server key", () => {
    for (const s of [noToken, withToken, { ...noToken, port: 65535 }]) {
      const obj = JSON.parse(mcpJsonConfig(s));
      expect(Object.keys(obj.mcpServers)).toEqual(["hyppovisor"]);
      expect(obj.mcpServers.hyppovisor.url).toBe(endpointUrl(s.port));
    }
  });

  it("no token → no headers key", () => {
    const obj = JSON.parse(mcpJsonConfig(noToken));
    expect(obj.mcpServers.hyppovisor.headers).toBeUndefined();
    expect(mcpJsonConfig(noToken)).not.toContain("Authorization");
  });

  it("token → headers.Authorization is the bearer string", () => {
    const obj = JSON.parse(mcpJsonConfig(withToken));
    expect(obj.mcpServers.hyppovisor.headers.Authorization).toBe("Bearer abc123");
  });
});

describe("stdioJsonConfig", () => {
  it("carries the launch command, args, and the stdio env flag", () => {
    const obj = JSON.parse(
      stdioJsonConfig({ command: "/x/electron", args: ["/x/dist/main/index.js"], env: { HYPPO_MCP_STDIO: "1" } }),
    );
    expect(obj.mcpServers.hyppovisor.command).toBe("/x/electron");
    expect(obj.mcpServers.hyppovisor.args).toEqual(["/x/dist/main/index.js"]);
    expect(obj.mcpServers.hyppovisor.env).toEqual({ HYPPO_MCP_STDIO: "1" });
  });
});

// ── feature 012 — per-instance server name ──────────────────────────────────
describe("serverName threading (feature 012)", () => {
  const named: SnippetState = { port: 7358, tokenRequired: false, token: null, serverName: "hyppovisor-work" };

  it("mcpAddCommand uses the given serverName as the add name", () => {
    expect(mcpAddCommand(named)).toBe(
      "claude mcp add --transport http --scope user hyppovisor-work http://127.0.0.1:7358/mcp",
    );
  });

  it("mcpJsonConfig keys mcpServers by the given serverName", () => {
    const obj = JSON.parse(mcpJsonConfig(named));
    expect(Object.keys(obj.mcpServers)).toEqual(["hyppovisor-work"]);
    expect(obj.mcpServers["hyppovisor-work"].url).toBe("http://127.0.0.1:7358/mcp");
  });

  it("stdioJsonConfig keys mcpServers by the given serverName", () => {
    const obj = JSON.parse(
      stdioJsonConfig(
        { command: "/x/electron", args: ["/x/index.js", "--instance", "work"], env: { HYPPO_MCP_STDIO: "1" } },
        "hyppovisor-work",
      ),
    );
    expect(Object.keys(obj.mcpServers)).toEqual(["hyppovisor-work"]);
  });

  it("omitting serverName keeps the bare hyppovisor default", () => {
    expect(mcpAddCommand(noToken)).toContain(" hyppovisor http://");
    expect(Object.keys(JSON.parse(mcpJsonConfig(noToken)).mcpServers)).toEqual(["hyppovisor"]);
    expect(Object.keys(JSON.parse(stdioJsonConfig({ command: "e", args: [], env: { HYPPO_MCP_STDIO: "1" } })).mcpServers)).toEqual(["hyppovisor"]);
  });
});

// ── feature 028 — per-row settings copy ──────────────────────────────────────
describe("blocksForRow (feature 028)", () => {
  const launch = { command: "/x/electron", args: ["/x/index.js"], env: { HYPPO_MCP_STDIO: "1" } as const };
  const live = {
    serverName: "hyppovisor-hid",
    transport: "http" as const,
    port: 7358,
    tokenRequired: true,
    token: "tok123",
    state: "live" as const,
  };

  it("live HTTP rows reuse the panel builders byte-for-byte (FR-007)", () => {
    const out = blocksForRow(live)!;
    expect(out.command).toBe(mcpAddCommand({ port: 7358, tokenRequired: true, token: "tok123", serverName: "hyppovisor-hid" }));
    expect(out.json).toBe(mcpJsonConfig({ port: 7358, tokenRequired: true, token: "tok123", serverName: "hyppovisor-hid" }));
    expect(out.command).toContain("hyppovisor-hid http://127.0.0.1:7358/mcp");
    expect(JSON.parse(out.json).mcpServers["hyppovisor-hid"].headers.Authorization).toBe("Bearer tok123");
  });

  it("auth-off rows omit the header (clarify Q1)", () => {
    const out = blocksForRow({ ...live, tokenRequired: false, token: null })!;
    expect(out.command).not.toContain("Authorization");
    expect(JSON.parse(out.json).mcpServers["hyppovisor-hid"].headers).toBeUndefined();
  });

  it("unreachable rows carry a marker that survives pasting", () => {
    const out = blocksForRow({ ...live, state: "unreachable" })!;
    expect(out.command.startsWith("#")).toBe(true);
    expect(out.command).toContain("hyppovisor-hid http://127.0.0.1:7358/mcp");
    const obj = JSON.parse(out.json);
    expect(obj.mcpServers["hyppovisor-hid"].headers.Authorization).toBe("Bearer tok123");
    expect(typeof obj._note).toBe("string");
  });

  it("unavailable rows and HTTP rows without a port offer nothing", () => {
    expect(blocksForRow({ ...live, state: "unavailable" })).toBeNull();
    expect(blocksForRow({ ...live, port: null })).toBeNull();
  });

  it("stdio rows get the stdio launch command and JSON (clarify Q3)", () => {
    const out = blocksForRow(
      { serverName: "hyppovisor-std", transport: "stdio", port: null, tokenRequired: false, token: null, state: "live" },
      launch,
    )!;
    expect(out.command).toBe("HYPPO_MCP_STDIO=1 /x/electron /x/index.js");
    const obj = JSON.parse(out.json);
    expect(obj.mcpServers["hyppovisor-std"].env).toEqual({ HYPPO_MCP_STDIO: "1" });
  });

  it("stdio rows without launch coordinates offer nothing", () => {
    expect(
      blocksForRow({ serverName: "hyppovisor-std", transport: "stdio", port: null, tokenRequired: false, token: null, state: "live" }),
    ).toBeNull();
  });
});
