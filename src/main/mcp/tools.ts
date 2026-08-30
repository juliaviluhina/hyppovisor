// The complete MCP tool surface (contracts/mcp-tools.md). Six tools, no others.
// Every call goes through the app-wide queue (FR-013); errors return a named
// code (FR-014); no tool submits, sends, applies, or interprets content.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionQueue } from "../queue/action-queue.js";
import type { TabManager } from "../tabs/tab-manager.js";
import type { InteractionLog } from "../safety/interaction-log.js";
import { HyppoError, isHyppoError } from "../errors.js";
import { readPage } from "../page/read.js";
import { interact, fillBatch, checkFillInputShape, waitForSelector } from "../page/interact.js";

export interface ToolDeps {
  queue: ActionQueue;
  tabs: TabManager;
  log: InteractionLog;
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(e: unknown) {
  const body = isHyppoError(e)
    ? e.toResult()
    : { error: { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) } };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
    isError: true,
  };
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { queue, tabs, log } = deps;

  server.tool(
    "open_url",
    "Open an http(s) URL in a new embedded tab using the person's existing session. " +
      "Does not log in, submit, or follow links on its own.",
    { url: z.string().describe("Absolute http or https URL") },
    async ({ url }) => {
      try {
        const { value, queueDepth } = await queue.run(() => tabs.open(url, "orchestrator"));
        return ok({ ...value, queueDepth });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "list_open_tabs",
    "List every open tab with its id, current URL, title, and load state.",
    {},
    async () => {
      try {
        const { value, queueDepth } = await queue.run(async () => tabs.list());
        return ok({ tabs: value, queueDepth });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "read_page",
    "Return one tab's current content: verbatim visible text, and the DOM only when asked. " +
      "Nothing is stored — this payload is the only copy.",
    {
      tabId: z.string(),
      includeDom: z.boolean().optional().default(false).describe("Include document HTML"),
    },
    async ({ tabId, includeDom }) => {
      try {
        const { value } = await queue.run((depth) => {
          const wc = tabs.webContentsFor(tabId);
          return readPage(wc, tabId, includeDom, depth);
        });
        return ok(value);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "navigate",
    "Point an existing tab at a new http(s) URL.",
    { tabId: z.string(), url: z.string() },
    async ({ tabId, url }) => {
      try {
        const { value, queueDepth } = await queue.run(() => tabs.navigate(tabId, url));
        return ok({ ...value, queueDepth });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "interact",
    "Bounded interaction: click, fill, scroll, or space. `fill` sets a value on a plain " +
      "field (text/email/tel/url/search/number, textarea, contenteditable) — including one " +
      "inside a <form> and a combobox's filter input — but never a credential, consent, or " +
      "file field. `fill` also takes a batch form: instead of `selector` + `value`, pass " +
      "`fields` — an ordered list of { selector, value } pairs (max 50) applied in one call. " +
      "Every target is checked first; if any is forbidden or unresolved the whole batch is " +
      "refused (BATCH_REJECTED) with nothing written and every offender named. After that " +
      "check passes, writing is best-effort: a field whose element vanished mid-write is " +
      "reported `error` and the rest still fill. `space` activates the focused element " +
      "(checkbox, listbox option, plain button) under the same rules a click faces. Cannot " +
      "submit, send, apply, or press Enter — submit/consent/credential targets are refused " +
      "with a named rule.",
    {
      tabId: z.string(),
      operation: z.enum(["click", "fill", "scroll", "space"]),
      selector: z.string().optional(),
      value: z.string().optional(),
      fields: z
        .array(z.object({ selector: z.string(), value: z.string() }))
        .optional()
        .describe("Batch fill: ordered { selector, value } pairs (fill only, max 50)"),
    },
    async ({ tabId, operation, selector, value, fields }) => {
      try {
        if (operation === "fill") {
          const shapeError = checkFillInputShape(selector, value, fields);
          if (shapeError) throw shapeError;
        }

        if (operation === "fill" && fields) {
          const { value: result } = await queue.run((depth) => {
            const wc = tabs.webContentsFor(tabId);
            return fillBatch(wc, log, tabId, fields, depth);
          });
          return ok(result);
        }

        const { queueDepth } = await queue.run(async () => {
          const wc = tabs.webContentsFor(tabId);
          await interact(wc, log, tabId, operation, selector, value);
        });
        return ok({ tabId, operation, outcome: "permitted", queueDepth });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "wait_for_selector",
    "Wait until a selector appears in a tab, up to a timeout. On timeout the tab is left unchanged.",
    { tabId: z.string(), selector: z.string(), timeoutMs: z.number().int().positive().optional() },
    async ({ tabId, selector, timeoutMs }) => {
      try {
        const { queueDepth } = await queue.run(async () => {
          const wc = tabs.webContentsFor(tabId);
          await waitForSelector(wc, log, tabId, selector, timeoutMs);
        });
        return ok({ tabId, selector, found: true, queueDepth });
      } catch (e) {
        return fail(e);
      }
    },
  );
}

// Re-exported so the constitution's "one enforcing module per guarantee" holds:
// callers never construct HyppoError codes ad hoc.
export { HyppoError };
