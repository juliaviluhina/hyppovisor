// Bounded interaction: click / fill / scroll / space / choose_option /
// wait_for_selector (FR-012, FR-018; feature 003 adds `space` and permits in-form
// `fill`; feature 006 adds `choose_option`).
//
// Every attempt — permitted, refused, or errored — produces exactly one
// interaction-log entry (FR-024a, FR-012b, feature 003 FR-013). No operation can
// submit, send, or apply, and no operation presses Enter; refusals reference a
// named blocklist rule (FR-012a) or the `unsafe-fill-type` allowlist check.
// Entering a value into a plain, non-credential, non-consent field — and choosing
// an option in a plain `<select>` / combobox (feature 006) — is permitted
// preparation (constitution Principle I, amended), not an external act.

import type { WebContents } from "electron";
import { config } from "../config.js";
import { HyppoError } from "../errors.js";
import { InteractionLog } from "../safety/interaction-log.js";
import {
  matchBlocklist,
  isSafeFillTarget,
  targetDescriptorScript,
  activeElementDescriptorScript,
  type TargetDescriptor,
} from "../safety/blocklist.js";
import { chooseOption, listOptions } from "./choose-option.js";
import type {
  InteractOperation,
  InteractionLogEntry,
  BatchFillField,
  BatchFieldResult,
  BatchFillResult,
  ChosenOption,
  ListedOption,
} from "../../shared/types.js";

async function descriptorFor(wc: WebContents, selector: string): Promise<TargetDescriptor> {
  const d = (await wc.executeJavaScript(
    targetDescriptorScript(selector),
    true,
  )) as TargetDescriptor | null;
  if (!d) {
    throw new HyppoError(
      "TARGET_NOT_FOUND",
      `No element matches selector ${JSON.stringify(selector)}.`,
    );
  }
  return d;
}

/** Short, page-text-free label for the resolved `space` target in the audit log. */
function descriptorSummary(d: TargetDescriptor): string {
  return (
    d.tagName +
    (d.type ? `[type=${d.type}]` : "") +
    (d.role ? `[role=${d.role}]` : "") +
    (d.hasFormAncestor ? " (in form)" : "")
  );
}

// Shared in-page helper: set an <input>/<textarea> value through the *native*
// property setter, not `el.value = …`. React (and every framework that shims the
// value setter to track state) ignores a direct assignment — the field looks set
// in the DOM but the component's state, validation, and re-render never fire, so
// the value silently vanishes on the next render. Going through the prototype's
// own setter and then dispatching `input` is what a real keystroke does.
const NATIVE_VALUE_SETTER = `
  const __setValue = (node, next) => {
    const proto = node.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(node, next);
    else node.value = next;
  };`;

/** In-page: clear the target then set `value`, driving the events one field edit makes. */
function fillScript(selector: string, value: string): string {
  return `(() => {${NATIVE_VALUE_SETTER}
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error("target element is gone");
    const v = ${JSON.stringify(value)};
    el.focus();
    if (el.isContentEditable) {
      el.textContent = "";
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      el.textContent = v;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else {
      __setValue(el, "");
      __setValue(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    // A human leaves a normal field before moving on; blur is what triggers the
    // touched/validation pass on most form libraries, so the value reads as
    // accepted rather than "please complete this field". Skip it for a combobox
    // filter input, where blur would close the option menu the caller is about
    // to act on.
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role !== "combobox" && role !== "textbox") {
      if (typeof el.blur === "function") el.blur();
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }
  })()`;
}

