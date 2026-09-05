// The complete MCP tool surface (contracts/mcp-tools.md). Eight tools, no others
// (feature 008 added `screenshot`). Every call goes through the app-wide queue
// (FR-013); errors return a named code (FR-014); no tool submits, sends, applies,
// or interprets content.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionQueue } from "../queue/action-queue.js";
import type { TabManager } from "../tabs/tab-manager.js";
import type { InteractionLog } from "../safety/interaction-log.js";
import { HyppoError, isHyppoError } from "../errors.js";
import { readPage } from "../page/read.js";
import {
  interact,
  fillBatch,
  checkFillInputShape,
  waitForSelector,
  type ListOptionsPayload,
} from "../page/interact.js";
import { readFormFields } from "../page/form-fields.js";
import { takeScreenshot } from "../page/screenshot.js";

export interface ToolDeps {
  queue: ActionQueue;
  tabs: TabManager;
  log: InteractionLog;
  /** Feature 007: notified with the tool name at the start of every invocation,
   *  so the connection panel can show a last-request line. Metadata only. */
  onToolInvoked?: (name: string) => void;
  /** Reports unexpected (non-HyppoError) failures from real tab operations to
   *  the lifecycle owner — a routine, already-classified HyppoError (e.g.
   *  TAB_NOT_FOUND, WAIT_TIMEOUT) is not an invariant violation. */
  onTabActionFailure?: (error: unknown) => void;
  /** Reports a completed tab operation so the lifecycle owner can clear a
   *  previously recorded tab-action invariant failure. */
  onTabActionSuccess?: () => void;
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
  "screenshot",
] as const;

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

