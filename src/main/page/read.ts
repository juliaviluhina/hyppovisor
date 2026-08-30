// Verbatim page reading (FR-010, FR-010a, FR-010b, FR-019, FR-021, research.md R3).
//
// Returns raw content only — no parsing, scoring, or extraction (Principle II).
// Nothing is persisted; the returned payload is the only copy (Principle V).

import type { WebContents } from "electron";
import { config } from "../config.js";
import { truncateToBytes } from "./truncate.js";
import type { PageReadResult } from "../../shared/types.js";

// Runs in an isolated world. innerText approximates "what the person sees":
// it respects visibility and layout, unlike textContent.
const READ_SCRIPT = `(() => ({
  url: location.href,
  title: document.title,
  text: document.body ? document.body.innerText : "",
  dom: document.documentElement ? document.documentElement.outerHTML : "",
}))()`;

interface RawRead {
  url: string;
  title: string;
  text: string;
  dom: string;
}

export async function readPage(
  wc: WebContents,
  tabId: string,
  includeDom: boolean,
  queueDepth: number,
): Promise<PageReadResult> {
  const raw = (await wc.executeJavaScript(READ_SCRIPT, true)) as RawRead;

  const text = truncateToBytes(raw.text ?? "", config.maxTextBytes);
  const result: PageReadResult = {
    tabId,
    url: raw.url,
    title: raw.title,
    text: text.value,
    observedAt: new Date().toISOString(),
    truncated: { text: text.truncated, dom: false },
    queueDepth,
  };

  if (includeDom) {
    const dom = truncateToBytes(raw.dom ?? "", config.maxDomBytes);
    result.dom = dom.value;
    result.truncated.dom = dom.truncated;
  }

  return result;
}
