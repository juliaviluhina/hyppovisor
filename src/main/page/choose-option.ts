// The `choose_option` interact operation (feature 006).
//
// Given a chooser control and a target option (by visible `label`, by `value`,
// or both), make that control hold that option as its selected value and fire
// the events a real choice produces — then re-read the control to confirm the
// value stuck before reporting success (FR-013). It is preparation, not an
// external act: it never submits, never navigates, never presses Enter. The
// blocklist rules `submit-control`, `consent-toggle`, `external-act-label`, and
// `credential-field` refuse the whole operation; `in-form` does not gate it.

import type { WebContents } from "electron";
import { config } from "../config.js";
import { HyppoError } from "../errors.js";
import { InteractionLog } from "../safety/interaction-log.js";
import { matchBlocklist, targetDescriptorScript, type TargetDescriptor } from "../safety/blocklist.js";
import { capList } from "./form-fields.js";
import {
  SELECTOR_SYNTAX_HELPER,
  assertSelectorValid,
  isInvalidSelectorMarker,
  INVALID_SELECTOR_MESSAGE,
} from "./selector-syntax.js";
import type { ChooseOptionReason, ChosenOption, ListedOption } from "../../shared/types.js";

/** Internal — never crosses the MCP boundary. */
type ChooserKind = "native-select" | "custom-combobox" | "listbox";

/** Internal — one option the probe found. */
interface OptionRecord {
  label: string;
  value: string;
  disabled: boolean;
}

/** Label normalisation for matching: trim, collapse whitespace, lowercase. */
export function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The raw shape the probe returns for chooser classification (research.md R3). */
export interface ChooserShape {
  tagName: string;
  role: string | null;
  /** `<select multiple>` or an `aria-multiselectable` widget. */
  multiple: boolean;
  /** `aria-controls` / `aria-owns` resolves to a node with `role="listbox"`. */
  ownsListbox: boolean;
}

/**
 * research.md R3 — first match wins. Returns `null` for "not a dropdown"; a
 * `<select multiple>` / multiselectable widget also returns `null` and the
 * caller refuses it as `multi-select` (the `multiple` flag is read separately).
 */
export function chooserKindFor(x: ChooserShape): ChooserKind | null {
  if (x.tagName === "select") return x.multiple ? null : "native-select";
  if (x.multiple) return null;
  if (x.role === "listbox") return "listbox";
  if (x.role === "combobox") return "custom-combobox";
  if (x.ownsListbox) return "custom-combobox";
  return null;
}

export type MatchResult =
  | { ok: true; option: OptionRecord }
  | { ok: false; reason: ChooseOptionReason; candidates?: string[] };

/**
 * research.md R5 / the contract's matching table. `label` is compared
 * case-insensitive + whitespace-collapsed; `value` is compared exactly (no
 * trim, no case fold). A matched-but-disabled option is checked last, so a
 * disabled + ambiguous label still reports `ambiguous-option` first.
 */
export function matchOption(
  options: OptionRecord[],
  want: { label?: string; value?: string },
): MatchResult {
  const hasValue = want.value !== undefined;
  const hasLabel = want.label !== undefined;

  let chosen: OptionRecord | undefined;
  if (hasValue) {
    const byValue = options.filter((o) => o.value === want.value);
    if (byValue.length === 0) return { ok: false, reason: "no-option-match" };
    chosen = byValue[0]; // duplicate values are malformed HTML — take document order
    if (hasLabel && norm(chosen.label) !== norm(want.label as string)) {
      return { ok: false, reason: "no-option-match" };
    }
  } else if (hasLabel) {
    const byLabel = options.filter((o) => norm(o.label) === norm(want.label as string));
    if (byLabel.length === 0) return { ok: false, reason: "no-option-match" };
    if (byLabel.length > 1) {
      return { ok: false, reason: "ambiguous-option", candidates: byLabel.map((o) => o.label) };
    }
    chosen = byLabel[0];
  } else {
    // Caller rejects "neither label nor value" before probing; defensive here.
    return { ok: false, reason: "no-option-match" };
  }

  if (chosen.disabled) return { ok: false, reason: "option-disabled" };
  return { ok: true, option: chosen };
}