// In-page: activate document.activeElement as Space would. A text field gets a
// single space character (through the native setter, same reason as fillScript);
// any other control is activated exactly as a click (synthetic key events do not
// toggle native controls, so .click() is the activation). Space has no implicit
// form-submit behaviour, unlike Enter.
const SPACE_ACTIVATION_SCRIPT = `(() => {${NATIVE_VALUE_SETTER}
  const el = document.activeElement;
  if (!el) return;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "text").toLowerCase();
  const nonTextInput = ["checkbox","radio","button","submit","reset","file","image","range"];
  const isTextField =
    tag === "textarea" || el.isContentEditable === true ||
    (tag === "input" && nonTextInput.indexOf(type) === -1);
  if (isTextField) {
    if (el.isContentEditable === true) {
      if (document.execCommand) document.execCommand("insertText", false, " ");
      else el.textContent = (el.textContent || "") + " ";
    } else {
      let s, e;
      try { s = el.selectionStart; e = el.selectionEnd; } catch (_) { s = null; e = null; }
      if (s == null) { s = el.value.length; e = el.value.length; }
      __setValue(el, el.value.slice(0, s) + " " + el.value.slice(e));
      try { el.setSelectionRange(s + 1, s + 1); } catch (_) {}
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }));
  if (typeof el.click === "function") el.click();
})()`;

/** One rejected target from the shared fill pre-check (feature 004). */
export interface FillOffender {
  selector: string;
  /** Blocklist rule id or `"unsafe-fill-type"`; absent when the selector did not resolve. */
  ruleId?: string;
  ruleDescription?: string;
  /** Non-rule cause — `"no element matches"`, or the unsafe-fill-type detail. */
  reason?: string;
}

export type ResolveFillResult =
  | { ok: true; descriptor: TargetDescriptor }
  | { ok: false; offender: FillOffender };

/**
 * Resolve a selector and apply the rule set a `fill` faces: descriptor lookup →
 * blocklist (`fill`) → safe-fill-type allowlist. Returns an offender instead of
 * throwing so a batch can collect every one. Shared by the single-`fill` path in
 * `interact()` and by `fillBatch` (feature 004, FR-004).
 *
 * `gateActivation` (batch only): also refuse a target that a *click* blocklist
 * rule would stop — `submit-control`, `consent-toggle` — so a submit button or a
 * consent checkbox in a batch is attributed to its precise rule rather than the
 * generic `unsafe-fill-type`. `in-form` is deliberately excluded: it never gates
 * a fill, single or batch (FR-004). `external-act-label` / `credential-field`
 * already apply to `fill`, so this changes attribution only, never the outcome.
 */
export async function resolveFillTarget(
  wc: WebContents,
  selector: string,
  { gateActivation = false }: { gateActivation?: boolean } = {},
): Promise<ResolveFillResult> {
  const d = (await wc.executeJavaScript(
    targetDescriptorScript(selector),
    true,
  )) as TargetDescriptor | null;
  if (!d) {
    return { ok: false, offender: { selector, reason: "no element matches" } };
  }
  // Batch only: check the click blocklist first so a submit control / consent
  // toggle is attributed to its precise rule (both would otherwise fall through
  // to `external-act-label` or `unsafe-fill-type`). `in-form` is ignored — it
  // never gates a fill (FR-004).
  if (gateActivation) {
    const clickVerdict = matchBlocklist(d, "click");
    if (clickVerdict.blocked && clickVerdict.ruleId !== "in-form") {
      return {
        ok: false,
        offender: {
          selector,
          ruleId: clickVerdict.ruleId,
          ruleDescription: clickVerdict.description,
        },
      };
    }
  }
  const verdict = matchBlocklist(d, "fill");
  if (verdict.blocked) {
    return {
      ok: false,
      offender: { selector, ruleId: verdict.ruleId, ruleDescription: verdict.description },
    };
  }
  const safe = isSafeFillTarget(d);
  if (!safe.ok) {
    return {
      ok: false,
      offender: {
        selector,
        ruleId: "unsafe-fill-type",
        ruleDescription: `Not a safe value field: ${safe.reason}.`,
        reason: safe.reason,
      },
    };
  }
  return { ok: true, descriptor: d };
}

/** Payload for a permitted `list_options` (feature 008, US1). */
export interface ListOptionsPayload {
  options: ListedOption[];
  optionsPresent: boolean;
  optionsTruncated: boolean;
}

/**
 * Resolve a target descriptor, swallowing the `SyntaxError` a non-CSS selector
 * rejects with (that case is surfaced downstream as `INVALID_SELECTOR`). Returns
 * `null` for "no match" and for "bad syntax" alike.
 */
