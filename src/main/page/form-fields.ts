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
  DESCRIPTOR_BODY,
  ACCESSIBLE_NAME_SOURCES_BODY,
  type TargetDescriptor,
} from "../safety/blocklist.js";
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
}

type CollectorResult =
  | { containerFound: false }
  | {
      containerFound: true;
      observedAt: string;
      hardCeilingHit: boolean;
      records: RawRecord[];
    };

/**
 * The in-page collector (isolated world). Returns `{ containerFound: false }`
 * when a container selector was given but resolved to nothing; otherwise the raw
 * record list in document order, capped at `formFieldControlCap`.
 */
export function formFieldsScript(containerSelector: string | undefined): string {
  const containerJson = containerSelector === undefined ? "null" : JSON.stringify(containerSelector);
  return `(() => {
  const HARD_CEILING = ${COLLECTOR_HARD_CEILING};
  const containerSel = ${containerJson};
  const root = containerSel == null ? document : document.querySelector(containerSel);
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

  const all = [].slice.call(
    scope.querySelectorAll("input, select, textarea, button, [contenteditable], [role]")
  ).filter(isCandidate);
  const hardCeilingHit = all.length > HARD_CEILING;
  const chosen = hardCeilingHit ? all.slice(0, HARD_CEILING) : all;

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
    return {
      descriptor: descriptorFor(el),
      selectorCounts: {
        id: id ? esc(id) : null,
        name: nm ? esc(nm) : null,
        tagName: tagName,
        structuralPath: path,
        idCount: idSel ? document.querySelectorAll(idSel).length : 0,
        nameBareCount: nameBare ? document.querySelectorAll(nameBare).length : 0,
        nameTaggedCount: nameTagged ? document.querySelectorAll(nameTagged).length : 0,
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
    };
  });

  return {
    containerFound: true,
    observedAt: new Date().toISOString(),
    hardCeilingHit: hardCeilingHit,
    records: records,
  };
})()`;
}

/**
 * Read one tab's form controls (feature 005). Runs the collector in an isolated
 * world, then in the main process attaches the fill / click verdicts from the
 * same `blocklist.ts` functions `interact` uses and omits a credential field's
 * `currentValue` key. No `log.record` call (FR-014); nothing persisted (FR-013).
 */
export async function readFormFields(
  wc: WebContents,
  tabId: string,
  containerSelector: string | undefined,
  queueDepth: number,
): Promise<FormFieldMap> {
  const raw = (await wc.executeJavaScript(
    formFieldsScript(containerSelector),
    true,
  )) as CollectorResult;

  if (!raw.containerFound) {
    throw new HyppoError(
      "TARGET_NOT_FOUND",
      `No element matches container selector ${JSON.stringify(containerSelector)}.`,
    );
  }

  const capped = capList(raw.records, config.formFieldControlCap);

  const records: FormFieldRecord[] = capped.items.map((r) => {
    const d = r.descriptor;
    const sel = synthesizeSelector(r.selectorCounts);
    const fillVerdict = fillVerdictFor(d);
    const clickVerdict = clickVerdictFor(d);
    const opts = capList(r.options, config.formFieldOptionCap);
    const record: FormFieldRecord = {
      selector: sel.selector,
      selectorSynthesised: sel.selectorSynthesised,
      duplicateId: sel.duplicateId,
      kind: kindFor(d.tagName, d.type, d.role, d.isContentEditable),
      type: d.type,
      label: r.label,
      required: r.required,
      group: r.group,
      inFormAncestor: r.inFormAncestor,
      visible: r.visible,
      options: opts.items,
      optionsAvailable: r.optionsAvailable,
      optionsTruncated: opts.truncated,
      fillVerdict,
      clickVerdict,
    };
    // A credential field's value never enters the payload — the key is omitted
    // entirely, not set to null / a placeholder, so payload length cannot leak
    // the secret's length (FR-005, SC-005).
    if (fillVerdict.ruleId !== "credential-field") {
      record.currentValue = r.currentValue;
    }
    return record;
  });

  return {
    tabId,
    url: wc.getURL(),
    observedAt: raw.observedAt,
    truncated: capped.truncated || raw.hardCeilingHit,
    records,
    queueDepth,
  };
}
