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
const DOM_REDUCTION_HELPER = `function __reduceDom(root) {
    if (!root) return "";
    const clone = root.cloneNode(true);
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
 * verbatim (FR-002).
 */
export function readPageScript(selector: string | undefined, reduceDom: boolean): string {
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
  | { url: string; title: string; text: string; dom: string }
  | { notFound: true }
  | { __invalidSelector: true };

export async function readPage(
  wc: WebContents,
  tabId: string,
  includeDom: boolean,
  queueDepth: number,
  selector?: string,
  reduceDom = true,
): Promise<PageReadResult> {
  const raw = (await wc.executeJavaScript(
    readPageScript(selector, reduceDom),
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
