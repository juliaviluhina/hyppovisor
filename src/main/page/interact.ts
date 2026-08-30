// Bounded interaction: click / fill / scroll / wait_for_selector (FR-012, FR-018).
//
// Every attempt — permitted, refused, or errored — produces exactly one
// interaction-log entry (FR-024a, FR-012b). No operation can submit, send, or
// apply; refusals reference a named blocklist rule (FR-012a).

import type { WebContents } from "electron";
import { config } from "../config.js";
import { HyppoError } from "../errors.js";
import { InteractionLog } from "../safety/interaction-log.js";
import {
  matchBlocklist,
  targetDescriptorScript,
  type TargetDescriptor,
} from "../safety/blocklist.js";
import type { InteractOperation } from "../../shared/types.js";

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

export async function interact(
  wc: WebContents,
  log: InteractionLog,
  tabId: string,
  operation: InteractOperation,
  selector: string | undefined,
  value: string | undefined,
): Promise<void> {
  const url = wc.getURL();
  const target = selector ?? null;

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

    if (!selector) {
      throw new HyppoError("TARGET_NOT_FOUND", `Operation "${operation}" requires a selector.`);
    }

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
      throw new HyppoError(
        "REFUSED_EXTERNAL_ACT",
        `Refused ${operation} on ${selector}: ${verdict.description} ` +
          `The app never performs an external act (constitution Principle I).`,
        { ruleId: verdict.ruleId, ruleDescription: verdict.description },
      );
    }

    if (operation === "click") {
      await wc.executeJavaScript(
        `document.querySelector(${JSON.stringify(selector)}).click()`,
        true,
      );
    } else {
      // fill
      await wc.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)});
          el.focus();
          el.value = ${JSON.stringify(value ?? "")};
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true })); })()`,
        true,
      );
    }

    log.record({ tabId, url, operation, target, outcome: "permitted", ruleId: null, error: null });
  } catch (e) {
    if (e instanceof HyppoError && e.code === "REFUSED_EXTERNAL_ACT") throw e; // already logged
    const message = e instanceof Error ? e.message : String(e);
    log.record({ tabId, url, operation, target, outcome: "error", ruleId: null, error: message });
    throw e instanceof HyppoError
      ? e
      : new HyppoError("TARGET_NOT_FOUND", `Interaction failed on ${selector}: ${message}`);
  }
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
