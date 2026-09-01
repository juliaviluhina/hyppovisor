// Structured form-field reader (feature 005, FR-001…FR-016).
//
// One read-only isolated-world collector walks the DOM in document order →
// raw per-control records: a TargetDescriptor (built with the SAME shared body
// interact uses), a verbatim accessible label, the current value, any
// <select>/in-DOM-combobox options, and the pieces needed to synthesise + verify
// a unique selector. The main process then attaches the fill / click verdicts
// through the shared pure functions interact uses, so the verdicts agree by
// construction (SC-004), and omits a credential field's value entirely (FR-005).
//
// It performs no interaction, writes nothing to the shared data directory
// (FR-013), and adds no interaction-audit-log entry (FR-014). read_page is
// untouched (FR-015).

import type { WebContents } from "electron";
import { config } from "../config.js";
import { HyppoError } from "../errors.js";
import {
  fillVerdictFor,
  clickVerdictFor,
  chooseVerdictFor,
  DESCRIPTOR_BODY,
  ACCESSIBLE_NAME_SOURCES_BODY,
  type TargetDescriptor,
} from "../safety/blocklist.js";
import { SELECTOR_SYNTAX_HELPER, assertSelectorValid } from "./selector-syntax.js";
import type { FieldOption, FormFieldMap, FormFieldRecord } from "../../shared/types.js";

export type FieldKind = FormFieldRecord["kind"];

/**
 * `kind` mapping (research.md R4) — first match wins. Pure; unit-tested. The raw
 * `type` attribute is carried separately on the record so a `password` input
 * stays visible as `type: "password"` even though its `kind` is `"text"`.
 */
export function kindFor(
  tagName: string,
  type: string | null,
  role: string | null,
  isContentEditable: boolean,
): FieldKind {
  const t = (type ?? "").toLowerCase();
  const r = (role ?? "").toLowerCase();
  if (isContentEditable) return "richtext";
  if (tagName === "textarea") return "textarea";
  if (tagName === "select") return "select";
  if (
    tagName === "button" ||
    r === "button" ||
    (tagName === "input" && ["submit", "button", "reset", "image"].includes(t))
  ) {
    return "button";
  }
  if (tagName === "input" && t === "file") return "file";
  if ((tagName === "input" && t === "checkbox") || r === "checkbox" || r === "switch") {
    return "checkbox";
  }
  if ((tagName === "input" && t === "radio") || r === "radio") return "radio";
  if (r === "combobox" || r === "listbox") return "combobox";
  if (tagName === "input" && r === "textbox") return "combobox";
  if (
    tagName === "input" &&
    (t === "" || ["text", "email", "tel", "url", "search", "number", "password"].includes(t))
  ) {
    return "text";
  }
  return "other";
}

/**
 * Counts the in-page collector gathers so selector synthesis (research.md R3) can
 * be a single pure function in the main process rather than a second copy in
 * injected JS. Every count is `document.querySelectorAll(candidate).length` — the
 * emitted selector must resolve unambiguously through `interact`'s plain
 * `document.querySelector`, so uniqueness is verified page-wide, not just within
 * a scoping container.
 */
export interface SelectorCounts {
  /** `CSS.escape`d id, or null. */
  id: string | null;
  /** `CSS.escape`d name, or null. */
  name: string | null;
  tagName: string;
  /** Document-absolute `nth-of-type` path, or `""` when none could be built. */
  structuralPath: string;
  idCount: number;
  nameBareCount: number;
  nameTaggedCount: number;
  structuralCount: number;
}

export interface SelectorResult {
  selector: string | null;
  selectorSynthesised: boolean;
  duplicateId: boolean;
}

/**
 * Selector preference (research.md R3, Assumptions): `#id` when unique → bare
 * `[name="…"]` when unique → tag-qualified `[name]` when unique → the structural
 * path when unique → `null`. `duplicateId` is set when an id is present but not
 * unique (invalid HTML); `selectorSynthesised` when the structural path was used.
 * Pure — the collector supplies the counts.
 */