// ─── In-page probe ───────────────────────────────────────────────────────────

interface ChooserProbe {
  tagName: string;
  role: string | null;
  multiple: boolean;
  ownsListbox: boolean;
  optionsInDom: OptionRecord[];
  optionsPresent: boolean;
  hasFilterInput: boolean;
  /** Displayed value before the operation — a `<select>.value` or the combobox's shown text. */
  preCallValue: string;
}

/** Gather the option-source elements for a custom widget — same list `005`/R5 uses. */
const OPTION_SOURCES_FN = `
  function __optionNodes(el) {
    const out = [];
    const seen = new Set();
    const add = (nodes) => { for (const n of nodes) if (!seen.has(n)) { seen.add(n); out.push(n); } };
    // options inside the element itself
    add(el.querySelectorAll('[role="option"]'));
    // an explicitly referenced listbox (aria-controls / aria-owns)
    let ref = null;
    for (const attr of ["aria-controls", "aria-owns"]) {
      const v = el.getAttribute(attr);
      if (v) for (const id of v.split(/\\s+/)) {
        const host = document.getElementById(id);
        if (host && (host.getAttribute("role") || "").toLowerCase() === "listbox") { ref = host; break; }
      }
      if (ref) break;
    }
    if (ref) add(ref.querySelectorAll('[role="option"]'));
    // a descendant listbox
    const desc = el.querySelector('[role="listbox"]');
    if (desc) add(desc.querySelectorAll('[role="option"]'));
    // the immediately-following sibling, only if it is itself a listbox
    const sib = el.nextElementSibling;
    if (sib && (sib.getAttribute("role") || "").toLowerCase() === "listbox") {
      add(sib.querySelectorAll('[role="option"]'));
    }
    // react-select / MUI / downshift: the menu is a sibling of the CONTROL (an
    // ancestor of a role=combobox <input>), not of the input. Walk up a couple of
    // levels and take a menu-like container's options — bounded, and only a
    // container that holds exactly ONE combobox, so a shared wrapper full of
    // sibling widgets (the test fixture) is never scraped.
    if (out.length === 0) {
      let anc = el.parentElement;
      for (let i = 0; i < 3 && anc && anc.querySelectorAll; i++) {
        if (anc.querySelectorAll('[role="combobox"], input.select__input, [class*="combobox"]').length <= 1) {
          const menu = anc.querySelector(
            '[class*="menu"] [role="option"], [class*="listbox"] [role="option"], [class*="options"] [role="option"]',
          );
          if (menu) { add(anc.querySelectorAll('[role="option"]')); break; }
        }
        anc = anc.parentElement;
      }
    }
    return out;
  }
  function __optionSnap(n) {
    const dv = n.getAttribute("data-value");
    const v = n.getAttribute("value");
    return {
      label: ((n.innerText || n.textContent || "") + "").trim(),
      value: dv != null ? dv : (v != null ? v : (n.id || "")),
      disabled: n.getAttribute("aria-disabled") === "true" || n.disabled === true,
    };
  }
  function __filterInput(el) {
    if (el.tagName.toLowerCase() === "input") return el;
    return el.querySelector('input[role="combobox"], input[role="textbox"], input[aria-autocomplete]');
  }`;