async function descriptorOrNull(
  wc: WebContents,
  selector: string,
): Promise<TargetDescriptor | null> {
  try {
    return (await wc.executeJavaScript(
      targetDescriptorScript(selector),
      true,
    )) as TargetDescriptor | null;
  } catch {
    return null;
  }
}

export async function interact(
  wc: WebContents,
  log: InteractionLog,
  tabId: string,
  operation: InteractOperation,
  selector: string | undefined,
  value: string | undefined,
  label?: string,
): Promise<{ chosenOption?: ChosenOption } | ListOptionsPayload | void> {
  const url = wc.getURL();
  const target = selector ?? null;
  let logged = false;

  // choose_option manages its own single audit entry on every path (like the
  // branches below) and is dispatched before this try/catch so a thrown refusal
  // is not double-logged as an "error" by the outer catch.
  if (operation === "choose_option") {
    return chooseOption(wc, log, tabId, selector, label, value);
  }

  // list_options is a *read*: it selects nothing and writes NO interaction-log
  // entry on any path (success, refusal, error) — same posture as read_page /
  // read_form_fields (feature 008 US1, R1). Dispatched before the try/catch so
  // the outer catch never records an "error" entry for it.
  if (operation === "list_options") {
    if (!selector) {
      throw new HyppoError("TARGET_NOT_FOUND", `Operation "list_options" requires a selector.`);
    }
    // Blocklist gate — the SAME rule set choose_option uses (submit-control,
    // consent-toggle, credential-field, external-act-label refuse; in-form does
    // not). A non-CSS selector or a no-match returns null here and is surfaced
    // as INVALID_SELECTOR / TARGET_NOT_FOUND by listOptions() below.
    const d = await descriptorOrNull(wc, selector);
    if (d) {
      const verdict = matchBlocklist(d, "choose_option");
      if (verdict.blocked) {
        throw new HyppoError(
          "REFUSED_EXTERNAL_ACT",
          `Refused list_options on ${selector}: ${verdict.description} ` +
            `The app never performs an external act (constitution Principle I).`,
          { ruleId: verdict.ruleId, ruleDescription: verdict.description },
        );
      }
    }
    return listOptions(wc, selector);
  }

  try {
    if (operation === "scroll") {
      await wc.executeJavaScript(`window.scrollBy(0, ${Number(value) || 600})`, true);
      log.record({
        tabId,
        url,
        operation,
        target,
        outcome: "permitted",
        ruleId: null,
        error: null,
      });
      return;
    }

    if (operation === "space") {
      const descriptor = (await wc.executeJavaScript(
        activeElementDescriptorScript(),
        true,
      )) as TargetDescriptor | null;

      if (!descriptor) {
        log.record({
          tabId,
          url,
          operation,
          target: null,
          outcome: "refused",
          ruleId: null,
          error: null,
        });
        logged = true;
        throw new HyppoError(
          "TARGET_NOT_FOUND",
          "Refused space: no element is focused, so there is no target to activate.",
        );
      }

      const summary = descriptorSummary(descriptor);
      const verdict = matchBlocklist(descriptor, "space");
      if (verdict.blocked) {
        log.record({
          tabId,
          url,
          operation,
          target: summary,
          outcome: "refused",
          ruleId: verdict.ruleId ?? null,
          error: null,
        });
        logged = true;
        throw new HyppoError(
          "REFUSED_EXTERNAL_ACT",
          `Refused space on ${summary}: ${verdict.description} ` +
            `The app never performs an external act (constitution Principle I).`,
          { ruleId: verdict.ruleId, ruleDescription: verdict.description },
        );
      }

      await wc.executeJavaScript(SPACE_ACTIVATION_SCRIPT, true);
      log.record({
        tabId,
        url,
        operation,
        target: summary,
        outcome: "permitted",
        ruleId: null,
        error: null,
      });
      return;
    }

    if (!selector) {
      throw new HyppoError("TARGET_NOT_FOUND", `Operation "${operation}" requires a selector.`);
    }

    if (operation === "click") {
      const descriptor = await descriptorFor(wc, selector);
      const verdict = matchBlocklist(descriptor, operation);
      if (verdict.blocked) {
        log.record({
          tabId,
          url,
          operation,
          target,
          outcome: "refused",
          ruleId: verdict.ruleId ?? null,
          error: null,
        });
        logged = true;
        throw new HyppoError(
          "REFUSED_EXTERNAL_ACT",
          `Refused ${operation} on ${selector}: ${verdict.description} ` +
            `The app never performs an external act (constitution Principle I).`,
          { ruleId: verdict.ruleId, ruleDescription: verdict.description },
        );
      }
      await wc.executeJavaScript(
        `document.querySelector(${JSON.stringify(selector)}).click()`,
        true,
      );
    } else {
      // fill — resolve + rule-check through the shared helper (the same one
      // fillBatch uses), then map an offender back to the exact refusal / error
      // the single-fill path has always produced. The blocklist clears
      // credential / consent / external-act wording; the allowlist is the
      // type gate (feature 003 FR-003).
      const resolved = await resolveFillTarget(wc, selector);
      if (!resolved.ok) {
        const off = resolved.offender;
        if (!off.ruleId) {
          // selector did not resolve — same as descriptorFor() throwing; the
          // outer catch records this as an `error` entry, not a refusal.
          throw new HyppoError(
            "TARGET_NOT_FOUND",
            `No element matches selector ${JSON.stringify(selector)}.`,
          );
        }
        log.record({
          tabId,
          url,
          operation,
          target,
          outcome: "refused",
          ruleId: off.ruleId,
          error: null,
        });
        logged = true;
        const message =
          off.ruleId === "unsafe-fill-type"
            ? `Refused fill on ${selector}: target is ${off.reason}. ` +
              `The app only types into plain value fields (constitution Principle I).`
            : `Refused fill on ${selector}: ${off.ruleDescription} ` +
              `The app never performs an external act (constitution Principle I).`;
        throw new HyppoError("REFUSED_EXTERNAL_ACT", message, {
          ruleId: off.ruleId,
          ruleDescription: off.ruleDescription,
        });
      }
      await wc.executeJavaScript(fillScript(selector, value ?? ""), true);
    }

    log.record({ tabId, url, operation, target, outcome: "permitted", ruleId: null, error: null });
  } catch (e) {
    if (logged) throw e; // refusal / no-target paths already wrote their log entry
    const message = e instanceof Error ? e.message : String(e);
    log.record({ tabId, url, operation, target, outcome: "error", ruleId: null, error: message });
    throw e instanceof HyppoError
      ? e
      : new HyppoError("TARGET_NOT_FOUND", `Interaction failed on ${selector}: ${message}`);
  }
}

