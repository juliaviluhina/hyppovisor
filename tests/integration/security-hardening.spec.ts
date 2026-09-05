import { test, expect } from "@playwright/test";
import { launchAppFull, mcpPost } from "./helpers.js";

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "security", version: "0" } },
};

test("fresh HTTP profiles require the generated token and chrome declares a restrictive CSP", async () => {
  const { app, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();
    const conn = await page.evaluate(() =>
      (window as unknown as { hyppo: { getConnection: () => Promise<Record<string, unknown>> } }).hyppo.getConnection(),
    );
    const token = conn.token as string;
    expect(conn.tokenRequired).toBe(true);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect((await mcpPost(7357, INIT)).status).toBe(401);
    expect((await mcpPost(7357, INIT, { Authorization: `Bearer ${token}` })).status).toBe(200);

    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
  } finally {
    await close();
  }
});
