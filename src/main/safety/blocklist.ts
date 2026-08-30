// External-act blocklist (FR-012, FR-012a, FR-018, research.md R4).
//
// Permit-by-default: an interaction is allowed unless its target matches a rule
// here. Matching runs against a plain descriptor extracted from the element
// in-page (see targetDescriptorScript), so the rules themselves stay pure and
// individually unit-testable.

import type { FieldVerdict, InteractOperation } from "../../shared/types.js";

export interface TargetDescriptor {
  tagName: string; // lowercase, e.g. "button"
  type: string | null; // input/button type attribute, lowercased
  role: string | null;
  hasFormAncestor: boolean;
  /** Best-effort accessible name: visible text, value, aria-label, <label>, title — lowercased. */
  name: string;
  autocomplete: string | null; // lowercased
  isContentEditable: boolean;
}

export interface BlocklistRule {
  id: string;
  description: string;
  /**
   * Which operations a rule is evaluated for:
   * - `"click"` / `"fill"` / `"space"` — that operation only
   * - `"activation"` — a `click`, a `space`, or a `choose_option` (anything that
   *   activates a control)
   * - `"fill-or-space"` — a `fill`, a `space`, or a `choose_option` (anything that
   *   commits a value into a control)
   * - `"both"` — every descriptor-bearing operation (`scroll` never reaches here)
   */
  appliesTo: "click" | "fill" | "space" | "activation" | "fill-or-space" | "both";
  matches: (d: TargetDescriptor, op: InteractOperation) => boolean;
}

/** Whether a rule's `appliesTo` covers the operation being evaluated. Exported for tests. */
export function ruleCovers(
  appliesTo: BlocklistRule["appliesTo"],
  op: InteractOperation,
): boolean {
  switch (appliesTo) {
    case "both":
      return true;
    case "activation":
      return op === "click" || op === "space" || op === "choose_option";
    case "fill-or-space":
      return op === "fill" || op === "space" || op === "choose_option";
    default:
      return appliesTo === op;
  }
}

/**
 * Visible-text / label patterns that signal an outward action (FR-012a).
 * Ordered roughly by category: submit-ish, auth, destructive, consent, commerce.
 */
const EXTERNAL_ACT_WORDS = [
  "apply",
  "submit",
  "send",
  "connect",
  "message",
  "post",
  "publish",
  "save",
  "confirm",
  "continue",
  "sign up",
  "signup",
  "sign in",
  "signin",
  "log in",
  "login",
  "log out",
  "logout",
  "register",
  "delete",
  "remove",
  "discard",
  "accept",
  "agree",
  "i consent",
  "opt in",
  "subscribe",
  "unsubscribe",
  "join",
  "checkout",
  "check out",
  "pay",
  "buy",
  "order",
  "purchase",
  "download",
  "upload",
];

function hasExternalActWord(s: string): boolean {
  return EXTERNAL_ACT_WORDS.some((w) => s.includes(w));
}

/** Consent-ish wording, checked for toggles (checkbox / radio / switch). */
const CONSENT_WORDS = [
  "accept",
  "agree",
  "consent",
  "terms",
  "privacy",
  "policy",
  "conditions",
  "subscribe",
  "opt in",
  "opt-in",
  "i confirm",
  "i understand",
];

