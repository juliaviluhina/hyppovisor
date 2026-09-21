// Compact actionable snapshot (feature 027, FR-001…FR-005, research.md R1/R2).
//
// One read-only isolated-world collector walks the DOM in document order →
// raw per-control records (a TargetDescriptor built with the SAME shared body
// `interact` uses, a verbatim accessible label, the current value) plus the
// page's visible text and omission counts — all from a single atomic capture.
// The main process attaches `actionable` / `refused` markers through the
// shared pure verdict functions `interact` uses, so markers agree with
// `interact` by construction, omits a credential field's value entirely, and
// trims the payload to explicit budgets (FR-004).
//
// It performs no interaction, writes nothing to the shared data directory,
// and adds no interaction-audit-log entry. `read_page` / `read_form_fields` /
// `interact` are untouched. Ranking (feature 027, US2) is wired by the caller:
// this module returns `ranking: null, rankingStatus: null` always.

import { createHash } from "node:crypto";
import type { WebContents } from "electron";
import { config } from "../config.js";
import {
  fillVerdictFor,
  clickVerdictFor,
  chooseVerdictFor,
  DESCRIPTOR_BODY,
  ACCESSIBLE_NAME_SOURCES_BODY,
  type TargetDescriptor,
} from "../safety/blocklist.js";
import {
  kindFor,
  operationForKind,
  domReadyScript,
  synthesizeSelector,
  type SelectorCounts,
} from "./form-fields.js";
import { targetDescriptorScript } from "../safety/blocklist.js";
import { assertSelectorValid } from "./selector-syntax.js";
import { HyppoError } from "../errors.js";
import { truncateToBytes } from "./truncate.js";
import type {
  ActionableElement,
  ActionableOperation,
  ActionableSnapshot,
  OmissionRecord,
} from "../../shared/types.js";

/**
 * In-page hard ceiling so a pathological page cannot make the collector
 * build an unbounded raw list before the real (config) cap is applied in
 * the main process. Far above the 250 default and any real page.
 */
const COLLECTOR_HARD_CEILING = 2000;

/** Max label characters kept per record; labels are names, not content. */
const LABEL_CAP = 300;

export interface ActionableRawRecord {
  descriptor: TargetDescriptor;
  role: string;
  label: string;
  value: string | null;
  /**
   * Uniqueness counts for private selector synthesis (research.md R2). Used
   * main-side only to address snapshot entries — never sent to the model.
   */
  selectorCounts: SelectorCounts;
}

export interface ActionableCollectorResult {
  observedAt: string;
  url: string;
  title: string;
  text: string;
  hardCeilingHit: boolean;
  /** Candidates excluded as hidden / disabled / offscreen / decorative. */
  hiddenNodes: number;
  records: ActionableRawRecord[];
}

/**
 * The in-page collector (isolated world). Returns the raw record list in
 * document order (before the config caps) plus the visible text from the
 * same capture, so table and text can never disagree about page state.
 */
