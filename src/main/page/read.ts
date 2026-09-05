// Verbatim page reading (FR-010, FR-010a, FR-010b, FR-019, FR-021, research.md R3).
//
// Returns raw content only — no parsing, scoring, or extraction (Principle II).
// Nothing is persisted; the returned payload is the only copy (Principle V).

import type { WebContents } from "electron";
import { config } from "../config.js";
import { truncateToBytes } from "./truncate.js";
import type { PageReadResult } from "../../shared/types.js";
import { SELECTOR_SYNTAX_HELPER, assertSelectorValid } from "./selector-syntax.js";
import { HyppoError } from "../errors.js";

// Reduction pass (feature 017, research.md R1-R3, R7): removes <script>/<style>
// elements, decorative (aria-hidden) icon <svg> elements, comment nodes, and
// class/style attributes from a *clone* of the resolved subtree, never the
// live page. Only emitted into the script when reduction is requested, so a
// `reduceDom: false` script stays byte-for-byte the pre-017 script (FR-002).
const DOM_REDUCTION_HELPER = `function __reduceDomInPlace(clone) {
    if (!clone) return "";
    if (clone.nodeType === Node.ELEMENT_NODE && clone.matches("script, style, svg[aria-hidden=\\\"true\\\"]")) return "";
    clone.querySelectorAll("script, style").forEach((el) => el.remove());
    clone.querySelectorAll('svg[aria-hidden="true"]').forEach((el) => el.remove());
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach((c) => c.remove());
    [clone, ...clone.querySelectorAll("*")].forEach((el) => {
      el.removeAttribute("class");
      el.removeAttribute("style");
    });
    return clone.outerHTML;
  }
  function __reduceDom(root) {
    return __reduceDomInPlace(root ? root.cloneNode(true) : root);
  }`;

/**
 * Builds the in-page read script (isolated world). innerText approximates
 * "what the person sees": it respects visibility and layout, unlike
 * textContent. With no `selector` this is byte-for-byte the pre-feature-016
 * script (Principle V — unscoped reads stay unchanged, FR-002). With a
 * `selector`, the read starts from that element instead of `document.body` /
 * `document.documentElement` (feature 016) — resolved via the same
 * `selector-syntax.ts` helper `read_form_fields`'s `containerSelector` uses,
 * so invalid CSS and "no match" are detected identically (research.md R1/R2).
 * `reduceDom` (feature 017) additionally strips script/style/comment nodes
 * and `class`/`style` attributes from the returned `dom` via a detached
 * clone (research.md R1/R2); `text` is always computed from the original,
 * unreduced element. `reduceDom: false` reproduces the pre-017 script
 * verbatim (FR-002). With `ancestorLevels` or `exclude` (feature 023), `text`
 * is computed by walking the *live* (still-attached) subtree so visibility —
 * `display`/`visibility` — is judged accurately; a detached clone would
 * report every node as visible regardless of its original styling.
 */