export const BLOCKLIST_RULES: readonly BlocklistRule[] = [
  {
    id: "submit-control",
    description: "Target is a form submit control (Save / Submit / Confirm / Delete / Sign in …).",
    appliesTo: "activation",
    matches: (d) =>
      (d.tagName === "button" && (d.type === null || d.type === "submit")) ||
      (d.tagName === "input" && (d.type === "submit" || d.type === "image")) ||
      ((d.role === "button" || d.tagName === "button" || d.tagName === "a") &&
        hasExternalActWord(d.name)),
  },
  {
    // Ordered before in-form so a consent toggle inside a form still gets this
    // precise rule id in the audit log rather than the generic in-form match.
    id: "consent-toggle",
    description:
      "Target is a checkbox / radio / switch whose label reads as consent (accept terms, " +
      "agree, subscribe, opt in …).",
    appliesTo: "activation",
    matches: (d) => {
      const isToggle =
        (d.tagName === "input" && (d.type === "checkbox" || d.type === "radio")) ||
        d.role === "checkbox" ||
        d.role === "switch" ||
        d.role === "radio";
      return isToggle && CONSENT_WORDS.some((w) => d.name.includes(w));
    },
  },
  {
    id: "external-act-label",
    description:
      "Target's name reads as an outward action (apply / submit / save / confirm / delete / " +
      "sign in / sign up / accept / pay / …).",
    appliesTo: "both",
    matches: (d) => hasExternalActWord(d.name),
  },
  {
    id: "credential-field",
    description: "Target is a credential input; the app never fills credentials.",
    appliesTo: "fill-or-space",
    matches: (d) =>
      d.type === "password" ||
      d.autocomplete === "current-password" ||
      d.autocomplete === "new-password" ||
      d.autocomplete === "one-time-code",
  },
  {
    // Broad catch-all for clicks inside a form — ordered last so the specific
    // rules above (submit / consent / wording / credential) claim their precise
    // id first. `fill` is intentionally not gated: entering a value is permitted
    // preparation, not an external act (constitution Principle I, amended). Space
    // is not gated here either — it cannot trigger an implicit submit, and the
    // activation rules above already refuse a real submit control in the form.
    id: "in-form",
    description:
      "Target is a clickable control inside a <form> element; clicking it risks a submission.",
    appliesTo: "click",
    matches: (d) => d.hasFormAncestor,
  },
];

export interface BlocklistVerdict {
  blocked: boolean;
  ruleId?: string;
  description?: string;
}

/** Pure evaluation of a target descriptor against every rule (first match wins). */
export function matchBlocklist(d: TargetDescriptor, op: InteractOperation): BlocklistVerdict {
  for (const rule of BLOCKLIST_RULES) {
    if (!ruleCovers(rule.appliesTo, op)) continue;
    if (rule.matches(d, op)) {
      return { blocked: true, ruleId: rule.id, description: rule.description };
    }
  }
  return { blocked: false };
}

/**
 * Safe fill-value targets (constitution Principle I, amended: entering a value
 * is preparation, not an external act). Consulted by interact.ts *after* the
 * blocklist rules, so a dangerous field keeps its own rule id.
 */
export const SAFE_FILL_TYPES = ["text", "email", "tel", "url", "search", "number"] as const;
const SAFE_FILL_ELEMENT_KINDS = ["textarea", "contenteditable"] as const;

/** Enumerable view of the safe-fill allowlist, like listBlocklistRules(). */
export function listSafeFillTypes(): {
  types: readonly string[];
  elementKinds: readonly string[];
} {
  return { types: SAFE_FILL_TYPES, elementKinds: SAFE_FILL_ELEMENT_KINDS };
}

/**
 * Whether `fill` may set a value on this target. A react-select-style combobox's
 * typed-text input (an <input>/contenteditable carrying role="combobox"/"textbox")
 * is allowed for *filtering only* — interact.ts never selects an option. The
 * combobox container (a <div> with the role), a <select>, a listbox, and file
 * inputs are refused.
 */
export function isSafeFillTarget(d: TargetDescriptor): { ok: boolean; reason?: string } {
  if (d.tagName === "textarea") return { ok: true };
  if (d.isContentEditable) return { ok: true };
  if ((d.role === "combobox" || d.role === "textbox") && d.tagName === "input") {
    return { ok: true };
  }
  if (d.tagName === "select") return { ok: false, reason: "a <select> element" };
  if (d.role === "listbox") return { ok: false, reason: "a listbox" };
  if (d.role === "combobox" || d.role === "textbox") {
    return { ok: false, reason: `a combobox container (<${d.tagName}>), not its text input` };
  }
  if (d.tagName === "input") {
    const t = d.type ?? "text";
    if (t === "file") return { ok: false, reason: 'an <input type="file">' };
    if ((SAFE_FILL_TYPES as readonly string[]).includes(t)) return { ok: true };
    return { ok: false, reason: `an <input type="${t}"> (not a safe value field)` };
  }
  return { ok: false, reason: `a <${d.tagName}> (not a value field)` };
}

/** Full rule set, for audit and test coverage (FR-012a: enumerable). */
export function listBlocklistRules(): Array<
  Pick<BlocklistRule, "id" | "description" | "appliesTo">
> {
  return BLOCKLIST_RULES.map(({ id, description, appliesTo }) => ({ id, description, appliesTo }));
}

