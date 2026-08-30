// MCP server. Two transports:
//
//  - HTTP (default for `npm start`): HyppoVisor runs as a long-lived app and
//    listens on loopback; Claude Code connects to the URL. Convenient, but a
//    local port that can drive a logged-in browser — see the security notes in
//    research.md R2 (revised). Bound to 127.0.0.1 only; set HYPPO_MCP_TOKEN to
//    require `Authorization: Bearer <token>`.
//
//  - stdio (HYPPO_MCP_STDIO=1): the MCP client spawns the app as a subprocess.
//    No open port. Use this when you don't want a listener.
//
// Every diagnostic goes to stderr; stdout is reserved for the stdio protocol.

import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools, type ToolDeps } from "./tools.js";

function makeServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "hyppovisor", version: "0.1.0" });
  registerTools(server, deps);
  return server;
}

export async function startStdioMcpServer(deps: ToolDeps): Promise<McpServer> {
  const server = makeServer(deps);
  await server.connect(new StdioServerTransport());
  console.error("[hyppovisor] MCP server connected on stdio");
  return server;
}

export interface HttpMcpHandle {
  url: string;
  requiresToken: boolean;
  close: () => void;
}

export async function startHttpMcpServer(
  deps: ToolDeps,
  opts: { port?: number; host?: string; token?: string } = {},
): Promise<HttpMcpHandle> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 7357;
  const token = opts.token?.trim() || undefined;

  const http: HttpServer = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "text/plain" }).end("unauthorized");
      return;
    }

    // Fresh server + stateless transport per request; the tools close over the
    // one shared deps (queue, tabs, log), so app state persists across requests.
    const server = makeServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, resolve);
  });

  const url = `http://${host}:${port}/mcp`;
  console.error(
    `[hyppovisor] MCP HTTP server on ${url}` + (token ? " (bearer token required)" : ""),
  );
  return { url, requiresToken: !!token, close: () => http.close() };
}

/** Convenience: a token you can hand out, if the caller didn't supply one. */
export function generateToken(): string {
  return randomUUID().replace(/-/g, "");
}