export function readPageScript(
  selector: string | undefined,
  reduceDom: boolean,
  includeDom = true,
  ancestorLevels?: number,
  exclude: string[] = [],
): string {
  const levels = ancestorLevels ?? 0;
  const escalated = selector !== undefined && ancestorLevels !== undefined;
  const excluded = exclude.length > 0;
  if (escalated || excluded) {
    return `(() => {
  ${SELECTOR_SYNTAX_HELPER}
  ${includeDom && reduceDom ? DOM_REDUCTION_HELPER : ""}
  function __visibleText(node, exclusions) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    for (const exclusion of exclusions) {
      if (node.matches(exclusion)) return "";
    }
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return "";
    let text = "";
    for (const child of node.childNodes) text += __visibleText(child, exclusions);
    return style.display === "inline" || style.display === "inline-block" ? text : text + "\\n";
  }
  try {
    const matched = ${selector === undefined ? "document.documentElement" : `__querySafe(document, ${JSON.stringify(selector)})`};
    if (!matched) return { notFound: true };
    let root = matched;
    let effectiveAncestorLevels = 0;
    for (let i = 0; i < ${levels}; i++) {
      if (!root.parentElement) break;
      root = root.parentElement;
      effectiveAncestorLevels++;
    }
    const clone = root.cloneNode(true);
    const exclusions = ${JSON.stringify(exclude)};
    for (const exclusion of exclusions) {
      const matches = __queryAllSafe(clone, exclusion);
      if (root.matches(exclusion)) return { rootExcluded: true };
      matches.forEach((el) => el.remove());
    }
    return {
      url: location.href,
      title: document.title,
      text: __visibleText(root, exclusions) || "",
      ${includeDom ? `dom: ${reduceDom ? "__reduceDomInPlace(clone)" : "clone.outerHTML || \"\""},` : ""}
      scope: {
        selector: ${selector === undefined ? "undefined" : JSON.stringify(selector)},
        requestedAncestorLevels: ${levels},
        effectiveAncestorLevels,
        exclusions,
      },
    };
  } catch (e) {
    if (e && e.__invalidSelector) return { __invalidSelector: true };
    throw e;
  }
})()`;
  }
  if (!includeDom) {
    if (selector === undefined) {
      return `(() => ({
  url: location.href,
  title: document.title,
  text: document.body ? document.body.innerText : "",
}))()`;
    }
    return `(() => {
  ${SELECTOR_SYNTAX_HELPER}
  try {
    const el = __querySafe(document, ${JSON.stringify(selector)});
    if (!el) return { notFound: true };
    return {
      url: location.href,
      title: document.title,
      text: el.innerText || "",
    };
  } catch (e) {
    if (e && e.__invalidSelector) return { __invalidSelector: true };
    throw e;
  }
})()`;
  }
  if (selector === undefined) {
    if (!reduceDom) {
      return `(() => ({
  url: location.href,
  title: document.title,
  text: document.body ? document.body.innerText : "",
  dom: document.documentElement ? document.documentElement.outerHTML : "",
}))()`;
    }
    return `(() => {
  ${DOM_REDUCTION_HELPER}
  return {
    url: location.href,
    title: document.title,
    text: document.body ? document.body.innerText : "",
    dom: __reduceDom(document.documentElement),
  };
})()`;
  }
  if (!reduceDom) {
    return `(() => {
  ${SELECTOR_SYNTAX_HELPER}
  try {
    const el = __querySafe(document, ${JSON.stringify(selector)});
    if (!el) return { notFound: true };
    return {
      url: location.href,
      title: document.title,
      text: el.innerText || "",
      dom: el.outerHTML || "",
    };
  } catch (e) {
    if (e && e.__invalidSelector) return { __invalidSelector: true };
    throw e;
  }
})()`;
  }
  return `(() => {
  ${SELECTOR_SYNTAX_HELPER}
  ${DOM_REDUCTION_HELPER}
  try {
    const el = __querySafe(document, ${JSON.stringify(selector)});
    if (!el) return { notFound: true };
    return {
      url: location.href,
      title: document.title,
      text: el.innerText || "",
      dom: __reduceDom(el),
    };
  } catch (e) {
    if (e && e.__invalidSelector) return { __invalidSelector: true };
    throw e;
  }
})()`;
}

type RawRead =
  | {
      url: string;
      title: string;
      text: string;
      dom?: string;
      scope?: PageReadResult["scope"];
    }
  | { notFound: true }
  | { rootExcluded: true }
  | { __invalidSelector: true };

export async function readPage(
  wc: WebContents,
  tabId: string,
  includeDom: boolean,
  queueDepth: number,
  selector?: string,
  reduceDom = true,
  ancestorLevels?: number,
  exclude: string[] = [],
): Promise<PageReadResult> {
  const levels = ancestorLevels ?? 0;
  if (!Number.isInteger(levels) || levels < 0) {
    throw new HyppoError("TARGET_NOT_FOUND", "ancestorLevels must be a non-negative integer.");
  }
  if (ancestorLevels !== undefined && selector === undefined) {
    throw new HyppoError("TARGET_NOT_FOUND", "ancestorLevels requires selector.");
  }
  const raw = (await wc.executeJavaScript(
    readPageScript(selector, reduceDom, includeDom, ancestorLevels, exclude),
    true,
  )) as RawRead;

  // A non-CSS `selector` → INVALID_SELECTOR (before "not found" is considered,
  // same ordering `read_form_fields` uses).
  assertSelectorValid(raw);
  if ("notFound" in raw) {
    throw new HyppoError(
      "TARGET_NOT_FOUND",
      `No element matches selector ${JSON.stringify(selector)}.`,
    );
  }
  if ("rootExcluded" in raw) {
    throw new HyppoError("TARGET_NOT_FOUND", "An exclusion selector cannot match the read root.");
  }
  const found = raw as Extract<RawRead, { url: string }>;

  const text = truncateToBytes(found.text ?? "", config.maxTextBytes);
  const result: PageReadResult = {
    tabId,
    url: found.url,
    title: found.title,
    text: text.value,
    observedAt: new Date().toISOString(),
    truncated: { text: text.truncated, dom: false },
    queueDepth,
  };

  if (selector !== undefined) {
    result.scopedTo = selector;
  }
  if (found.scope) {
    result.scope = found.scope;
  }

  if (includeDom) {
    const dom = truncateToBytes(found.dom ?? "", config.maxDomBytes);
    result.dom = dom.value;
    result.truncated.dom = dom.truncated;
    if (reduceDom) {
      result.domReduced = true;
    }
  }

  return result;
}