/**
 * The verdict `interact`'s `fill` path produces for a target (feature 005, R8).
 * Replays the exact two-step check: blocklist(`fill`) then the safe-fill-type
 * allowlist. Pure — the reader (`read_form_fields`) and `interact` compute from
 * this one function so their verdicts cannot diverge (SC-004).
 */
export function fillVerdictFor(d: TargetDescriptor): FieldVerdict {
  const blocked = matchBlocklist(d, "fill");
  if (blocked.blocked) {
    return { verdict: "refused", ruleId: blocked.ruleId, ruleDescription: blocked.description };
  }
  const safe = isSafeFillTarget(d);
  if (!safe.ok) {
    return {
      verdict: "refused",
      ruleId: "unsafe-fill-type",
      ruleDescription: `Not a safe value field: ${safe.reason}.`,
    };
  }
  return { verdict: "permitted" };
}

/** The verdict `interact`'s `click` path produces for a target (feature 005, R8). Pure. */
export function clickVerdictFor(d: TargetDescriptor): FieldVerdict {
  const blocked = matchBlocklist(d, "click");
  if (blocked.blocked) {
    return { verdict: "refused", ruleId: blocked.ruleId, ruleDescription: blocked.description };
  }
  return { verdict: "permitted" };
}

/**
 * Shared in-page snippet: given a bound `el`, declare the raw accessible-name
 * source strings as locals (`__forLabelText`, `__wrapLabelText`, `__ariaLabelText`,
 * `__ariaLabelledbyText`, `__placeholderText`, `__titleText`) — case preserved,
 * not joined. Two consumers: `DESCRIPTOR_BODY` joins + lowercases them for the
 * safety `name`; the feature-005 reader picks the first non-empty as a *verbatim*
 * label. One source list keeps the two from diverging (FR-004 / FR-011, R8).
 */
export const ACCESSIBLE_NAME_SOURCES_BODY = `
    const __forLabelText = (() => {
      if (!el.id) return "";
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      return l ? (l.innerText || l.textContent || "") : "";
    })();
    const __wrapLabelText = (() => {
      const l = el.closest("label");
      return l ? (l.innerText || l.textContent || "") : "";
    })();
    const __ariaLabelText = el.getAttribute("aria-label") || "";
    const __ariaLabelledbyText = (() => {
      const ids = el.getAttribute("aria-labelledby");
      if (!ids) return "";
      const out = [];
      for (const lid of ids.split(/\\s+/)) {
        const n = document.getElementById(lid);
        if (n) out.push(n.innerText || n.textContent || "");
      }
      return out.join(" ");
    })();
    const __placeholderText = el.getAttribute("placeholder") || "";
    const __titleText = el.getAttribute("title") || "";`;

/**
 * Shared in-page body: given a bound `el`, assemble a TargetDescriptor.
 * `name` combines every accessible-name source so a bare checkbox picks up its
 * associated <label> text (which lives outside the element itself).
 */
export const DESCRIPTOR_BODY = `
    ${ACCESSIBLE_NAME_SOURCES_BODY}
    const parts = [
      el.innerText || "",
      el.value || "",
      __ariaLabelText,
      __titleText,
      __placeholderText,
      __forLabelText,
      __wrapLabelText,
      __ariaLabelledbyText,
    ];
    if (!parts.join("").trim()) parts.push(el.textContent || "");
    return {
      tagName: el.tagName.toLowerCase(),
      type: el.getAttribute("type") ? el.getAttribute("type").toLowerCase() : null,
      role: el.getAttribute("role") ? el.getAttribute("role").toLowerCase() : null,
      hasFormAncestor: !!el.closest("form"),
      name: parts.join(" ").replace(/\\s+/g, " ").trim().toLowerCase(),
      autocomplete: el.getAttribute("autocomplete") ? el.getAttribute("autocomplete").toLowerCase() : null,
      isContentEditable: el.isContentEditable === true,
    };`;

/**
 * JS expression evaluated in-page: given a CSS `selector`, returns a
 * TargetDescriptor or null when nothing matches. Injected by interact.ts.
 */
export function targetDescriptorScript(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    ${DESCRIPTOR_BODY}
  })()`;
}

/**
 * JS expression evaluated in-page for the `space` operation: describe
 * `document.activeElement`, or return null when nothing meaningful is focused
 * (no element, or focus rests on <body> / <html>).
 */
export function activeElementDescriptorScript(): string {
  return `(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    ${DESCRIPTOR_BODY}
  })()`;
}