function probeScript(selector: string): string {
  const SEL = JSON.stringify(selector);
  return `(() => {${SELECTOR_SYNTAX_HELPER}${OPTION_SOURCES_FN}
   try {
    const el = __querySafe(document, ${SEL});
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase() || null;

    let ownedListbox = null;
    for (const attr of ["aria-controls", "aria-owns"]) {
      const ref = el.getAttribute(attr);
      if (ref) for (const id of ref.split(/\\s+/)) {
        const n = document.getElementById(id);
        if (n && (n.getAttribute("role") || "").toLowerCase() === "listbox") { ownedListbox = n; break; }
      }
    }
    const ariaMulti = el.getAttribute("aria-multiselectable") === "true" ||
      (ownedListbox && ownedListbox.getAttribute("aria-multiselectable") === "true");
    const multiple = (tag === "select" && el.multiple === true) || !!ariaMulti;
    const ownsListbox = !!ownedListbox && role !== "combobox" && role !== "listbox";

    let optionsInDom = [];
    if (tag === "select") {
      optionsInDom = [].slice.call(el.options).map((o) => ({
        label: (o.label || o.text || "").trim(),
        value: o.value,
        disabled: o.disabled === true,
      }));
    } else {
      optionsInDom = __optionNodes(el).map(__optionSnap);
    }

    const filterInput = tag === "select" ? null : __filterInput(el);
    let preCallValue;
    if (tag === "select") preCallValue = el.value;
    else if (filterInput && typeof filterInput.value === "string" && filterInput.value) preCallValue = filterInput.value;
    else preCallValue = ((el.innerText || el.textContent || "") + "").trim();

    return {
      tagName: tag,
      role,
      multiple,
      ownsListbox,
      optionsInDom,
      optionsPresent: tag === "select" ? true : optionsInDom.length > 0,
      hasFilterInput: !!filterInput,
      preCallValue,
    };
   } catch (e) {
     if (e && e.__invalidSelector) return { __invalidSelector: true };
     throw e;
   }
  })()`;
}

// ─── In-page mechanics ───────────────────────────────────────────────────────

/** native <select>: set the value, fire input + change, then hand back the read-back. */
function applyNativeScript(selector: string, value: string, label: string): string {
  const SEL = JSON.stringify(selector);
  const V = JSON.stringify(value);
  const L = JSON.stringify(label);
  return `(() => {
    const el = document.querySelector(${SEL});
    if (!el) return { gone: true };
    const proto = window.HTMLSelectElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    if (d && d.set) d.set.call(el, ${V}); else el.value = ${V};
    if (el.value !== ${V}) {
      const opt = [].slice.call(el.options).find((o) => o.value === ${V});
      if (opt) opt.selected = true;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const selOpt = el.options[el.selectedIndex];
    const selText = selOpt ? (selOpt.label || selOpt.text || "").trim() : "";
    const norm = (s) => (s || "").trim().replace(/\\s+/g, " ").toLowerCase();
    return { ok: el.value === ${V} && norm(selText) === norm(${L}) };
  })()`;
}

function revertNativeScript(selector: string, value: string): string {
  const SEL = JSON.stringify(selector);
  const V = JSON.stringify(value);
  return `(() => {
    const el = document.querySelector(${SEL});
    if (!el) return;
    const proto = window.HTMLSelectElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    if (d && d.set) d.set.call(el, ${V}); else el.value = ${V};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  })()`;
}

/**
 * Open the chooser's menu. Escalating and **idempotent** — each step is skipped
 * once the widget reports open, so a plain toggle-on-click widget is never
 * double-toggled:
 *   1. `el.click()` — simple widgets, `<button>` triggers, the fixtures.
 *   2. `mousedown` (+ pointer) on the widget's control container — react-select /
 *      downshift / MUI open on `mousedown` on the control, not a `click` on the
 *      inner `<input>`.
 *   3. focus the inner input + `ArrowDown` — the keyboard-combobox path.
 */