export function synthesizeSelector(c: SelectorCounts): SelectorResult {
  let duplicateId = false;
  if (c.id) {
    if (c.idCount === 1) {
      return { selector: `#${c.id}`, selectorSynthesised: false, duplicateId: false };
    }
    duplicateId = true;
  }
  if (c.name) {
    if (c.nameBareCount === 1) {
      return { selector: `[name="${c.name}"]`, selectorSynthesised: false, duplicateId };
    }
    if (c.nameTaggedCount === 1) {
      return {
        selector: `${c.tagName}[name="${c.name}"]`,
        selectorSynthesised: false,
        duplicateId,
      };
    }
  }
  if (c.structuralPath && c.structuralCount === 1) {
    return { selector: c.structuralPath, selectorSynthesised: true, duplicateId };
  }
  return { selector: null, selectorSynthesised: true, duplicateId };
}

/**
 * Cut a list to `cap` in order, reporting whether anything was dropped (FR-010).
 * Pure; applied in the main process for both the control cap and the per-record
 * options cap so the boundary payload is bounded by a value read from `config`.
 */
export function capList<T>(items: T[], cap: number): { items: T[]; truncated: boolean } {
  if (items.length > cap) return { items: items.slice(0, cap), truncated: true };
  return { items, truncated: false };
}

/**
 * A generous in-page hard ceiling so a pathological page cannot make the
 * collector build an unbounded raw list before the real (config) cap is applied
 * in the main process. Far above the 200 default and any real form.
 */
const COLLECTOR_HARD_CEILING = 2000;

interface RawRecord {
  descriptor: TargetDescriptor;
  selectorCounts: SelectorCounts;
  label: string;
  required: boolean;
  group: string | null;
  inFormAncestor: boolean;
  visible: boolean;
  currentValue: string | boolean | string[] | null;
  options: FieldOption[];
  optionsAvailable: boolean;
  optionsTruncated: boolean;
  /** feature 008 — text-like kinds only, and only when the element declares them. */
  maxLength?: number;
  pattern?: string;
  inputMode?: string;
  /**
   * feature 008 (R7) — set on a hidden value-mirror record: the index (in the
   * pre-filter record list) of the combobox whose value this input carries,
   * present only when that combobox is itself in the list.
   */
  mirrorOfIndex?: number;
  /**
   * feature 008 (R7) — set on any hidden value-mirror record: an in-page-computed
   * selector for its combobox. Used for `mirrors` when the combobox is not in the
   * record list (e.g. a `fields`-projected read that named only the mirror), and
   * as the signal that the record is a mirror (⇒ `interactive: false`).
   */
  mirrorComboHint?: string;
}

type CollectorResult =
  | { __invalidSelector: true }
  | { containerFound: false }
  | {
      containerFound: true;
      observedAt: string;
      hardCeilingHit: boolean;
      /** feature 008 — `true` when the read was scoped to an explicit `fields` list. */
      fieldsProjected: boolean;
      records: RawRecord[];
    };

/**
 * The in-page collector (isolated world). Returns `{ __invalidSelector: true }`
 * when a `containerSelector` / `fields` entry is not valid CSS,
 * `{ containerFound: false }` when a container selector resolved to nothing;
 * otherwise the raw record list in document order (before the config caps).
 *
 * When `fields` is supplied the collector emits records **only** for elements
 * matching those selectors (unioned, deduped, document order) — including
 * elements a default read would exclude as non-interactive (FR-010).
 */
/**
 * In-page: resolve once `document.readyState === "complete"`, or after
 * `timeoutMs`, whichever comes first (feature 011, US3). Never rejects.
 */
export function domReadyScript(timeoutMs: number): string {
  return `new Promise((resolve) => {
    if (document.readyState === "complete") return resolve(true);
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(true); } };
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "complete") finish();
    });
    setTimeout(finish, ${Math.max(0, Math.floor(timeoutMs))});
  })`;
}

