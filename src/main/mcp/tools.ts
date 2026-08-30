// The complete MCP tool surface (contracts/mcp-tools.md). Seven tools, no others.
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
import { readFormFields } from "../page/form-fields.js";

export interface ToolDeps {
  queue: ActionQueue;
  tabs: TabManager;
  log: InteractionLog;
  /** Feature 007: notified with the tool name at the start of every invocation,
   *  so the connection panel can show a last-request line. Metadata only. */
  onToolInvoked?: (name: string) => void;
}

/**
 * The canonical MCP tool names, in registration order. Single source for the
 * connection panel's About text consistency guard (feature 007,
 * tests/unit/connection-snippets.test.ts) — keep in sync with the
 * `server.tool(...)` calls below.
 */
export const TOOL_NAMES = [
  "open_url",
  "list_open_tabs",
  "read_page",
  "navigate",
  "interact",
  "read_form_fields",
  "wait_for_selector",
] as const;

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
  const seen = (name: string) => deps.onToolInvoked?.(name);

  server.tool(
    "open_url",
    "Open an http(s) URL in a new embedded tab using the person's existing session. " +
      "Does not log in, submit, or follow links on its own.",
    { url: z.string().describe("Absolute http or https URL") },
    async ({ url }) => {
      seen("open_url");
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
      seen("list_open_tabs");
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
      seen("read_page");
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
      seen("navigate");
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
    "Bounded interaction: click, fill, scroll, space, or choose_option. `fill` sets a value " +
      "on a plain field (text/email/tel/url/search/number, textarea, contenteditable) — " +
      "including one inside a <form> and a combobox's filter input — but never a credential, " +
      "consent, or file field. `fill` also takes a batch form: instead of `selector` + " +
      "`value`, pass `fields` — an ordered list of { selector, value } pairs (max 50) applied " +
      "in one call. Every target is checked first; if any is forbidden or unresolved the " +
      "whole batch is refused (BATCH_REJECTED) with nothing written and every offender named. " +
      "After that check passes, writing is best-effort: a field whose element vanished " +
      "mid-write is reported `error` and the rest still fill. `space` activates the focused " +
      "element (checkbox, listbox option, plain button) under the same rules a click faces. " +
      "`choose_option` selects an option in a dropdown: valid targets are a single-select " +
      "<select>, an element with role=combobox/listbox, or an element owning a role=listbox " +
      "via aria-controls/aria-owns. Identify the option by `label` (case-insensitive, " +
      "whitespace-collapsed) and/or `value` (exact); when both are given `value` selects and " +
      "`label` must also match. Exact match only — no fuzzy/prefix, no option creation. For a " +
      "custom combobox the app opens the menu, may type `label` into its filter input, " +
      "activates the one matching option, closes the widget, and re-reads the control to " +
      "confirm the value stuck. A non-chooser / no-match / ambiguous label / disabled option " +
      "/ option-that-never-rendered / multi-select control is refused CHOOSE_OPTION_FAILED " +
      "with a `reason`; a permitted call returns `chosenOption: { label, value }`. `in-form` " +
      "does not gate choose_option. Cannot submit, send, apply, or press Enter — " +
      "submit/consent/credential targets are refused with a named rule.",
    {
      tabId: z.string(),
      operation: z.enum(["click", "fill", "scroll", "space", "choose_option"]),
      selector: z.string().optional(),
      value: z.string().optional(),
      label: z
        .string()
        .optional()
        .describe("choose_option: the target option's visible label (case-insensitive)"),
      fields: z
        .array(z.object({ selector: z.string(), value: z.string() }))
        .optional()
        .describe("Batch fill: ordered { selector, value } pairs (fill only, max 50)"),
    },
    async ({ tabId, operation, selector, value, label, fields }) => {
      seen("interact");
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

        const { value: result, queueDepth } = await queue.run(() => {
          const wc = tabs.webContentsFor(tabId);
          return interact(wc, log, tabId, operation, selector, value, label);
        });
        const chosenOption =
          result && typeof result === "object" && "chosenOption" in result
            ? result.chosenOption
            : undefined;
        return ok({
          tabId,
          operation,
          outcome: "permitted",
          ...(chosenOption ? { chosenOption } : {}),
          queueDepth,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "read_form_fields",
    "Read-only. Return this tab's form controls in document order, one record each: " +
      "a `selector` usable by `interact`, a `kind` (text/textarea/select/combobox/checkbox/" +
      "radio/file/button/richtext/other), the raw input `type`, a verbatim accessible " +
      "`label`, `required`, `group` (radios), `inFormAncestor`, `visible`, `currentValue` " +
      "(omitted for credential fields), `options` for a <select> or an in-DOM combobox menu, " +
      "and the `fillVerdict` / `clickVerdict` `interact` would return for that target. " +
      "Bounded (control + option caps) with a `truncated` flag. Performs no interaction, " +
      "writes nothing, adds no audit-log entry. `read_page` is unchanged — this is a " +
      "derived view for building a batch `fill`.",
    {
      tabId: z.string(),
      containerSelector: z
        .string()
        .optional()
        .describe("Scope to controls inside this element; omitted → whole page"),
    },
    async ({ tabId, containerSelector }) => {
      seen("read_form_fields");
      try {
        const { value } = await queue.run((depth) => {
          const wc = tabs.webContentsFor(tabId);
          return readFormFields(wc, tabId, containerSelector, depth);
        });
        return ok(value);
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
      seen("wait_for_selector");
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