function openScript(selector: string): string {
  const SEL = JSON.stringify(selector);
  return `(() => {
    const el = document.querySelector(${SEL});
    if (!el) return { gone: true };
    // Idempotency signal: this widget's own expanded state. Deliberately NOT a
    // page-wide '[role="option"]' probe — another widget may already be open.
    const isOpen = () => {
      if (el.getAttribute("aria-expanded") === "true") return true;
      const inner = el.querySelector && el.querySelector('[role="combobox"][aria-expanded="true"], [aria-expanded="true"]');
      return !!inner;
    };
    if (isOpen()) return { ok: true, via: "already" };

    if (typeof el.click === "function") el.click();
    if (isOpen()) return { ok: true, via: "click" };
    if (!document.querySelector(${SEL})) return { gone: true };

    const control =
      (el.closest && el.closest('[class*="control"], [class*="select"], [class*="combobox"], [class*="dropdown"], [class*="Autocomplete"]')) ||
      el.parentElement ||
      el;
    const fireMouse = (t) => {
      try { t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })); } catch (_) {}
      t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
      try { t.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true })); } catch (_) {}
      t.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
    };
    fireMouse(control);
    if (isOpen()) return { ok: true, via: "mousedown" };
    if (!document.querySelector(${SEL})) return { gone: true };

    const input =
      el.tagName && el.tagName.toLowerCase() === "input"
        ? el
        : (el.querySelector && el.querySelector("input"));
    if (input && typeof input.focus === "function") {
      input.focus();
      for (const type of ["keydown", "keyup"]) {
        input.dispatchEvent(new KeyboardEvent(type, {
          key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true,
        }));
      }
    }
    return { ok: true, via: isOpen() ? "arrowdown" : "attempted" };
  })()`;
}

/** wait up to `timeoutMs` for `[role="option"]` in the source; return the snapshot. */
function gatherScript(selector: string, timeoutMs: number): string {
  const SEL = JSON.stringify(selector);
  return `(() => new Promise((resolve) => {${OPTION_SOURCES_FN}
    const el = document.querySelector(${SEL});
    if (!el) return resolve({ gone: true });
    const snap = () => __optionNodes(el).map(__optionSnap);
    if (__optionNodes(el).length > 0) return resolve({ options: snap() });
    const obs = new MutationObserver(() => {
      if (__optionNodes(el).length > 0) { obs.disconnect(); resolve({ options: snap() }); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve({ options: snap() }); }, ${Number(timeoutMs)});
  }))()`;
}

/** type `text` into the widget's filter input, driving input + change (no blur). */
function typeFilterScript(selector: string, text: string): string {
  const SEL = JSON.stringify(selector);
  const T = JSON.stringify(text);
  return `(() => {${OPTION_SOURCES_FN}
    const el = document.querySelector(${SEL});
    if (!el) return { gone: true };
    const input = __filterInput(el);
    if (!input) return { ok: false };
    const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    input.focus();
    if (d && d.set) d.set.call(input, ${T}); else input.value = ${T};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  })()`;
}

/**
 * Activate the single matching option element. Fires the full hover → press →
 * release → click sequence a real pointer produces: react-select / downshift /
 * MUI variously select on `mouseover`-tracked focus, on `mousedown` (to beat the
 * input blur), or on `click`, so all three are covered. No key events — Enter is
 * never pressed (Principle I).
 */