export function formFieldsScript(
  containerSelector: string | undefined,
  fields: string[] | undefined,
): string {
  const containerJson = containerSelector === undefined ? "null" : JSON.stringify(containerSelector);
  const fieldsJson = fields === undefined ? "null" : JSON.stringify(fields);
  return `(() => {
  ${SELECTOR_SYNTAX_HELPER}
  try {
  const HARD_CEILING = ${COLLECTOR_HARD_CEILING};
  const containerSel = ${containerJson};
  const fieldsList = ${fieldsJson};
  const root = containerSel == null ? document : __querySafe(document, containerSel);
  if (containerSel != null && !root) return { containerFound: false };
  const scope = root || document;

  const FORMISH_ROLES = ["combobox","listbox","textbox","checkbox","radio","switch","button"];
  const isCandidate = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") return true;
    if (el.isContentEditable === true) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    return FORMISH_ROLES.indexOf(role) !== -1;
  };

  const descriptorFor = (el) => (function (el) {${DESCRIPTOR_BODY}
  })(el);

  const labelFor = (el) => {
    ${ACCESSIBLE_NAME_SOURCES_BODY}
    const cands = [__forLabelText, __wrapLabelText, __ariaLabelText, __ariaLabelledbyText, __placeholderText];
    for (const c of cands) { const t = (c || "").trim(); if (t) return t; }
    return "";
  };

  const isVisible = (el) => {
    try {
      if (el.closest("[hidden]")) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const rects = el.getClientRects();
      if (!rects || rects.length === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return true;
    } catch (_) { return true; }
  };

  const structuralPath = (el) => {
    const segs = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== "html") {
      const tag = cur.tagName.toLowerCase();
      let k = 1, sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) k++; sib = sib.previousElementSibling; }
      segs.unshift(tag + ":nth-of-type(" + k + ")");
      const cand = segs.join(" > ");
      try { if (document.querySelectorAll(cand).length === 1) return cand; } catch (_) {}
      cur = cur.parentElement;
    }
    return segs.join(" > ");
  };

  const groupFor = (el, idx) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const isRadio = (tag === "input" && type === "radio") || role === "radio";
    if (!isRadio) return null;
    if (el.getAttribute("name")) return el.getAttribute("name");
    const fs = el.closest("fieldset");
    if (fs && fs.id) return fs.id;
    if (fs) return "group:fieldset:" + idx;
    return "group:" + idx;
  };

  const collectComboOptions = (el) => {
    const seen = new Set();
    const out = [];
    const push = (nodes) => { for (const n of nodes) { if (!seen.has(n)) { seen.add(n); out.push(n); } } };
    push(el.querySelectorAll('[role="option"]'));
    for (const attr of ["aria-controls", "aria-owns"]) {
      const ref = el.getAttribute(attr);
      if (ref) for (const id of ref.split(/\\s+/)) {
        const host = document.getElementById(id);
        if (host) push(host.querySelectorAll('[role="option"]'));
      }
    }
    const desc = el.querySelector('[role="listbox"]');
    if (desc) push(desc.querySelectorAll('[role="option"]'));
    let sib = el.nextElementSibling;
    while (sib) {
      if (sib.getAttribute && (sib.getAttribute("role") || "").toLowerCase() === "listbox") {
        push(sib.querySelectorAll('[role="option"]'));
      }
      sib = sib.nextElementSibling;
    }
    return out;
  };

  const optionsFor = (el) => {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    let raw = [];
    let available = false;
    if (tag === "select") {
      available = true;
      raw = [].slice.call(el.options).map((o) => ({ label: o.label || o.text || "", value: o.value }));
    } else if (role === "combobox" || role === "listbox") {
      const opts = collectComboOptions(el);
      if (opts.length > 0) {
        available = true;
        raw = opts.map((o) => {
          const dv = o.getAttribute("data-value");
          const v = o.getAttribute("value");
          return {
            label: ((o.innerText || o.textContent || "") + "").trim(),
            value: dv != null ? dv : (v != null ? v : (o.id || "")),
          };
        });
      }
    }
    // The options cap is applied in the main process (capList); the collector
    // returns every option so the flag can be set from a config value.
    return { options: raw, optionsAvailable: available, optionsTruncated: false };
  };

  const currentValueFor = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (el.isContentEditable === true) return el.innerText != null ? el.innerText : "";
    if (tag === "select") {
      if (el.multiple) return [].slice.call(el.selectedOptions).map((o) => o.value);
      return el.value;
    }
    if ((tag === "input" && (type === "checkbox" || type === "radio")) ||
        role === "checkbox" || role === "switch" || role === "radio") {
      if (typeof el.checked === "boolean") return el.checked;
      return el.getAttribute("aria-checked") === "true";
    }
    if (tag === "button") return null;
    if (tag === "input" && ["file","submit","button","reset","image"].indexOf(type) !== -1) return null;
    if (typeof el.value === "string") return el.value;
    return null;
  };

  const esc = (s) => CSS.escape(s);

  // feature 008 — constraint hints for text-like inputs / textareas, only when
  // the element actually declares them.
  const constraintsFor = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea") return {};
    const out = {};
    const mlAttr = el.getAttribute("maxlength");
    if (mlAttr != null && typeof el.maxLength === "number" && el.maxLength >= 0) {
      out.maxLength = el.maxLength;
    }
    const pat = el.getAttribute("pattern");
    if (pat != null) out.pattern = pat;
    const im = el.getAttribute("inputmode");
    if (im != null) out.inputMode = im;
    return out;
  };

  let candidates;
  if (fieldsList) {
    const seen = new Set();
    const picked = [];
    for (const sel of fieldsList) {
      const matches = __queryAllSafe(document, sel);
      for (const el of matches) { if (!seen.has(el)) { seen.add(el); picked.push(el); } }
    }
    picked.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    candidates = picked;
  } else {
    candidates = [].slice.call(
      scope.querySelectorAll("input, select, textarea, button, [contenteditable], [role]")
    ).filter(isCandidate);
  }
  const hardCeilingHit = candidates.length > HARD_CEILING;
  const chosen = hardCeilingHit ? candidates.slice(0, HARD_CEILING) : candidates;

  // feature 008 (R7): value-mirror cluster pass. Pair each combobox / listbox /
  // listbox-owner with a hidden input that carries its value: same cluster means
  // it shares the name attribute, or the combobox sits inside a marked
  // (class or data-* bearing) container that also holds the input.
  const roleOf = (el) => (el.getAttribute("role") || "").toLowerCase();
  const ownsListbox = (el) => {
    for (const attr of ["aria-controls", "aria-owns"]) {
      const ref = el.getAttribute(attr);
      if (ref) for (const id of ref.split(/\\s+/)) {
        const n = document.getElementById(id);
        if (n && roleOf(n) === "listbox") return true;
      }
    }
    return false;
  };
  const isComboEl = (el) => {
    const r = roleOf(el);
    return r === "combobox" || r === "listbox" || ownsListbox(el);
  };
  const isHiddenMirrorInput = (el) => {
    if (el.tagName.toLowerCase() !== "input") return false;
    const t = (el.getAttribute("type") || "").toLowerCase();
    const hidden = t === "hidden" || !isVisible(el);
    return hidden && (t === "hidden" || !!el.getAttribute("name"));
  };
  const markedAncestor = (el, has) => {
    let a = el.parentElement, hops = 0;
    while (a && hops < 3) {
      const tag = a.tagName.toLowerCase();
      if (tag === "form" || tag === "body") break;
      const marked = !!a.className ||
        [].some.call(a.attributes, (at) => at.name.indexOf("data-") === 0);
      if (marked) { const c = has(a); if (c) return c; }
      a = a.parentElement; hops++;
    }
    return null;
  };
  // A stable selector for a combobox that is NOT itself in the record list
  // (fallback for a value-mirror mirrors field): id, then name, then structural.
  const selectorHintFor = (el) => {
    if (el.id) {
      const s = "#" + esc(el.id);
      try { if (document.querySelectorAll(s).length === 1) return s; } catch (_) {}
    }
    const nm = el.getAttribute("name");
    if (nm) {
      const s = '[name="' + esc(nm) + '"]';
      try { if (document.querySelectorAll(s).length === 1) return s; } catch (_) {}
      const st = el.tagName.toLowerCase() + s;
      try { if (document.querySelectorAll(st).length === 1) return st; } catch (_) {}
    }
    return structuralPath(el);
  };
  // For a hidden mirror input, find the combobox whose value it carries:
  // shares the name attribute, or sits in a shared marked container.
  const comboForMirror = (mirror) => {
    const nm = mirror.getAttribute("name");
    if (nm) {
      const byName = [].slice.call(document.querySelectorAll('[name="' + esc(nm) + '"]'))
        .find((x) => x !== mirror && isComboEl(x));
      if (byName) return byName;
    }
    return markedAncestor(mirror, (a) => {
      const c = a.querySelector('[role="combobox"], [role="listbox"]');
      return c && c !== mirror ? c : null;
    });
  };

  const chosenIndexOf = new Map();
  chosen.forEach((el, i) => chosenIndexOf.set(el, i));

  const mirrorOfIndexByChosen = {}; // chosenIndex(mirror) -> chosenIndex(combo), both in the list
  const mirrorComboHint = {};       // chosenIndex(mirror) -> in-page selector hint for its combo
  const comboHasMirror = new Set();  // chosenIndex(combo) that a mirror points at
  chosen.forEach((el, i) => {
    if (!isHiddenMirrorInput(el)) return;
    const combo = comboForMirror(el);
    if (!combo) return;
    mirrorComboHint[i] = selectorHintFor(combo);
    const ci = chosenIndexOf.get(combo);
    if (ci !== undefined) {
      mirrorOfIndexByChosen[i] = ci;
      comboHasMirror.add(ci);
    }
  });

  const records = chosen.map((el, idx) => {
    const id = el.id || "";
    const nm = el.getAttribute("name") || "";
    const tagName = el.tagName.toLowerCase();
    const path = structuralPath(el);
    const idSel = id ? "#" + esc(id) : "";
    const nameBare = nm ? '[name="' + esc(nm) + '"]' : "";
    const nameTagged = nm ? tagName + '[name="' + esc(nm) + '"]' : "";
    const label = labelFor(el);
    const required =
      el.required === true ||
      el.getAttribute("aria-required") === "true" ||
      /\\*/.test(label);
    const opt = optionsFor(el);
    // A combobox that has a value-mirror must NOT synthesise a name-attribute
    // selector (it would also match the hidden input) — force id / structural
    // (R7 / FR-015).
    const suppressName = comboHasMirror.has(idx);
    const rec = Object.assign({
      descriptor: descriptorFor(el),
      selectorCounts: {
        id: id ? esc(id) : null,
        name: suppressName ? null : (nm ? esc(nm) : null),
        tagName: tagName,
        structuralPath: path,
        idCount: idSel ? document.querySelectorAll(idSel).length : 0,
        nameBareCount: suppressName ? 0 : (nameBare ? document.querySelectorAll(nameBare).length : 0),
        nameTaggedCount: suppressName ? 0 : (nameTagged ? document.querySelectorAll(nameTagged).length : 0),
        structuralCount: path ? document.querySelectorAll(path).length : 0,
      },
      label: label,
      required: required,
      group: groupFor(el, idx),
      inFormAncestor: !!el.closest("form"),
      visible: isVisible(el),
      currentValue: currentValueFor(el),
      options: opt.options,
      optionsAvailable: opt.optionsAvailable,
      optionsTruncated: opt.optionsTruncated,
    }, constraintsFor(el));
    if (Object.prototype.hasOwnProperty.call(mirrorOfIndexByChosen, idx)) {
      rec.mirrorOfIndex = mirrorOfIndexByChosen[idx];
    }
    if (Object.prototype.hasOwnProperty.call(mirrorComboHint, idx)) {
      rec.mirrorComboHint = mirrorComboHint[idx];
    }
    return rec;
  });

  return {
    containerFound: true,
    observedAt: new Date().toISOString(),
    hardCeilingHit: hardCeilingHit,
    fieldsProjected: !!fieldsList,
    records: records,
  };
  } catch (e) {
    if (e && e.__invalidSelector) return { __invalidSelector: true };
    throw e;
  }
})()`;
}

