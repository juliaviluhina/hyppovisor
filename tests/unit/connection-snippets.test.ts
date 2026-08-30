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
