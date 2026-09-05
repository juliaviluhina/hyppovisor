import { describe, expect, it } from "vitest";
import { generateToken } from "../../src/main/mcp/server.js";

describe("MCP transport security defaults", () => {
  it("generates a random hex token", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

});
