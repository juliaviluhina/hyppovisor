// Feature 005 / 008 — the MCP surface is exactly eight tools and
// `read_form_fields` accepts `{ tabId }` and `{ tabId, containerSelector }`.

import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, type ToolDeps } from "../../src/main/mcp/tools.js";

interface Captured {
  name: string;
  description: string;
  shape: z.ZodRawShape;
}

function capture(): { server: McpServer; tools: Captured[] } {
  const tools: Captured[] = [];
  const server = {
    tool: (name: string, description: string, shape: z.ZodRawShape) => {
      tools.push({ name, description, shape });
    },
  } as unknown as McpServer;
  return { server, tools };
}

describe("MCP tool surface (contracts/mcp-tools.md)", () => {
  const { server, tools } = capture();
  registerTools(server, {} as unknown as ToolDeps);

  it("registers exactly eight tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "interact",
        "list_open_tabs",
        "navigate",
        "open_url",
        "read_form_fields",
        "read_page",
        "screenshot",
        "wait_for_selector",
      ].sort(),
    );
  });

  it("read_form_fields accepts { tabId } and { tabId, containerSelector }, rejects {}", () => {
    const t = tools.find((x) => x.name === "read_form_fields")!;
    const schema = z.object(t.shape);
    expect(schema.safeParse({ tabId: "tab-1" }).success).toBe(true);
    expect(schema.safeParse({ tabId: "tab-1", containerSelector: "#form" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    // description states the key guarantees
    expect(t.description.toLowerCase()).toContain("read-only");
    expect(t.description.toLowerCase()).toContain("read_page");
  });
});
