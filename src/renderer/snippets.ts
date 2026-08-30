// Pure text builders for the connection panel (feature 007,
// contracts/connection-snippets.md). No DOM, no Electron — imported both by
// panel.ts (renderer) and tests/unit/connection-snippets.test.ts (vitest).

/** The subset of the effective connection the snippet builders need. */
export interface SnippetState {
  port: number;
  tokenRequired: boolean;
  token: string | null;
}

/** Launch descriptor for the stdio JSON block (mirrors shared `StdioLaunch`). */
export interface StdioLaunchLike {
  command: string;
  args: string[];
  env: { HYPPO_MCP_STDIO: "1" };
}

export function endpointUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

/** `claude mcp add …` — runnable unedited for the current settings (SC-006). */
export function mcpAddCommand(s: SnippetState): string {
  const base = `claude mcp add --transport http --scope user hyppovisor ${endpointUrl(s.port)}`;
  return s.tokenRequired && s.token
    ? `${base} --header "Authorization: Bearer ${s.token}"`
    : base;
}

/** The `mcpServers` JSON block for an HTTP endpoint — valid JSON as displayed. */
export function mcpJsonConfig(s: SnippetState): string {
  const entry: Record<string, unknown> = {
    type: "http",
    url: endpointUrl(s.port),
  };
  if (s.tokenRequired && s.token) {
    entry.headers = { Authorization: `Bearer ${s.token}` };
  }
  return JSON.stringify({ mcpServers: { hyppovisor: entry } }, null, 2);
}

/** The `mcpServers` JSON block for a stdio launch (shown only in stdio mode). */
export function stdioJsonConfig(launch: StdioLaunchLike): string {
  return JSON.stringify(
    {
      mcpServers: {
        hyppovisor: { command: launch.command, args: launch.args, env: launch.env },
      },
    },
    null,
    2,
  );
}

/**
 * Static, copyable plain-language description of HyppoVisor and its MCP tools.
 * Test-enforced (connection-snippets.test.ts §8): names the app, lists every
 * tool in TOOL_NAMES, states the never-does guarantees, and carries no secret
 * and no orchestrator/board wording.
 */
export const ABOUT_TEXT = `HyppoVisor runs on your local machine. It opens web pages in tabs that
use your own signed-in sessions and exposes them to an AI assistant through
a Model Context Protocol (MCP) server at the endpoint shown in this panel.

The assistant can use these tools:

  open_url            open an http(s) address in a new tab
  list_open_tabs      list the open tabs and their state
  read_page           return one tab's visible text (and its DOM only when asked)
  read_form_fields    list a page's form controls, read-only
  navigate            point an existing tab at another address
  interact            one bounded action: click, fill, scroll, space, choose_option, or list_options
  wait_for_selector   wait until an element appears, up to a timeout
  screenshot          a picture of a tab, to check its rendered state

What HyppoVisor never does: it will not submit a form, send a message,
apply for anything, connect anywhere, or authenticate on your behalf, and it
never presses Enter. A human performs every step that acts on the outside
world. Every interaction the assistant makes is logged locally on this machine.
`;
