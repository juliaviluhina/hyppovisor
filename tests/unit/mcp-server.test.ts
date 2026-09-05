import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { generateToken, startHttpMcpServer } from "../../src/main/mcp/server.js";
import type { ToolDeps } from "../../src/main/mcp/tools.js";

const deps = {} as ToolDeps;

async function occupiedPort(): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => res.end("occupied"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as { port: number }).port };
}

describe("MCP transport security defaults", () => {
  it("generates a random hex token", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

});

describe("MCP lifecycle failures", () => {
  it("reports a startup bind failure through the lifecycle callback", async () => {
    const occupied = await occupiedPort();
    const failures: Array<{ error: unknown; subsystem: string }> = [];
    try {
      await expect(
        startHttpMcpServer(deps, {
          port: occupied.port,
          token: null,
          onOperationalError: (error, subsystem) => failures.push({ error, subsystem }),
        }),
      ).rejects.toThrow();
      expect(failures.some((f) => f.subsystem === "http-bind")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => occupied.server.close(() => resolve()));
    }
  });

  it("leaves the old listener in place when a rebind fails", async () => {
    const handle = await startHttpMcpServer(deps, { port: 0, token: null });
    const occupied = await occupiedPort();
    try {
      // The occupied socket makes the replacement bind fail before old.close().
      await expect(
        handle.rebind(occupied.port),
      ).rejects.toThrow();
      expect(handle.port).toBe(0);
    } finally {
      handle.close();
      await new Promise<void>((resolve) => occupied.server.close(() => resolve()));
    }
  });

  it("allows close to be called repeatedly without throwing", async () => {
    const handle = await startHttpMcpServer(deps, { port: 0, token: null });
    expect(() => {
      handle.close();
      handle.close();
    }).not.toThrow();
  });
});