/**
 * Malformed-call guard for the `fill` operation (feature 004, FR-001). A call
 * must carry exactly one of a single `(selector, value)` or a `fields` batch.
 * Returns the error to throw, or null when the shape is valid. Shared by the
 * MCP tool dispatch so the check is unit-testable.
 */
export function checkFillInputShape(
  selector: string | undefined,
  value: string | undefined,
  fields: BatchFillField[] | undefined,
): HyppoError | null {
  const hasSingle = selector !== undefined || value !== undefined;
  const hasBatch = fields !== undefined;
  if (hasSingle === hasBatch) {
    return new HyppoError(
      "BATCH_REJECTED",
      "fill requires either (selector, value) or fields, not both.",
    );
  }
  return null;
}

/**
 * Batch `fill` (feature 004): an ordered list of `(selector, value)` pairs
 * applied in one queued operation. All-or-nothing pre-write check (resolve +
 * rule-check every target with the same logic a single `fill` uses; any
 * forbidden or unresolved target refuses the whole batch, nothing written),
 * then a best-effort write pass (a field that fails mid-write is `error` and the
 * batch continues). One audit entry per field plus one `fill_batch` summary.
 */
export async function fillBatch(
  wc: WebContents,
  log: InteractionLog,
  tabId: string,
  fields: BatchFillField[],
  queueDepth = 0,
): Promise<BatchFillResult> {
  const url = wc.getURL();
  const requested = fields.length;

  const summaryEntry = (
    outcome: InteractionLogEntry["outcome"],
    counts: { written: number; errored: number; refused: number },
  ) =>
    log.record({
      tabId,
      url,
      operation: "fill_batch",
      target: null,
      outcome,
      ruleId: null,
      error: null,
      batch: { requested, ...counts },
    });

  // cap / empty guards (FR-003) — no `targets` breakdown.
  if (requested === 0) {
    summaryEntry("refused", { written: 0, errored: 0, refused: 0 });
    throw new HyppoError("BATCH_REJECTED", "Batch fill requires at least one field.");
  }
  if (requested > config.batchFillCap) {
    summaryEntry("refused", { written: 0, errored: 0, refused: 0 });
    throw new HyppoError(
      "BATCH_REJECTED",
      `Batch fill accepts at most ${config.batchFillCap} fields; ${requested} supplied. ` +
        `Nothing was written.`,
    );
  }

  // Pre-write pass (FR-004 / FR-005): resolve + rule-check every target, collect
  // every offender. Any offender → refuse the whole batch, write nothing.
  const offenders: FillOffender[] = [];
  for (const { selector } of fields) {
    const resolved = await resolveFillTarget(wc, selector, { gateActivation: true });
    if (!resolved.ok) offenders.push(resolved.offender);
  }
  if (offenders.length > 0) {
    for (const off of offenders) {
      log.record({
        tabId,
        url,
        operation: "fill",
        target: off.selector,
        outcome: "refused",
        ruleId: off.ruleId ?? null,
        error: off.ruleId ? null : (off.reason ?? null),
      });
    }
    summaryEntry("refused", { written: 0, errored: 0, refused: offenders.length });
    throw new HyppoError(
      "BATCH_REJECTED",
      `${offenders.length} target(s) refused; no fields were written.`,
      {
        targets: offenders.map((o) => ({
          selector: o.selector,
          ...(o.ruleId ? { ruleId: o.ruleId } : {}),
          ...(o.ruleDescription ? { ruleDescription: o.ruleDescription } : {}),
          ...(o.reason ? { reason: o.reason } : {}),
        })),
      },
    );
  }

  // Write pass (FR-007 / FR-008): best-effort, in order. A field whose element
  // vanished after the check is `error`; the batch continues.
  const results: BatchFieldResult[] = [];
  let written = 0;
  let errored = 0;
  for (const { selector, value } of fields) {
    try {
      await wc.executeJavaScript(fillScript(selector, value), true);
      results.push({ selector, outcome: "permitted" });
      written++;
      log.record({
        tabId,
        url,
        operation: "fill",
        target: selector,
        outcome: "permitted",
        ruleId: null,
        error: null,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      results.push({ selector, outcome: "error", message });
      errored++;
      log.record({
        tabId,
        url,
        operation: "fill",
        target: selector,
        outcome: "error",
        ruleId: null,
        error: message,
      });
    }
  }

  const outcome: "permitted" | "partial" = errored === 0 ? "permitted" : "partial";
  summaryEntry(outcome, { written, errored, refused: 0 });

  return {
    tabId,
    operation: "fill",
    outcome,
    fields: results,
    summary: { requested, written, errored },
    queueDepth,
  };
}

export async function waitForSelector(
  wc: WebContents,
  log: InteractionLog,
  tabId: string,
  selector: string,
  timeoutMs = config.defaultWaitMs,
): Promise<void> {
  const url = wc.getURL();
  const script = `new Promise((resolve) => {
    if (document.querySelector(${JSON.stringify(selector)})) return resolve(true);
    const obs = new MutationObserver(() => {
      if (document.querySelector(${JSON.stringify(selector)})) { obs.disconnect(); resolve(true); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(false); }, ${timeoutMs});
  })`;

  const found = (await wc.executeJavaScript(script, true)) as boolean;
  if (!found) {
    log.record({
      tabId,
      url,
      operation: "wait_for_selector",
      target: selector,
      outcome: "error",
      ruleId: null,
      error: "timeout",
    });
    throw new HyppoError(
      "WAIT_TIMEOUT",
      `Selector ${JSON.stringify(selector)} did not appear within ${timeoutMs}ms. Tab left unchanged.`,
    );
  }
  log.record({
    tabId,
    url,
    operation: "wait_for_selector",
    target: selector,
    outcome: "permitted",
    ruleId: null,
    error: null,
  });
}
