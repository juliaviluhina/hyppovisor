// Feature 007 — the MCP connection panel, driven through the real renderer
// overlay and against a real 127.0.0.1:<port>/mcp listener. Launched with
// launchAppFull(): no HYPPO_E2E, an isolated temp HYPPO_USER_DATA_DIR.
//
// Sections mirror quickstart.md §2–§7.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { E2E_SERVER_NAME, launchAppFull, mcpPost, tempUserDataDir } from "./helpers.js";

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "conn-panel-spec", version: "0" },
  },
};

/** Read the current effective connection from the renderer bridge. */
const getConn = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { hyppo: { getConnection: () => Promise<Record<string, unknown>> } }).hyppo.getConnection());

// ── §2 — US1: see and copy ───────────────────────────────────────────────────
test("US1: panel shows the endpoint, a claude mcp add command, and a JSON block; each copies; Esc/backdrop close", async () => {
  const { app, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.locator("#hyppo").click();
    await expect(page.locator("#panel")).toBeVisible();

    const bodyText = () => page.locator("#panel-body").innerText();
    const token = (await getConn(page)).token as string;
    expect(await bodyText()).toContain("http://127.0.0.1:7357/mcp");
    expect(await bodyText()).toContain(
      `claude mcp add --transport http --scope user ${E2E_SERVER_NAME} http://127.0.0.1:7357/mcp`,
    );

    const jsonText = await page.locator('.section:has([data-copy="json"]) pre.snippet').innerText();
    const parsed = JSON.parse(jsonText);
    expect(Object.keys(parsed.mcpServers)).toEqual([E2E_SERVER_NAME]);
    expect(parsed.mcpServers[E2E_SERVER_NAME].url).toBe("http://127.0.0.1:7357/mcp");
    expect(parsed.mcpServers[E2E_SERVER_NAME].headers).toMatchObject({
      Authorization: expect.stringMatching(/^Bearer •+$/),
    });

    // Windows normalises clipboard line endings to CRLF on read-back; the
    // snippets are authored with LF, so compare on LF.
    const readClip = () =>
      app.evaluate(({ clipboard }) => clipboard.readText()).then((s) => s.replace(/\r\n/g, "\n"));
    for (const [kind, expected] of [
      ["endpoint", "http://127.0.0.1:7357/mcp"],
      ["command", `claude mcp add --transport http --scope user ${E2E_SERVER_NAME} http://127.0.0.1:7357/mcp --header "Authorization: Bearer ${token}"`],
    ] as const) {
      await page.locator(`[data-copy="${kind}"]`).click();
      await expect(page.locator(`[data-copy="${kind}"]`)).toHaveClass(/\bok\b/);
      await expect(page.locator(`[data-copy="${kind}"]`)).toHaveAttribute("title", "Copied");
      expect(await readClip()).toBe(expected);
    }
    await page.locator('[data-copy="json"]').click();
    const copiedJson = JSON.parse(await readClip());
    expect(copiedJson.mcpServers[E2E_SERVER_NAME].headers.Authorization).toBe(`Bearer ${token}`);

    await page.keyboard.press("Escape");
    await expect(page.locator("#panel")).toBeHidden();

    await page.locator("#hyppo").click();
    await expect(page.locator("#panel")).toBeVisible();
    await page.locator("#panel-close").click();
    await expect(page.locator("#panel")).toBeHidden();

    await page.locator("#hyppo").click();
    await expect(page.locator("#panel")).toBeVisible();
    await page.locator("#panel-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(page.locator("#panel")).toBeHidden();
  } finally {
    await close();
  }
});

// ── §3 — US2: set the port ──────────────────────────────────────────────────
test("US2: Apply rebinds live, persists, refuses a bad or in-use port without disturbing the listener; env port is read-only", async () => {
  let sacrificial: Server | undefined;
  const userDataDir = await tempUserDataDir();
  const { app, close } = await launchAppFull({}, userDataDir);
  try {
    const page = await app.firstWindow();
    await page.locator("#hyppo").click();
    const token = (await getConn(page)).token as string;
    const auth = { Authorization: `Bearer ${token}` };
    expect((await mcpPost(7357, INIT, auth)).status).toBe(200);

    // Apply 8080 → reachable there, not on 7357; snippets + notice update.
    await page.locator("#port-input").fill("8080");
    await page.locator("#port-apply").click();
    await expect(page.locator("#port-notice")).toContainText("8080");
    expect((await mcpPost(8080, INIT, auth)).status).toBe(200);
    expect((await mcpPost(7357, INIT)).status).toBe(0); // old port no longer served
    await expect(page.locator("#panel-body")).toContainText("http://127.0.0.1:8080/mcp");

    // Invalid port → refused, still on 8080.
    await page.locator("#port-input").fill("99999");
    await page.locator("#port-apply").click();
    await expect(page.locator("#port-notice")).toContainText("between 1 and 65535");
    expect((await mcpPost(8080, INIT, auth)).status).toBe(200);

    // In-use port → refused, still on 8080.
    sacrificial = createServer((_q, r) => r.end("x"));
    const p: number = await new Promise((res) =>
      sacrificial!.listen(0, "127.0.0.1", () => res((sacrificial!.address() as { port: number }).port)),
    );
    await page.locator("#port-input").fill(String(p));
    await page.locator("#port-apply").click();
    await expect(page.locator("#port-notice")).toContainText("in use");
    expect((await mcpPost(8080, INIT, auth)).status).toBe(200);
  } finally {
    sacrificial?.close();
    await close();
  }

  try {
    // Relaunch, same user-data dir, no env → still on 8080 and settings.json holds it.
    const again = await launchAppFull({}, userDataDir);
    try {
      const againPage = await again.app.firstWindow();
      const againToken = (await getConn(againPage)).token as string;
      expect((await mcpPost(8080, INIT, { Authorization: `Bearer ${againToken}` })).status).toBe(200);
      const saved = JSON.parse(readFileSync(join(userDataDir, "settings.json"), "utf8"));
      expect(saved.port).toBe(8080);
    } finally {
      await again.close();
    }

    // Relaunch with HYPPO_MCP_PORT set → the field is read-only.
    const withEnv = await launchAppFull({ HYPPO_MCP_PORT: "7000" }, userDataDir);
    try {
      const page = await withEnv.app.firstWindow();
      await page.locator("#hyppo").click();
      await expect(page.locator("#port-input")).toBeDisabled();
      await expect(page.locator("#port-notice")).toContainText("HYPPO_MCP_PORT");
    } finally {
      await withEnv.close();
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("lifecycle: a startup bind failure is visible as degraded in the connection panel", async () => {
  const occupied = createServer((_req, res) => res.end("occupied"));
  await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const port = (occupied.address() as { port: number }).port;
  const { app, close } = await launchAppFull({ HYPPO_MCP_PORT: String(port) });
  try {
    const page = await app.firstWindow();
    const connection = await getConn(page);
    expect(connection.lifecycle).toMatchObject({
      state: "degraded",
      failure: { subsystem: "http-bind", kind: "invariant" },
    });
    await page.locator("#hyppo").click();
    await expect(page.locator("#panel-body")).toContainText("DEGRADED");
    await expect(page.locator("#panel-body")).toContainText("restart HyppoVisor");
  } finally {
    await close();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});

// ── §4 — US3: require a token ───────────────────────────────────────────────
test("US3: toggle a bearer token — masked, enforced, revealable, regenerable, discarded on toggle-off; env token is read-only", async () => {
  const { app, userDataDir, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();
    await page.locator("#hyppo").click();
    const port = 7357;

    await page.locator("#token-required").check();
    await expect(page.locator("#token-field")).toBeVisible();

    // Masked: no 32-hex anywhere visible in the card, field shows only mask glyphs.
    expect(await page.locator("#token-field").inputValue()).toMatch(/^•+$/);
    expect(await page.locator("#panel-card").innerText()).not.toMatch(/[0-9a-f]{32}/);
    await expect(page.locator("#panel-body")).toContainText("Bearer");

    // Enforced.
    const token = (await getConn(page)).token as string;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect((await mcpPost(port, INIT)).status).toBe(401);
    expect((await mcpPost(port, INIT, { Authorization: `Bearer ${token}` })).status).toBe(200);

    // Copy while masked → real bearer string on the clipboard.
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator('[data-copy="command"]').click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(`Bearer ${token}`);

    // Reveal → the 32-hex value is now in the field and the snippets.
    await page.locator("#token-reveal").click();
    expect(await page.locator("#token-field").inputValue()).toBe(token);
    expect(await page.locator("#panel-card").innerText()).toMatch(/[0-9a-f]{32}/);

    // Regenerate → old token 401s, new one works.
    await page.locator("#token-regenerate").click();
    await expect(page.locator("#token-notice")).toContainText("reconnect");
    const token2 = (await getConn(page)).token as string;
    expect(token2).not.toBe(token);
    expect((await mcpPost(port, INIT, { Authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await mcpPost(port, INIT, { Authorization: `Bearer ${token2}` })).status).toBe(200);

    // Toggle off → open access again, token discarded on disk.
    await page.locator("#token-required").uncheck();
    await expect(page.locator("#token-field")).toBeHidden();
    expect((await mcpPost(port, INIT)).status).toBe(200);
    const saved = JSON.parse(readFileSync(join(userDataDir, "settings.json"), "utf8"));
    expect(saved).toMatchObject({ tokenRequired: false, token: null });
  } finally {
    await close();
  }

  // Relaunch with HYPPO_MCP_TOKEN → controls read-only, snippets carry the env token.
  const withEnv = await launchAppFull({ HYPPO_MCP_TOKEN: "envtok" });
  try {
    const page = await withEnv.app.firstWindow();
    await page.locator("#hyppo").click();
    await expect(page.locator("#token-required")).toHaveCount(0);
    await expect(page.locator("#token-regenerate")).toHaveCount(0);
    await expect(page.locator("#token-notice")).toContainText("HYPPO_MCP_TOKEN");
    await page.locator("#token-reveal").click();
    expect(await page.locator("#panel-body").innerText()).toContain("Bearer envtok");
  } finally {
    await withEnv.close();
  }
});

// ── §5 — US4: understand what this is ───────────────────────────────────────
test("US4: the About block names the app, every tool, and the guarantees; Copy is that text only; version + mascot shown", async () => {
  const { app, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();
    await app.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator("#hyppo").click();

    const about = await page.locator('.section:has([data-copy="about"]) pre.snippet').innerText();
    for (const s of [
      "HyppoVisor",
      "open_url",
      "list_open_tabs",
      "read_page",
      "read_form_fields",
      "navigate",
      "interact",
      "wait_for_selector",
      "submit",
      "logged",
    ]) {
      expect(about).toContain(s);
    }
    expect(about).not.toMatch(/Bearer|HyppoGraph|orchestrator|dashboard|queue|pipeline/i);

    await page.locator('[data-copy="about"]').click();
    const clip = (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    );
    expect(clip).toBe(about);
    expect(clip).not.toContain("Apache-2.0");

    const appVersion = (await getConn(page)).appVersion as string;
    await expect(page.locator("#panel-body")).toContainText(`Version ${appVersion} · Apache-2.0`);
    await expect(page.locator("#panel-mascot")).toHaveAttribute("alt", "HyppoVisor");
  } finally {
    await close();
  }
});

// ── §6 — US5: last request ─────────────────────────────────────────────────
test("US5: the last-request line starts empty, names a served request, and marks a rejected one", async () => {
  const { app, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();
    await page.locator("#hyppo").click();
    await expect(page.locator("#last-request")).toContainText("rejected");

    const token = (await getConn(page)).token as string;
    const auth = { Authorization: `Bearer ${token}` };

    // A tool call registers an "ok" entry.
    await mcpPost(7357, INIT, auth);
    await mcpPost(7357, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_open_tabs", arguments: {} },
    }, auth);
    await expect(page.locator("#last-request")).toContainText("list_open_tabs", { timeout: 4000 });
    expect(await page.locator("#last-request").innerText()).not.toMatch(/tab-\d|queueDepth/);

    // With a token required, an unauthenticated request shows as rejected.
    await page.locator("#token-required").check();
    await page.waitForTimeout(200);
    await mcpPost(7357, INIT);
    await expect(page.locator("#last-request")).toContainText("rejected", { timeout: 4000 });
  } finally {
    await close();
  }
});

// ── §7 — panel reflow + stdio mode ────────────────────────────────────────
test("§7: port + token changes reflow the panel and stay board-free; stdio mode drops the network controls", async () => {
  const { app, close } = await launchAppFull();
  try {
    const page = await app.firstWindow();
    await page.locator("#hyppo").click();
    await page.locator("#port-input").fill("8081");
    await page.locator("#port-apply").click();
    await expect(page.locator("#panel-body")).toContainText("http://127.0.0.1:8081/mcp");
    await page.locator("#token-required").check();
    await expect(
      page.locator('.section:has([data-copy="command"]) pre.snippet'),
    ).toContainText("Authorization: Bearer");
    expect(await page.locator("#panel-card").innerText()).not.toMatch(
      /board|HyppoGraph|orchestrator|dashboard|queue|pipeline/i,
    );
  } finally {
    await close();
  }

  const stdio = await launchAppFull({ HYPPO_MCP_STDIO: "1" });
  try {
    const page = await stdio.app.firstWindow();
    await page.locator("#hyppo").click();
    await expect(page.locator("#panel-body")).toContainText("stdio mode");
    await expect(page.locator("#port-input")).toHaveCount(0);
    const json = JSON.parse(
      await page.locator('.section:has([data-copy="stdio"]) pre.snippet').innerText(),
    );
    expect(json.mcpServers[E2E_SERVER_NAME].command.toLowerCase()).toContain("electron");
    expect(json.mcpServers[E2E_SERVER_NAME].args[0]).toMatch(/dist[/\\]main[/\\]index\.js$/);
    expect(json.mcpServers[E2E_SERVER_NAME].args).toContain("--instance");
    expect(json.mcpServers[E2E_SERVER_NAME].env).toEqual({ HYPPO_MCP_STDIO: "1" });
  } finally {
    await stdio.close();
  }
});