/** An MCP image content block followed by a text block carrying the metadata (feature 008). */
function okImage(dataBase64: string, mimeType: string, meta: unknown) {
  return {
    content: [
      { type: "image" as const, data: dataBase64, mimeType },
      { type: "text" as const, text: JSON.stringify(meta, null, 2) },
    ],
  };
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
  const runTabAction = <T>(task: (queueDepth: number) => Promise<T>) =>
    queue.run(async (queueDepth) => {
      try {
        const result = await task(queueDepth);
        deps.onTabActionSuccess?.();
        return result;
      } catch (error) {
        // A HyppoError is an expected, already-classified outcome (returned to
        // the caller via fail(e)) — not an invariant violation of the app itself.
        if (!isHyppoError(error)) deps.onTabActionFailure?.(error);
        throw error;
      }
    });

  server.tool(
    "open_url",
    "Open an http(s) URL in a new embedded tab using the person's existing session. " +
      "Does not log in or submit. Resolves a known redirect-interstitial / link-shim URL " +
      "(LinkedIn /safety/go/, Google /url, Facebook /l.php, Reddit out.reddit.com, Outlook " +
      "Safe Links) to the http(s) destination carried in its query parameter and opens that " +
      "directly; every other URL opens verbatim.",
    { url: z.string().describe("Absolute http or https URL") },
    async ({ url }) => {
      seen("open_url");
      try {
        const { value, queueDepth } = await runTabAction(() => tabs.open(url, "orchestrator"));
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
        const { value, queueDepth } = await runTabAction(async () => tabs.list());
        return ok({ tabs: value, queueDepth });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "read_page",
    "Return one tab's current content: verbatim visible text, and the DOM only when asked. " +
      "Nothing is stored — this payload is the only copy. Optionally scope the read to one " +
      "element's subtree with `selector`, e.g. to skip a persistent chat log or nav panel.",
    {
      tabId: z.string(),
      includeDom: z.boolean().optional().default(false).describe("Include document HTML"),
      selector: z
        .string()
        .optional()
        .describe("CSS selector to scope the read to one element's subtree"),
      reduceDom: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "When includeDom is true, strip <script>/<style>/comment nodes and class/style " +
            "attributes from the returned DOM. Set false for the verbatim, unreduced DOM.",
        ),
    },
    async ({ tabId, includeDom, selector, reduceDom }) => {
      seen("read_page");
      try {
        const { value } = await runTabAction((depth) => {
          const wc = tabs.webContentsFor(tabId);
          return readPage(wc, tabId, includeDom, depth, selector, reduceDom);
        });
        return ok(value);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "navigate",
    "Point an existing tab at a new http(s) URL. Resolves known link-shim / " +
      "redirect-interstitial URLs to their stated destination before navigating.",
    { tabId: z.string(), url: z.string() },
    async ({ tabId, url }) => {
      seen("navigate");
      try {
        const { value, queueDepth } = await runTabAction(() => tabs.navigate(tabId, url));
        return ok({ ...value, queueDepth });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "interact",
    "Bounded interaction: click, fill, scroll, space, choose_option, or list_options. `fill` " +
      "sets a value on a plain field (text/email/tel/url/search/number, textarea, " +
      "contenteditable) — including one inside a <form> and a combobox's filter input — but " +
      "never a credential, consent, or file field (attaching a file is a human step). `fill` " +
      "types the literal text and stops: choosing among address / place autocomplete " +
      "suggestions a site pops up is a human step. `fill` types the value character by " +
      "character with real key events so an input mask / formatter receives it, then reads " +
      "it back: a permitted single `fill` returns `currentValue` (the field's value " +
      "post-formatting), and a well-formed value the page still would not accept is " +
      "WRITE_NOT_APPLIED (not a refusal) carrying `currentValue` — the field was not filled. " +
      "`fill` also takes a batch form: instead of `selector` + " +
      "`value`, pass `fields` — an ordered list of { selector, value } pairs (max 50) applied " +
      "in one call. Every target is checked first; if any is forbidden or unresolved the " +
      "whole batch is refused (BATCH_REJECTED) with nothing written and every offender named. " +
      "After that check passes, writing is best-effort: a field whose element vanished " +
      "mid-write, or whose value the page did not accept, is reported `error` and the rest " +
      "still fill. `space` activates the focused " +
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
      "does not gate choose_option. `list_options` is read-only: it returns every choice a " +
      "dropdown currently offers as { label, value, disabled } — opening and closing a " +
      "scripted menu if needed — without selecting anything, without changing the control's " +
      "value, and WITHOUT an interaction-log entry (`value` / `label` / `fields` are ignored). " +
      "A scripted menu that never populates yields options: [] with optionsPresent: false " +
      "(not an error); a non-dropdown or <select multiple> is refused CHOOSE_OPTION_FAILED " +
      "(reason: not-a-dropdown); it is blocklist-gated exactly as choose_option. Cannot " +
      "submit, send, apply, or press Enter — submit/consent/credential targets are refused " +
      "with a named rule.",
    {
      tabId: z.string(),
      operation: z.enum(["click", "fill", "scroll", "space", "choose_option", "list_options"]),
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
          const { value: result } = await runTabAction((depth) => {
            const wc = tabs.webContentsFor(tabId);
            return fillBatch(wc, log, tabId, fields, depth);
          });
          return ok(result);
        }

        if (operation === "list_options") {
          const { value: result, queueDepth } = await runTabAction(() => {
            const wc = tabs.webContentsFor(tabId);
            return interact(wc, log, tabId, operation, selector, value, label);
          });
          const r = result as ListOptionsPayload;
          return ok({
            tabId,
            selector,
            options: r.options,
            optionsPresent: r.optionsPresent,
            optionsTruncated: r.optionsTruncated,
            queueDepth,
          });
        }

        const { value: result, queueDepth } = await runTabAction(() => {
          const wc = tabs.webContentsFor(tabId);
          return interact(wc, log, tabId, operation, selector, value, label);
        });
        const chosenOption =
          result && typeof result === "object" && "chosenOption" in result
            ? result.chosenOption
            : undefined;
        // feature 011: a permitted single `fill` returns the value read back
        // after the write, so a caller can confirm it landed without a re-read.
        const currentValue =
          result && typeof result === "object" && "currentValue" in result
            ? (result as { currentValue: string }).currentValue
            : undefined;
        return ok({
          tabId,
          operation,
          outcome: "permitted",
          ...(chosenOption ? { chosenOption } : {}),
          ...(currentValue !== undefined ? { currentValue } : {}),
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
      "Bounded (control cap, per-record option cap, and a 64 KB byte budget) with a single " +
      "`truncated` flag covering all three. Each record also carries `operation` " +
      "(fill/choose/activate/none) and `chooseVerdict` (what choose_option would return; " +
      "in-form does not gate it); a scripted dropdown backed by a hidden same-named input " +
      "collapses to ONE record whose `selector` choose_option / list_options accept; " +
      "text-like records carry `maxLength` / `pattern` / `inputMode` when declared. Optional " +
      "`fields` returns records only for the named selectors (document order; an explicit " +
      "selector is returned even for a non-interactive element; mutually exclusive with " +
      "`containerSelector`). `includeNonInteractive: true` also returns plain buttons and " +
      "hidden value-mirror inputs. `only: \"required-unfilled\"` returns only empty required " +
      "controls. A non-CSS selector anywhere returns INVALID_SELECTOR. Performs no " +
      "interaction, writes nothing, adds no audit-log entry. `read_page` is unchanged.",
    {
      tabId: z.string(),
      containerSelector: z
        .string()
        .optional()
        .describe("Scope to controls inside this element; omitted → whole page"),
      fields: z
        .array(z.string())
        .optional()
        .describe("Return records only for these selectors (document order); excludes containerSelector"),
      includeNonInteractive: z
        .boolean()
        .optional()
        .describe("Also include plain buttons and hidden value-mirror inputs"),
      only: z
        .enum(["required-unfilled"])
        .optional()
        .describe("Return only records that are required and currently empty"),
    },
    async ({ tabId, containerSelector, fields, includeNonInteractive, only }) => {
      seen("read_form_fields");
      try {
        const { value } = await runTabAction((depth) => {
          const wc = tabs.webContentsFor(tabId);
          return readFormFields(wc, tabId, containerSelector, depth, {
            fields,
            includeNonInteractive,
            only,
          });
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
        const { queueDepth } = await runTabAction(async () => {
          const wc = tabs.webContentsFor(tabId);
          await waitForSelector(wc, log, tabId, selector, timeoutMs);
        });
        return ok({ tabId, selector, found: true, queueDepth });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "screenshot",
    "Return a picture of a tab, to check its rendered state. Default is the viewport; pass " +
      "`selector` to clip to one element's on-screen box (wins over `fullPage`), or " +
      "`fullPage: true` for the whole scroll height. JPEG by default (`format: \"png\"` for " +
      "lossless); the image is scaled/compressed to fit `maxBytes` (256 KB default; a caller " +
      "may only lower it). Returns an image content block plus a text block with " +
      "{ width, height, scale, format, fullPage, limitNotMet } — `scale` < 1 means the shot " +
      "was downscaled, `limitNotMet: true` means it is still over budget at the compression " +
      "floor. Retrieval only: nothing is written to disk, no interaction-audit entry is made, " +
      "credential inputs stay masked as rendered. The screenshot is a supplementary visual " +
      "aid — `read_page` remains the verbatim-text channel. NOTE: an instance launched with " +
      "`--background` has no rendered surface, so this tool returns SCREENSHOT_FAILED there; " +
      "`read_page` / `read_form_fields` / `interact` are unaffected. Summon the window " +
      "(re-launch the same `--instance <name>`) or run without `--background` to capture.",
    {
      tabId: z.string(),
      selector: z.string().optional().describe("Clip to this element's on-screen box"),
      fullPage: z.boolean().optional().describe("Capture the full scroll height, not just the viewport"),
      format: z.enum(["jpeg", "png"]).optional(),
      maxBytes: z.number().int().positive().optional().describe("Scale/compress to fit this size (≤ 256 KB)"),
    },
    async ({ tabId, selector, fullPage, format, maxBytes }) => {
      seen("screenshot");
      try {
        const { value } = await runTabAction(() => {
          const wc = tabs.webContentsFor(tabId);
          return takeScreenshot(wc, { tabId, selector, fullPage, format, maxBytes });
        });
        return okImage(value.bytes.toString("base64"), value.mimeType, value.meta);
      } catch (e) {
        return fail(e);
      }
    },
  );
}

// Re-exported so the constitution's "one enforcing module per guarantee" holds:
// callers never construct HyppoError codes ad hoc.
export { HyppoError };