export function actionableScript(): string {
  return `(() => {
  try {
  const HARD_CEILING = ${COLLECTOR_HARD_CEILING};
  const LABEL_CAP = ${LABEL_CAP};
  const CANDIDATE_SELECTOR = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],' +
    '[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],' +
    '[role="tab"],[role="menuitem"],[role="combobox"],[role="textbox"],[role="searchbox"],[role="spinbutton"]';

  const roleFor = (el) => {
    const explicit = (el.getAttribute("role") || "").toLowerCase();
    const known = ["button","link","checkbox","radio","switch","tab","menuitem","combobox","textbox","searchbox","spinbutton"];
    if (known.indexOf(explicit) !== -1) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea" || el.isContentEditable === true) return "textbox";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "button" || t === "submit" || t === "reset" || t === "image") return "button";
      if (t === "search") return "searchbox";
      if (t === "number") return "spinbutton";
      if (t === "" || t === "text" || t === "email" || t === "url" || t === "tel" || t === "password") return "textbox";
    }
    return "other";
  };

  const descriptorFor = (el) => (function (el) {${DESCRIPTOR_BODY}
  })(el);

  const labelFor = (el) => {
    ${ACCESSIBLE_NAME_SOURCES_BODY}
    const cands = [__ariaLabelledbyText, __ariaLabelText, __forLabelText, __wrapLabelText, __placeholderText, __titleText];
    for (const c of cands) { const t = (c || "").trim(); if (t) return t.slice(0, LABEL_CAP); }
    const tag = el.tagName.toLowerCase();
    if (tag === "button" || tag === "a" || tag === "summary" || tag === "select") {
      const t = ((el.innerText || el.textContent) || "").trim().replace(/\\s+/g, " ");
      if (t) return t.slice(0, LABEL_CAP);
    }
    return "";
  };

  const valueFor = (el) => {
    const tag = el.tagName.toLowerCase();
    const t = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "input" && (t === "checkbox" || t === "radio")) return el.checked ? "checked" : "unchecked";
    if (tag === "select") {
      const sel = [];
      for (const o of el.selectedOptions || []) sel.push((o.label || o.textContent || "").trim());
      return sel.join(", ");
    }
    if ("value" in el && typeof el.value === "string") return el.value;
    return null;
  };

  const overlapsViewport = (r) =>
    r.width > 0 && r.height > 0 &&
    r.bottom > 0 && r.top < window.innerHeight &&
    r.right > 0 && r.left < window.innerWidth;

  const isExcluded = (el) => {
    try {
      if (el.closest('[hidden],[aria-hidden="true"],[inert],script,style,noscript,template')) return true;
      if (el.matches(":disabled,[aria-disabled=\\"true\\"]")) return true;
      if (typeof el.checkVisibility === "function" &&
          !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return true;
      const r = el.getBoundingClientRect();
      if (!overlapsViewport(r)) return true;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit)) return true;
      return false;
    } catch (_) { return false; }
  };

  const seen = new Set();
  const records = [];
  let hiddenNodes = 0;
  const all = document.querySelectorAll(CANDIDATE_SELECTOR);
  for (const el of all) {
    if (seen.has(el)) continue;
    seen.add(el);
    const tag = el.tagName.toLowerCase();
    const t = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "input" && t === "hidden") { hiddenNodes++; continue; }
    if (records.length >= HARD_CEILING) break;
    if (isExcluded(el)) { hiddenNodes++; continue; }
    const role = roleFor(el);
    const label = labelFor(el) || role;
    const stag = el.tagName.toLowerCase();
    const escId = el.id ? CSS.escape(el.id) : null;
    const escName = el.getAttribute("name") ? CSS.escape(el.getAttribute("name")) : null;
    const segs = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== "html") {
      const ctag = cur.tagName.toLowerCase();
      let k = 1, sib = cur.previousElementSibling;
      while (sib) { if (sib.tagName === cur.tagName) k++; sib = sib.previousElementSibling; }
      segs.unshift(ctag + ":nth-of-type(" + k + ")");
      cur = cur.parentElement;
    }
    const structuralPath = segs.join(" > ");
    const selectorCounts = {
      id: escId,
      name: escName,
      tagName: stag,
      structuralPath,
      idCount: escId ? document.querySelectorAll("#" + escId).length : 0,
      nameBareCount: escName ? document.querySelectorAll('[name="' + escName + '"]').length : 0,
      nameTaggedCount: escName ? document.querySelectorAll(stag + '[name="' + escName + '"]').length : 0,
      structuralCount: structuralPath ? document.querySelectorAll(structuralPath).length : 0,
    };
    records.push({ descriptor: descriptorFor(el), role, label, value: valueFor(el), selectorCounts });
  }
  const hardCeilingHit = all.length > HARD_CEILING;
  const body = document.body || document.documentElement;
  return {
    observedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    text: body ? (body.innerText || "") : "",
    hardCeilingHit,
    hiddenNodes,
    records,
  };
  } catch (e) { return { __collectorFailed: true, message: String((e && e.message) || e) }; }
  })()`;
}

/**
 * Opaque token binding one table + text capture together (research.md R2).
 * Any difference in page identity or observed content yields another token,
 * so a stale snapshot can never validate against a changed page.
 */
