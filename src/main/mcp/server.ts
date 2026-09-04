// MCP server. Two transports:
//
//  - HTTP (default for `npm start`): HyppoVisor runs as a long-lived app and
//    listens on loopback; Claude Code connects to the URL. Bound to 127.0.0.1
//    only and protected by a generated bearer token by default. The HTTP handle
//    supports a runtime port rebind and a mutable
//    token so the connection panel (feature 007) can change both without an app
//    restart.
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
import { defaultMcpPort, mcpHost } from "../config.js";
import { registerTools, type ToolDeps } from "./tools.js";
import type { LastRequestInfo } from "../../shared/types.js";

function makeServer(deps: ToolDeps, serverName = "hyppovisor"): McpServer {
  // `serverName` surfaces in the MCP `initialize` response as `serverInfo.name`
  // (feature 012): "hyppovisor" for the default instance, "hyppovisor-<label>"
  // for a named one, so a connected agent can confirm which instance it reached.
  const server = new McpServer({ name: serverName, version: "0.1.0" });
  registerTools(server, deps);
  return server;
}

export async function startStdioMcpServer(
  deps: ToolDeps,
  opts: { serverName?: string } = {},
): Promise<McpServer> {
  const server = makeServer(deps, opts.serverName);
  await server.connect(new StdioServerTransport());
  console.error("[hyppovisor] MCP server connected on stdio");
  return server;
}

export interface HttpMcpHandle {
  /** Current endpoint URL — tracks the live port. */
  readonly url: string;
  /** Current listening port. */
  readonly port: number;
  /** `true` while a bearer token is enforced. */
  readonly requiresToken: boolean;
  /** Move the listener to a new port. Resolves once serving there and the old
   *  server is closed; rejects (leaving the old server untouched) on bind error. */
  rebind(port: number): Promise<void>;
  /** Set / clear the required bearer token, live — no rebind, read per request. */
  setToken(token: string | null): void;
  /** The most recent inbound request (metadata only), or `null`. */
  lastRequest(): LastRequestInfo | null;
  close(): void;
}

export async function startHttpMcpServer(
  deps: ToolDeps,
  opts: {
    port?: number;
    host?: string;
    token?: string | null;
    /** MCP `serverInfo.name` for this instance (feature 012); default `"hyppovisor"`. */
    serverName?: string;
    /** Called after `lastRequest()` changes (a served tool call or a 401), so
     *  the connection panel can be nudged to refresh (feature 007). */
    onActivity?: () => void;
  } = {},
): Promise<HttpMcpHandle> {
  const host = opts.host ?? mcpHost;
  let currentPort = opts.port ?? defaultMcpPort;
  // `undefined` means a caller omitted configuration: secure by default. An
  // explicit null remains the documented opt-out for existing profiles/tests.
  let authToken: string | null = opts.token === undefined ? generateToken() : opts.token?.trim() || null;
  let last: LastRequestInfo | null = null;

  // Record every served tool call for the connection panel's last-request line,
  // then forward to whatever the caller registered (feature 007).
  const wrappedDeps: ToolDeps = {
    ...deps,
    onToolInvoked: (name: string) => {
      last = { at: Date.now(), tool: name, outcome: "ok" };
      deps.onToolInvoked?.(name);
      opts.onActivity?.();
    },
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
      last = { at: Date.now(), tool: null, outcome: "rejected" };
      opts.onActivity?.();
      res.writeHead(401, { "content-type": "text/plain" }).end("unauthorized");
      return;
    }

    // Fresh server + stateless transport per request; the tools close over the
    // one shared deps (queue, tabs, log), so app state persists across requests.
    const server = makeServer(wrappedDeps, opts.serverName);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    let torndown = false;
    const teardown = () => {
      if (torndown) return;
      torndown = true;
      // Defer + swallow: a sync throw or a rejection from an "already closed"
      // race here would otherwise take the whole main process down.
      Promise.resolve()
        .then(() => transport.close())
        .catch(() => {});
      Promise.resolve()
        .then(() => server.close())
        .catch(() => {});
    };
    res.on("close", teardown);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  function listenOn(port: number): Promise<HttpServer> {
    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => void handle(req, res));
      // A permanent no-op error listener so a late socket error on this server
      // can never become an uncaughtException that kills the process.
      srv.on("error", () => {});
      const onError = (err: unknown) => {
        srv.removeListener("listening", onListening);
        try {
          srv.close();
        } catch {
          /* never bound */
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const onListening = () => {
        srv.removeListener("error", onError);
        resolve(srv);
      };
      srv.once("error", onError);
      srv.once("listening", onListening);
      srv.listen(port, host);
    });
  }

  let server = await listenOn(currentPort);

  const urlFor = (port: number) => `http://${host}:${port}/mcp`;
  console.error(
    `[hyppovisor] MCP HTTP server on ${urlFor(currentPort)}` +
      (authToken ? " (bearer token required)" : ""),
  );

  return {
    get url() {
      return urlFor(currentPort);
    },
    get port() {
      return currentPort;
    },
    get requiresToken() {
      return authToken !== null;
    },
    async rebind(port: number): Promise<void> {
      // Bind the new socket first; only tear the old one down once it is serving,
      // so a failed rebind is side-effect-free (FR-013 / SC-010).
      const next = await listenOn(port);
      const old = server;
      server = next;
      currentPort = port;
      old.close();
      console.error(`[hyppovisor] MCP HTTP server rebound to ${urlFor(port)}`);
    },
    setToken(token: string | null): void {
      authToken = token?.trim() || null;
    },
    lastRequest(): LastRequestInfo | null {
      return last;
    },
    close(): void {
      server.close();
    },
  };
}

/** Convenience: a token you can hand out, if the caller didn't supply one. */
export function generateToken(): string {
  return randomUUID().replace(/-/g, "");
}