function activateScript(selector: string, wantValue: string, wantLabel: string): string {
  const SEL = JSON.stringify(selector);
  const WV = JSON.stringify(wantValue);
  const WL = JSON.stringify(wantLabel);
  return `(() => {${OPTION_SOURCES_FN}
    const el = document.querySelector(${SEL});
    if (!el) return { gone: true };
    const norm = (s) => ((s || "") + "").trim().replace(/\\s+/g, " ").toLowerCase();
    const useValue = ${WV} !== "";
    let target = null;
    for (const n of __optionNodes(el)) {
      const s = __optionSnap(n);
      if (useValue ? s.value === ${WV} : norm(s.label) === norm(${WL})) { target = n; break; }
    }
    if (!target) return { notFound: true };
    // Re-resolve by id in case the menu re-rendered between gather and here.
    if (target.id) { const fresh = document.getElementById(target.id); if (fresh) target = fresh; }
    const mopts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
    const fire = (type, Ctor) => {
      try { target.dispatchEvent(new Ctor(type, mopts)); }
      catch (_) { target.dispatchEvent(new MouseEvent(type, mopts)); }
    };
    fire("pointerover", window.PointerEvent || MouseEvent);
    fire("pointerenter", window.PointerEvent || MouseEvent);
    fire("mouseover", MouseEvent);
    fire("mousemove", MouseEvent);
    fire("pointerdown", window.PointerEvent || MouseEvent);
    fire("mousedown", MouseEvent);
    fire("pointerup", window.PointerEvent || MouseEvent);
    fire("mouseup", MouseEvent);
    fire("click", MouseEvent);
    return { activated: true };
  })()`;
}

/**
 * Close the widget if still open, optionally revert the filter input to its
 * pre-call text, and return the displayed value for the read-back check.
 */
function closeReadbackScript(selector: string, revertFilterTo: string | null): string {
  const SEL = JSON.stringify(selector);
  const RV = revertFilterTo === null ? "null" : JSON.stringify(revertFilterTo);
  return `(() => {${OPTION_SOURCES_FN}
    const el = document.querySelector(${SEL});
    if (!el) return { gone: true };
    const input = __filterInput(el);
    if (el.getAttribute("aria-expanded") === "true") {
      const tgt = input || el;
      tgt.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      tgt.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true }));
      if (el.getAttribute("aria-expanded") === "true" && typeof el.click === "function") el.click();
    }
    if (${RV} !== null && input) {
      const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (d && d.set) d.set.call(input, ${RV}); else input.value = ${RV};
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    let shown = "";
    if (input && input.value) shown = input.value;
    if (!shown) {
      const selOpt = el.querySelector('[aria-selected="true"]');
      if (selOpt) shown = ((selOpt.innerText || selOpt.textContent || "") + "").trim();
    }
    if (!shown) {
      const adId = el.getAttribute("aria-activedescendant");
      const ad = adId ? document.getElementById(adId) : null;
      if (ad) shown = ((ad.innerText || ad.textContent || "") + "").trim();
    }
    if (!shown) {
      // react-select / MUI: the committed value renders in a sibling of the
      // input, inside the control container — not on the combobox element itself.
      // Start the climb ABOVE el so its own class (e.g. "…__input") is not the
      // container we search.
      const start = el.parentElement || el;
      const box =
        (start.closest &&
          start.closest('[class*="control"], [class*="combobox"], [class*="container"], [class*="select"]')) ||
        start;
      const sv = box && box.querySelector
        ? box.querySelector('[class*="single-value"], [class*="singleValue"], [class*="SingleValue"], [class*="multiValue"], [class*="multi-value"]')
        : null;
      if (sv) shown = ((sv.innerText || sv.textContent || "") + "").trim();
    }
    if (!shown) shown = ((el.innerText || el.textContent || "") + "").trim();
    return { shown, expanded: el.getAttribute("aria-expanded") };
  })()`;
}

// ─── Shared probe + gather ───────────────────────────────────────────────────

/** Run the in-page probe; throws INVALID_SELECTOR on a non-CSS selector. */
async function probeChooser(
  wc: WebContents,
  selector: string,
): Promise<ChooserProbe | null> {
  const probe = (await wc.executeJavaScript(probeScript(selector), true)) as
    | ChooserProbe
    | { __invalidSelector: true }
    | null;
  assertSelectorValid(probe);
  return (probe as ChooserProbe | null) ?? null;
}

/**
 * Custom-widget open (only if the options are not already in the DOM) → one
 * MutationObserver-bounded gather. Shared by `listOptions` and `chooseOption`.
 */