export function generationFor(  url: string,
  observedAt: string,
  records: Pick<ActionableRawRecord, "role" | "label" | "value">[],
  text: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ url, observedAt, records, text }))
    .digest("hex");
}

/**
 * Map raw records to table entries (research.md R1). Pure; unit-tested.
 * Markers come from the same verdict functions `interact` uses, so a
 * `refused` entry is exactly what `interact` would refuse (SC-004).
 */
export function assembleElements(raw: ActionableRawRecord[]): ActionableElement[] {
  return raw.map((r, i) => {
    const d = r.descriptor;
    const kind = kindFor(d.tagName, d.type, d.role, d.isContentEditable);
    const op = operationForKind(kind);
    const fillV = fillVerdictFor(d);
    const clickV = clickVerdictFor(d);
    const chooseV = chooseVerdictFor(d);
    const credential = fillV.ruleId === "credential-field";
    const operations: ActionableOperation[] = [];
    if (op === "fill" && fillV.verdict === "permitted") operations.push("fill");
    if (op === "choose" && chooseV.allowed) operations.push("choose_option");
    if (op === "activate" && clickV.verdict === "permitted") {
      operations.push(kind === "checkbox" || kind === "radio" ? "space" : "click");
    }
    // Links are navigational reveals, gated by the click verdict.
    if (r.role === "link" && clickV.verdict === "permitted" && operations.indexOf("click") === -1) {
      operations.push("click");
    }
    const marker = operations.length > 0 && !credential ? "actionable" : "refused";
    const element: ActionableElement = {
      index: i + 1,
      role: r.role,
      label: r.label,
      marker,
      operations: marker === "actionable" ? operations : [],
    };
    // A credential field's value never enters the payload — the key is
    // omitted entirely so length cannot leak (form-fields.ts FR-005).
    if (!credential) element.value = r.value;
    return element;
  });
}

/**
 * Private snapshot registry (research.md R2, FR-005). Maps a snapshot
 * `generation` to the data `interact` needs to resolve an index back to a
 * live target: privately synthesised selectors plus the expected identity of
 * each entry. In-memory only (bounded, LRU-evicted) — never persisted, never
 * sent to the model. The payload carries indices alone; model output can
 * never become a selector.
 */
interface SnapshotEntry {
  url: string;
  selectors: (string | null)[];
  descriptors: TargetDescriptor[];
  roles: string[];
  labels: string[];
}

const snapshotRegistry = new Map<string, SnapshotEntry>();
const REGISTRY_CAP = 20;

export function storeSnapshotEntry(generation: string, entry: SnapshotEntry): void {
  if (snapshotRegistry.has(generation)) snapshotRegistry.delete(generation);
  snapshotRegistry.set(generation, entry);
  while (snapshotRegistry.size > REGISTRY_CAP) {
    const oldest = snapshotRegistry.keys().next();
    if (oldest.done) break;
    snapshotRegistry.delete(oldest.value);
  }
}

/** Test hook: inspect a stored entry without a live tab. */
export function lookupSnapshotEntry(generation: string): SnapshotEntry | undefined {
  return snapshotRegistry.get(generation);
}

/** Test hook: clear the registry between cases. */
export function clearSnapshotRegistry(): void {
  snapshotRegistry.clear();
}

const stale = (why: string): HyppoError =>
  new HyppoError(
    "TARGET_NOT_FOUND",
    `Snapshot reference is stale (${why}); re-read the tab with read_actionable.`,
  );

/**
 * Resolve a snapshot `(generation, index)` to a private selector, re-validating
 * the live target (research.md R2): same tab URL, target still connected, and
 * the live descriptor's identity (tag, role, name) matches the snapshot. Any
 * mismatch throws stale `TARGET_NOT_FOUND` — the position is never
 * reinterpreted. Callers then run the normal verdict-checked flow, so safety
 * is re-decided live even if the marker lied.
 */
