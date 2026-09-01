// Pure text builders for the connection panel (feature 007,
// contracts/connection-snippets.md). No DOM, no Electron — imported both by
// panel.ts (renderer) and tests/unit/connection-snippets.test.ts (vitest).

/** The subset of the effective connection the snippet builders need. */
export interface SnippetState {
  port: number;
  tokenRequired: boolean;
  token: string | null;
  /** MCP server name (feature 012): `"hyppovisor"` or `"hyppovisor-<label>"`. Default `"hyppovisor"`. */
  serverName?: string;
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
  const name = s.serverName ?? "hyppovisor";
  const base = `claude mcp add --transport http --scope user ${name} ${endpointUrl(s.port)}`;
  return s.tokenRequired && s.token
    ? `${base} --header "Authorization: Bearer ${s.token}"`
    : base;
}

/** The `mcpServers` JSON block for an HTTP endpoint — valid JSON as displayed. */
export function mcpJsonConfig(s: SnippetState): string {
  const name = s.serverName ?? "hyppovisor";
  const entry: Record<string, unknown> = {
    type: "http",
    url: endpointUrl(s.port),
  };
  if (s.tokenRequired && s.token) {
    entry.headers = { Authorization: `Bearer ${s.token}` };
  }
  return JSON.stringify({ mcpServers: { [name]: entry } }, null, 2);
}

/** The `mcpServers` JSON block for a stdio launch (shown only in stdio mode). */
export function stdioJsonConfig(launch: StdioLaunchLike, serverName = "hyppovisor"): string {
  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: { command: launch.command, args: launch.args, env: launch.env },
      },
    },
    null,
    2,
  );
}

/**
 * Plain-language "how it works" content for the connection panel, shown right
 * under the About section. DOM-free so it stays testable; panel.ts turns the
 * arrays into a diagram + two lists.
 */
export const HOW_IT_WORKS_INTRO =
  "You drive an AI agent app (Claude Code and the like) and want it to do small " +
  "jobs on web pages you are signed in to — read what is there, fill fields in. " +
  "HyppoVisor is the pair of hands it borrows.";

export const HOW_IT_WORKS_STEPS: readonly string[] = [
  "Start HyppoVisor.",
  "Open the page's URL in a tab.",
  "Sign in yourself if the site asks — HyppoVisor never does.",
  "Copy this panel's MCP config into your AI agent app.",
  "Ask the agent to read or fill the page; it calls HyppoVisor's tools.",
];

export const HYPPO_CAN: readonly string[] = [
  "open a URL in a new tab, or point a tab at another address",
  "list the open tabs and their state",
  "read a page's visible text (and its DOM only when asked)",
  "list a page's form fields, read-only",
  "do one bounded action at a time: click, fill, scroll, space, choose_option, list_options",
  "wait for an element to appear",
  "take a screenshot to check what rendered",
];

export const HYPPO_FORBIDDEN: readonly string[] = [
  "submit a form, or press Enter",
  "send a message, or apply for anything",
  "connect anywhere else, or call other services",
  "sign in or authenticate on your behalf",
  "upload, attach, or download a file",
];

export const HOW_IT_WORKS_CLOSING =
  "A human performs every step that acts on the outside world. Every action the " +
  "assistant takes is logged locally on this machine.";

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