async function openAndGather(
  wc: WebContents,
  selector: string,
  probe: ChooserProbe,
): Promise<{ gone?: boolean; options?: OptionRecord[] }> {
  if (!probe.optionsPresent) {
    const opened = (await wc.executeJavaScript(openScript(selector), true)) as { gone?: boolean };
    if (opened.gone) return { gone: true };
  }
  return (await wc.executeJavaScript(
    gatherScript(selector, config.chooseOptionWaitMs),
    true,
  )) as { gone?: boolean; options?: OptionRecord[] };
}

/**
 * Read-only enumeration of a chooser's options (feature 008, US1). Reuses the
 * `choose_option` probe → open → gather → close machinery but selects nothing,
 * types nothing, and writes no audit entry (the caller in `interact.ts` also
 * writes none). A scripted menu that never populates within `chooseOptionWaitMs`
 * yields `{ options: [], optionsPresent: false }` — not an error (FR-007).
 *
 * Throws `HyppoError`:
 * - `INVALID_SELECTOR` — selector is not valid CSS
 * - `TARGET_NOT_FOUND` — selector matches nothing / control removed mid-probe
 * - `CHOOSE_OPTION_FAILED` (`reason: "not-a-dropdown"`) — not a `<select>` /
 *   `role=combobox|listbox` / listbox-owner, or a `<select multiple>`
 */
export async function listOptions(
  wc: WebContents,
  selector: string,
): Promise<{ options: ListedOption[]; optionsPresent: boolean; optionsTruncated: boolean }> {
  const probe = await probeChooser(wc, selector);
  if (!probe) {
    throw new HyppoError(
      "TARGET_NOT_FOUND",
      `No element matches selector ${JSON.stringify(selector)}.`,
    );
  }

  const notADropdown = (): never => {
    throw new HyppoError(
      "CHOOSE_OPTION_FAILED",
      `${REASON_MESSAGE["not-a-dropdown"]} (reason: not-a-dropdown)`,
      { reason: "not-a-dropdown" },
    );
  };

  // A `<select multiple>` / multiselectable widget is not a dropdown for this op.
  if (probe.multiple) return notADropdown();
  const kind = chooserKindFor(probe);
  if (kind === null) return notADropdown();

  if (kind === "native-select") {
    const capped = capList(probe.optionsInDom, config.formFieldOptionCap);
    return { options: capped.items, optionsPresent: true, optionsTruncated: capped.truncated };
  }

  // custom-combobox / listbox — open, gather, then close + revert so the control
  // is left exactly as it was found.
  const gathered = await openAndGather(wc, selector, probe);
  if (gathered.gone) {
    throw new HyppoError(
      "TARGET_NOT_FOUND",
      `Control ${JSON.stringify(selector)} was removed mid-operation.`,
    );
  }
  await wc.executeJavaScript(closeReadbackScript(selector, probe.preCallValue || ""), true);

  const options = gathered.options ?? [];
  const capped = capList(options, config.formFieldOptionCap);
  return {
    options: capped.items,
    optionsPresent: options.length > 0,
    optionsTruncated: capped.truncated,
  };
}

// ─── Orchestration ───────────────────────────────────────────────────────────

const REASON_MESSAGE: Record<ChooseOptionReason, string> = {
  "not-a-dropdown":
    "Target is not a dropdown (a <select>, a role=combobox/listbox, or an element owning a role=listbox).",
  "no-option-match": "No option matches the requested label/value.",
  "ambiguous-option": "More than one option matches the label; pass `value` to disambiguate.",
  "option-disabled": "The matching option is disabled.",
  "option-not-appeared":
    "The matching option did not render in time, or the selection did not take (read-back mismatch).",
  "multi-select": "Multi-select controls are not supported by choose_option.",
};

/**
 * The `choose_option` operation. Writes exactly one interaction-log entry on
 * every exit path (like `interact`'s own branches) and throws `HyppoError` on
 * every refusal / failure; returns `{ chosenOption }` on success.
 */
