// External-act blocklist (FR-012, FR-012a, FR-018, research.md R4).
//
// Permit-by-default: an interaction is allowed unless its target matches a rule
// here. Matching runs against a plain descriptor extracted from the element
// in-page (see targetDescriptorScript), so the rules themselves stay pure and
// individually unit-testable.

import type { InteractOperation } from "../../shared/types.js";

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
  appliesTo: "click" | "fill" | "both";
  matches: (d: TargetDescriptor, op: InteractOperation) => boolean;
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
    appliesTo: "click",
    matches: (d) =>
      (d.tagName === "button" && (d.type === null || d.type === "submit")) ||
      (d.tagName === "input" && (d.type === "submit" || d.type === "image")) ||
      ((d.role === "button" || d.tagName === "button" || d.tagName === "a") &&
        hasExternalActWord(d.name)),
  },
  {
    id: "in-form",
    description: "Target is inside a <form> element; interacting risks a submission.",
    appliesTo: "both",
    matches: (d) => d.hasFormAncestor,
  },
  {
    // Ordered before external-act-label so a consent checkbox gets this precise
    // rule id in the audit log rather than the generic wording match.
    id: "consent-toggle",
    description:
      "Target is a checkbox / radio / switch whose label reads as consent (accept terms, " +
      "agree, subscribe, opt in …).",
    appliesTo: "click",
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
    appliesTo: "fill",
    matches: (d) =>
      d.type === "password" ||
      d.autocomplete === "current-password" ||
      d.autocomplete === "new-password" ||
      d.autocomplete === "one-time-code",
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
    if (rule.appliesTo !== "both" && rule.appliesTo !== op) continue;
    if (rule.matches(d, op)) {
      return { blocked: true, ruleId: rule.id, description: rule.description };
    }
  }
  return { blocked: false };
}

/** Full rule set, for audit and test coverage (FR-012a: enumerable). */
export function listBlocklistRules(): Array<
  Pick<BlocklistRule, "id" | "description" | "appliesTo">
> {
  return BLOCKLIST_RULES.map(({ id, description, appliesTo }) => ({ id, description, appliesTo }));
}

/**
 * JS expression evaluated in-page: given a CSS `selector`, returns a
 * TargetDescriptor or null when nothing matches. Injected by interact.ts.
 *
 * `name` combines every accessible-name source so a bare checkbox picks up its
 * associated <label> text (which lives outside the element itself).
 */
export function targetDescriptorScript(selector: string): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const parts = [];
    parts.push(el.innerText || "");
    parts.push(el.value || "");
    parts.push(el.getAttribute("aria-label") || "");
    parts.push(el.getAttribute("title") || "");
    parts.push(el.getAttribute("placeholder") || "");
    if (el.id) {
      const forLabel = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (forLabel) parts.push(forLabel.innerText || forLabel.textContent || "");
    }
    const wrapLabel = el.closest("label");
    if (wrapLabel) parts.push(wrapLabel.innerText || wrapLabel.textContent || "");
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      for (const lid of labelledby.split(/\\s+/)) {
        const n = document.getElementById(lid);
        if (n) parts.push(n.innerText || n.textContent || "");
      }
    }
    if (!parts.join("").trim()) parts.push(el.textContent || "");
    return {
      tagName: el.tagName.toLowerCase(),
      type: el.getAttribute("type") ? el.getAttribute("type").toLowerCase() : null,
      role: el.getAttribute("role") ? el.getAttribute("role").toLowerCase() : null,
      hasFormAncestor: !!el.closest("form"),
      name: parts.join(" ").replace(/\\s+/g, " ").trim().toLowerCase(),
      autocomplete: el.getAttribute("autocomplete") ? el.getAttribute("autocomplete").toLowerCase() : null,
      isContentEditable: el.isContentEditable === true,
    };
  })()`;
}