export async function resolveSnapshotTarget(
  wc: WebContents,
  generation: string,
  index: number,
): Promise<string> {
  const entry = snapshotRegistry.get(generation);
  if (!entry) throw stale("unknown snapshot generation");
  if (!Number.isInteger(index) || index < 1 || index > entry.selectors.length) {
    throw stale(`index ${String(index)} is outside this snapshot`);
  }
  const selector = entry.selectors[index - 1];
  if (!selector) throw stale("that entry has no addressable target");
  if (wc.getURL() !== entry.url) throw stale("the tab navigated since the snapshot");
  const live = (await wc.executeJavaScript(targetDescriptorScript(selector), true)) as
    | TargetDescriptor
    | { __invalidSelector: true }
    | null;
  assertSelectorValid(live);
  const want = entry.descriptors[index - 1]!;
  const current = live as TargetDescriptor | null;
  if (
    !current ||
    current.tagName !== want.tagName ||
    (current.role ?? null) !== (want.role ?? null) ||
    current.name !== want.name
  ) {
    throw stale("the target changed since the snapshot");
  }
  return selector;
}

/**
 * Read one tab's actionable snapshot (feature 027, US1). Runs the collector
 * in an isolated world after the same bounded DOM-ready wait
 * `read_form_fields` uses, then assembles, caps, and budgets the payload in
 * the main process. No audit entry; nothing persisted. Ranking is always
 * null here — the caller (US2) attaches it.
 */
export async function readActionable(
  wc: WebContents,
  tabId: string,
  queueDepth: number,
): Promise<ActionableSnapshot> {
  await wc.executeJavaScript(domReadyScript(config.domReadyTimeoutMs), true);

  const raw = (await wc.executeJavaScript(actionableScript(), true)) as
    | ActionableCollectorResult
    | { __collectorFailed: true; message: string };
  if ("__collectorFailed" in raw) {
    throw new Error(`Actionable snapshot collection failed: ${raw.message}`);
  }

  const elements = assembleElements(raw.records);
  // Private selectors run parallel to the table (same order, same trimming)
  // so registry indices always match payload indices. Never in the payload.
  let privates = raw.records.map((r) => synthesizeSelector(r.selectorCounts));
  let kept = elements.slice(0, config.actionableElementCap);
  privates = privates.slice(0, config.actionableElementCap);
  let overBudget = elements.length - kept.length;

  const textCut = truncateToBytes(raw.text, config.actionableTextBytes);

  const omissions: OmissionRecord = {
    hiddenNodes: raw.hiddenNodes,
    // Count-cap drops; byte-budget drops adjust this below. A hit hard
    // ceiling always implies count-cap drops (ceiling >> cap), so no
    // separate counter is needed.
    overBudgetElements: overBudget,
    textTruncated: textCut.truncated,
  };

  // Byte budget (form-fields.ts FR-011 precedent): drop tail entries while
  // the serialised payload exceeds the max; document order is preserved.
  const url = wc.getURL();
  const measure = (list: ActionableElement[]) =>
    Buffer.byteLength(
      JSON.stringify({
        tabId,
        url,
        title: raw.title,
        elements: list,
        text: textCut.value,
        queueDepth,
      }),
      "utf8",
    );
  if (kept.length > 0 && measure(kept) > config.actionableMaxBytes) {
    while (kept.length > 0 && measure(kept) > config.actionableMaxBytes) {
      kept = kept.slice(0, -1);
      privates = privates.slice(0, -1);
    }
    overBudget = elements.length - kept.length;
    omissions.overBudgetElements = overBudget;
  }

  // Renumber after trimming so indices stay dense 1..N.
  const renumbered = kept.map((e, i) => ({ ...e, index: i + 1 }));
  const generation = generationFor(url, raw.observedAt, raw.records, raw.text);

  storeSnapshotEntry(generation, {
    url,
    selectors: privates.map((p) => p.selector),
    descriptors: raw.records.slice(0, kept.length).map((r) => r.descriptor),
    roles: raw.records.slice(0, kept.length).map((r) => r.role),
    labels: raw.records.slice(0, kept.length).map((r) => r.label),
  });

  return {
    tabId,
    url,
    title: raw.title,
    generation,
    observedAt: raw.observedAt,
    elements: renumbered,
    text: { text: textCut.value, truncated: textCut.truncated },
    ranking: null,
    rankingStatus: null,
    omissions,
    queueDepth,
  };
}