/** Options a `read_form_fields` call may carry (feature 008). */
export interface ReadFormFieldsOptions {
  /**
   * Return records only for controls matching these selectors, document order.
   * An explicit selector is returned even for a non-interactive element
   * (overrides the default exclusion, FR-010). Mutually exclusive with
   * `containerSelector`.
   */
  fields?: string[];
  /** Include plain buttons and hidden value-mirror inputs (default `false`). */
  includeNonInteractive?: boolean;
  /** Return only records that are `required` and whose current value is empty. */
  only?: "required-unfilled";
}

/**
 * Which `interact` operation applies to a control, from its `kind` alone
 * (data-model.md R8). Pure. Mechanical restatement — no judgement (Principle II).
 */
export function operationForKind(
  kind: FormFieldRecord["kind"],
): NonNullable<FormFieldRecord["operation"]> {
  switch (kind) {
    case "text":
    case "textarea":
    case "richtext":
      return "fill";
    case "select":
    case "combobox":
      return "choose";
    case "checkbox":
    case "radio":
    case "button":
      return "activate";
    default:
      return "none";
  }
}

/**
 * A record is `required` and currently holds no value: empty string / unchecked
 * / no option chosen / never set. Pure — the byte-budget and `only` filters and
 * the unit tests all compute from this one predicate (data-model.md §1).
 */