export async function chooseOption(
  wc: WebContents,
  log: InteractionLog,
  tabId: string,
  selector: string | undefined,
  label: string | undefined,
  value: string | undefined,
): Promise<{ chosenOption: ChosenOption }> {
  const url = wc.getURL();

  if (!selector) {
    log.record({
      tabId,
      url,
      operation: "choose_option",
      target: null,
      outcome: "error",
      ruleId: null,
      error: `Operation "choose_option" requires a selector.`,
    });
    throw new HyppoError("TARGET_NOT_FOUND", `Operation "choose_option" requires a selector.`);
  }

  const record = (
    outcome: "permitted" | "refused" | "error",
    extra: { ruleId?: string | null; reason?: string | null; error?: string | null } = {},
  ) =>
    log.record({
      tabId,
      url,
      operation: "choose_option",
      target: selector,
      outcome,
      ruleId: extra.ruleId ?? null,
      error: extra.error ?? null,
      ...(extra.reason ? { reason: extra.reason } : {}),
    });

  const refuseReason = (reason: ChooseOptionReason, candidates?: string[]): never => {
    record("refused", { reason });
    throw new HyppoError(
      "CHOOSE_OPTION_FAILED",
      `${REASON_MESSAGE[reason]} (reason: ${reason})` +
        (candidates ? ` candidates: ${candidates.join(" | ")}` : ""),
      { reason, ...(candidates ? { candidates } : {}) },
    );
  };

  if (label === undefined && value === undefined) {
    record("refused", { reason: "no-option-match" });
    throw new HyppoError(
      "CHOOSE_OPTION_FAILED",
      "choose_option requires `label` or `value`. (reason: no-option-match)",
      { reason: "no-option-match" },
    );
  }

  // 1. blocklist gate — same rule set every operation uses.
  const descriptor = (await wc.executeJavaScript(
    targetDescriptorScript(selector),
    true,
  )) as TargetDescriptor | { __invalidSelector: true } | null;
  if (isInvalidSelectorMarker(descriptor)) {
    record("error", { error: INVALID_SELECTOR_MESSAGE });
    throw new HyppoError("INVALID_SELECTOR", INVALID_SELECTOR_MESSAGE);
  }
  if (!descriptor) {
    record("error", { error: `No element matches selector ${JSON.stringify(selector)}.` });
    throw new HyppoError(
      "TARGET_NOT_FOUND",
      `No element matches selector ${JSON.stringify(selector)}.`,
    );
  }
  const verdict = matchBlocklist(descriptor as TargetDescriptor, "choose_option");
  if (verdict.blocked) {
    record("refused", { ruleId: verdict.ruleId ?? null });
    throw new HyppoError(
      "REFUSED_EXTERNAL_ACT",
      `Refused choose_option on ${selector}: ${verdict.description} ` +
        `The app never performs an external act (constitution Principle I).`,
      { ruleId: verdict.ruleId, ruleDescription: verdict.description },
    );
  }

  // 2. probe + classify.
  const probe = (await wc.executeJavaScript(probeScript(selector), true)) as ChooserProbe | null;
  if (!probe) {
    record("error", { error: "control removed before probe" });
    throw new HyppoError("TARGET_NOT_FOUND", `No element matches selector ${JSON.stringify(selector)}.`);
  }
  if (probe.multiple) return refuseReason("multi-select");
  const kind = chooserKindFor(probe);
  if (kind === null) return refuseReason("not-a-dropdown");

  const want = { label, value };

  if (kind === "native-select") {
    const m = matchOption(probe.optionsInDom, want);
    if (!m.ok) return refuseReason(m.reason, m.candidates);
    const chosen = m.option;
    const res = (await wc.executeJavaScript(
      applyNativeScript(selector, chosen.value, chosen.label),
      true,
    )) as { gone?: boolean; ok?: boolean };
    if (res.gone) {
      record("error", { error: "control removed mid-operation" });
      throw new HyppoError("TARGET_NOT_FOUND", `Control ${JSON.stringify(selector)} was removed mid-operation.`);
    }
    if (!res.ok) {
      await wc.executeJavaScript(revertNativeScript(selector, probe.preCallValue), true);
      return refuseReason("option-not-appeared");
    }
    record("permitted");
    return { chosenOption: { label: chosen.label, value: chosen.value } };
  }

  // custom-combobox / listbox — shared open + gather (also used by listOptions).
  const closeAndThrow = async (reason: ChooseOptionReason, candidates?: string[]): Promise<never> => {
    await wc.executeJavaScript(closeReadbackScript(selector, probe.preCallValue || ""), true);
    return refuseReason(reason, candidates);
  };

  let gathered = await openAndGather(wc, selector, probe);
  if (gathered.gone) {
    record("error", { error: "control removed mid-operation" });
    throw new HyppoError("TARGET_NOT_FOUND", `Control ${JSON.stringify(selector)} was removed mid-operation.`);
  }

  let options = gathered.options ?? [];
  let m: MatchResult = options.length
    ? matchOption(options, want)
    : { ok: false, reason: "option-not-appeared" };

  // Narrow with the widget's filter input ONLY when the target is not already
  // among the rendered options. A widget that lays out its whole list on open
  // (react-select) must not be over-filtered by an exact label its own filter
  // grammar may reject.
  if (
    !m.ok &&
    probe.hasFilterInput &&
    label !== undefined &&
    (m.reason === "no-option-match" || m.reason === "option-not-appeared")
  ) {
    await wc.executeJavaScript(typeFilterScript(selector, label), true);
    gathered = (await wc.executeJavaScript(
      gatherScript(selector, config.chooseOptionWaitMs),
      true,
    )) as typeof gathered;
    if (gathered.gone) {
      record("error", { error: "control removed mid-operation" });
      throw new HyppoError("TARGET_NOT_FOUND", `Control ${JSON.stringify(selector)} was removed mid-operation.`);
    }
    options = gathered.options ?? [];
    m = options.length ? matchOption(options, want) : { ok: false, reason: "option-not-appeared" };
  }

  if (options.length === 0) return await closeAndThrow("option-not-appeared");
  if (!m.ok) return await closeAndThrow(m.reason, m.candidates);
  const chosen = m.option;

  const act = (await wc.executeJavaScript(
    activateScript(selector, chosen.value, chosen.label),
    true,
  )) as { gone?: boolean; notFound?: boolean; activated?: boolean };
  if (act.gone) {
    record("error", { error: "control removed mid-operation" });
    throw new HyppoError("TARGET_NOT_FOUND", `Control ${JSON.stringify(selector)} was removed mid-operation.`);
  }
  if (!act.activated) return await closeAndThrow("option-not-appeared");

  const back = (await wc.executeJavaScript(
    closeReadbackScript(selector, null),
    true,
  )) as { gone?: boolean; shown?: string; expanded?: string | null };
  if (back.gone) {
    record("error", { error: "control removed mid-operation" });
    throw new HyppoError("TARGET_NOT_FOUND", `Control ${JSON.stringify(selector)} was removed mid-operation.`);
  }
  const shown = norm(back.shown ?? "");
  const wantLabel = norm(chosen.label);
  // Bidirectional: a rich widget's committed display often trims or decorates the
  // option text (e.g. "United States +1" → "United States"), so accept either
  // containing the other. `value` equality stays an exact check.
  const matched =
    (shown.length >= 2 && (shown.includes(wantLabel) || wantLabel.includes(shown))) ||
    (chosen.value !== "" && (back.shown ?? "") === chosen.value);
  // best-effort: nothing committed on a mismatch; the widget is already closed
  if (!matched) return refuseReason("option-not-appeared");

  record("permitted");
  return { chosenOption: { label: chosen.label, value: chosen.value } };
}