export function isRequiredUnfilled(
  rec: Pick<FormFieldRecord, "required" | "currentValue">,
): boolean {
  if (rec.required !== true) return false;
  const v = rec.currentValue;
  if (v === undefined || v === null) return true;
  if (v === "") return true;
  if (v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Malformed-call guard (feature 008, research.md R6): `fields` and
 * `containerSelector` are mutually exclusive. Returns the error to throw, or
 * `null` when the shape is valid. Shared by the MCP dispatch and `readFormFields`
 * so a direct call is guarded too.
 */
export function checkReadFormFieldsShape(
  containerSelector: string | undefined,
  fields: string[] | undefined,
): HyppoError | null {
  if (containerSelector !== undefined && fields !== undefined) {
    return new HyppoError(
      "BATCH_REJECTED",
      "read_form_fields accepts either `fields` or `containerSelector`, not both.",
    );
  }
  return null;
}

/**
 * Read one tab's form controls (feature 005 + 008). Runs the collector in an
 * isolated world, then in the main process attaches the fill / click / choose
 * verdicts from the same `blocklist.ts` functions `interact` uses, omits a
 * credential field's `currentValue` key, applies the `includeNonInteractive` /
 * `only` filters, and trims the payload to a byte budget (FR-011). No
 * `log.record` call (FR-014); nothing persisted (FR-013).
 */
export async function readFormFields(
  wc: WebContents,
  tabId: string,
  containerSelector: string | undefined,
  queueDepth: number,
  opts: ReadFormFieldsOptions = {},
): Promise<FormFieldMap> {
  const { fields, includeNonInteractive = false, only } = opts;

  const shapeError = checkReadFormFieldsShape(containerSelector, fields);
  if (shapeError) throw shapeError;

  // feature 011 (US3 / FR-018): wait, briefly and bounded, for the document to
  // finish parsing so a fill/click/choose verdict is never computed against a
  // half-built DOM. Proceeds anyway on timeout; `read_page` is not gated this way.
  await wc.executeJavaScript(domReadyScript(config.domReadyTimeoutMs), true);

  const raw = (await wc.executeJavaScript(
    formFieldsScript(containerSelector, fields),
    true,
  )) as CollectorResult;

  // A non-CSS `containerSelector` or `fields` entry → INVALID_SELECTOR (before
  // any "not found" interpretation, FR-018).
  assertSelectorValid(raw);

  const full = raw as Extract<CollectorResult, { containerFound: true }>;
  if (!full.containerFound) {
    throw new HyppoError(
      "TARGET_NOT_FOUND",
      `No element matches container selector ${JSON.stringify(containerSelector)}.`,
    );
  }

  let mapped: FormFieldRecord[] = full.records.map((r) => {
    const d = r.descriptor;
    const sel = synthesizeSelector(r.selectorCounts);
    const fillVerdict = fillVerdictFor(d);
    const clickVerdict = clickVerdictFor(d);
    const kind = kindFor(d.tagName, d.type, d.role, d.isContentEditable);
    const opts_ = capList(r.options, config.formFieldOptionCap);
    const record: FormFieldRecord = {
      selector: sel.selector,
      selectorSynthesised: sel.selectorSynthesised,
      duplicateId: sel.duplicateId,
      kind,
      type: d.type,
      label: r.label,
      required: r.required,
      group: r.group,
      inFormAncestor: r.inFormAncestor,
      visible: r.visible,
      options: opts_.items,
      optionsAvailable: r.optionsAvailable,
      optionsTruncated: opts_.truncated,
      fillVerdict,
      clickVerdict,
      operation: operationForKind(kind),
      chooseVerdict: chooseVerdictFor(d),
    };
    // A credential field's value never enters the payload — the key is omitted
    // entirely, not set to null / a placeholder, so payload length cannot leak
    // the secret's length (FR-005, SC-005).
    if (fillVerdict.ruleId !== "credential-field") {
      record.currentValue = r.currentValue;
    }
    if (r.maxLength !== undefined) record.maxLength = r.maxLength;
    if (r.pattern !== undefined) record.pattern = r.pattern;
    if (r.inputMode !== undefined) record.inputMode = r.inputMode;
    // A plain button is non-interactive for a fill workflow.
    if (kind === "button") record.interactive = false;
    return record;
  });

  // Value-mirror cluster (R7): a hidden input carrying a combobox's value is
  // marked non-interactive and points at that combobox's selector — the
  // synthesised one when the combobox is also in the list, else the in-page hint.
  // Resolved before any filtering so the index alignment with `full.records` holds.
  mapped.forEach((rec, i) => {
    const raw = full.records[i];
    if (raw.mirrorComboHint === undefined && raw.mirrorOfIndex === undefined) return;
    rec.interactive = false;
    const canonical =
      raw.mirrorOfIndex !== undefined ? mapped[raw.mirrorOfIndex]?.selector : undefined;
    const target = canonical ?? raw.mirrorComboHint;
    if (target != null) rec.mirrors = target;
  });

  // Default-read exclusion: plain buttons and non-interactive records (value
  // mirrors). Skipped when the read was `fields`-projected (an explicit selector
  // overrides the exclusion, FR-010) or `includeNonInteractive: true`.
  if (!full.fieldsProjected && !includeNonInteractive) {
    mapped = mapped.filter((rec) => rec.kind !== "button" && rec.interactive !== false);
  }

  if (only === "required-unfilled") {
    mapped = mapped.filter(isRequiredUnfilled);
  }

  // feature 011 (US5): lean the default record so a large form's first,
  // unprojected read fits the byte budget without trimming any control. A
  // dropdown keeps the full options triplet (`options` / `optionsAvailable` /
  // `optionsTruncated`) — it is the point of reading a dropdown. Every other
  // kind carried an empty `options: []` plus two always-false flags; those go,
  // and `includeNonInteractive` restores them. `selectorSynthesised` /
  // `duplicateId` stay in the default record — small, and they tell an agent
  // when a suggested selector is fragile.
  if (!includeNonInteractive) {
    const dropdown = new Set(["select", "combobox", "listbox"]);
    mapped = mapped.map((rec) => {
      if (dropdown.has(rec.kind)) return rec;
      const lean: FormFieldRecord = { ...rec };
      delete lean.options;
      delete lean.optionsAvailable;
      delete lean.optionsTruncated;
      return lean;
    });
  }

  const capped = capList(mapped, config.formFieldControlCap);
  let records = capped.items;
  let truncated = capped.truncated || full.hardCeilingHit;

  // Byte budget (FR-011, R5): drop the last record while the serialised payload
  // exceeds `formFieldReadMaxBytes`. Document order is preserved; a single flag
  // covers count-cap + option-cap + byte-budget trimming together.
  const url = wc.getURL();
  const measure = () =>
    Buffer.byteLength(
      JSON.stringify({ tabId, url, observedAt: full.observedAt, truncated: true, records, queueDepth }),
      "utf8",
    );
  if (records.length > 0 && measure() > config.formFieldReadMaxBytes) {
    while (records.length > 0 && measure() > config.formFieldReadMaxBytes) {
      records = records.slice(0, -1);
    }
    truncated = true;
  }

  return { tabId, url, observedAt: full.observedAt, truncated, records, queueDepth };
}
