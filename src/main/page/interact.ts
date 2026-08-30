// Bounded interaction: click / fill / scroll / space / wait_for_selector
// (FR-012, FR-018; feature 003 adds `space` and permits in-form `fill`).
//
// Every attempt — permitted, refused, or errored — produces exactly one
// interaction-log entry (FR-024a, FR-012b, feature 003 FR-013). No operation can
// submit, send, or apply; refusals reference a named blocklist rule (FR-012a) or
// the `unsafe-fill-type` allowlist check. Entering a value into a plain,
// non-credential, non-consent field is permitted preparation (constitution
// Principle I, amended), not an external act.

import type { WebContents } from "electron";
import { config } from "../config.js";
import { HyppoError } from "../errors.js";
import { InteractionLog } from "../safety/interaction-log.js";
import {
  matchBlocklist,
  isSafeFillTarget,
  targetDescriptorScript,
  activeElementDescriptorScript,
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

/** Short, page-text-free label for the resolved `space` target in the audit log. */
function descriptorSummary(d: TargetDescriptor): string {
  return (
    d.tagName +
    (d.type ? `[type=${d.type}]` : "") +
    (d.role ? `[role=${d.role}]` : "") +
    (d.hasFormAncestor ? " (in form)" : "")
  );
}

// Shared in-page helper: set an <input>/<textarea> value through the *native*
// property setter, not `el.value = …`. React (and every framework that shims the
// value setter to track state) ignores a direct assignment — the field looks set
// in the DOM but the component's state, validation, and re-render never fire, so
// the value silently vanishes on the next render. Going through the prototype's
// own setter and then dispatching `input` is what a real keystroke does.
const NATIVE_VALUE_SETTER = `
  const __setValue = (node, next) => {
    const proto = node.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(node, next);
    else node.value = next;
  };`;

/** In-page: clear the target then set `value`, driving the events one field edit makes. */
function fillScript(selector: string, value: string): string {
  return `(() => {${NATIVE_VALUE_SETTER}
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error("target element is gone");
    const v = ${JSON.stringify(value)};
    el.focus();
    if (el.isContentEditable) {
      el.textContent = "";
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      el.textContent = v;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else {
      __setValue(el, "");
      __setValue(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    // A human leaves a normal field before moving on; blur is what triggers the
    // touched/validation pass on most form libraries, so the value reads as
    // accepted rather than "please complete this field". Skip it for a combobox
    // filter input, where blur would close the option menu the caller is about
    // to act on.
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role !== "combobox" && role !== "textbox") {
      if (typeof el.blur === "function") el.blur();
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }
  })()`;
}

// In-page: activate document.activeElement as Space would. A text field gets a
// single space character (through the native setter, same reason as fillScript);
// any other control is activated exactly as a click (synthetic key events do not
// toggle native controls, so .click() is the activation). Space has no implicit
// form-submit behaviour, unlike Enter.
const SPACE_ACTIVATION_SCRIPT = `(() => {${NATIVE_VALUE_SETTER}
  const el = document.activeElement;
  if (!el) return;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "text").toLowerCase();
  const nonTextInput = ["checkbox","radio","button","submit","reset","file","image","range"];
  const isTextField =
    tag === "textarea" || el.isContentEditable === true ||
    (tag === "input" && nonTextInput.indexOf(type) === -1);
  if (isTextField) {
    if (el.isContentEditable === true) {
      if (document.execCommand) document.execCommand("insertText", false, " ");
      else el.textContent = (el.textContent || "") + " ";
    } else {
      let s, e;
      try { s = el.selectionStart; e = el.selectionEnd; } catch (_) { s = null; e = null; }
      if (s == null) { s = el.value.length; e = el.value.length; }
      __setValue(el, el.value.slice(0, s) + " " + el.value.slice(e));
      try { el.setSelectionRange(s + 1, s + 1); } catch (_) {}
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }));
  if (typeof el.click === "function") el.click();
})()`;

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
  let logged = false;

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

    if (operation === "space") {
      const descriptor = (await wc.executeJavaScript(
        activeElementDescriptorScript(),
        true,
      )) as TargetDescriptor | null;

      if (!descriptor) {
        log.record({
          tabId,
          url,
          operation,
          target: null,
          outcome: "refused",
          ruleId: null,
          error: null,
        });
        logged = true;
        throw new HyppoError(
          "TARGET_NOT_FOUND",
          "Refused space: no element is focused, so there is no target to activate.",
        );
      }

      const summary = descriptorSummary(descriptor);
      const verdict = matchBlocklist(descriptor, "space");
      if (verdict.blocked) {
        log.record({
          tabId,
          url,
          operation,
          target: summary,
          outcome: "refused",
          ruleId: verdict.ruleId ?? null,
          error: null,
        });
        logged = true;
        throw new HyppoError(
          "REFUSED_EXTERNAL_ACT",
          `Refused space on ${summary}: ${verdict.description} ` +
            `The app never performs an external act (constitution Principle I).`,
          { ruleId: verdict.ruleId, ruleDescription: verdict.description },
        );
      }

      await wc.executeJavaScript(SPACE_ACTIVATION_SCRIPT, true);
      log.record({
        tabId,
        url,
        operation,
        target: summary,
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
      logged = true;
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
      // fill — permitted only for a plain value field of a safe type; the
      // blocklist above has already cleared credential / consent / external-act
      // wording, so this is purely the type-allowlist gate (feature 003 FR-003).
      const safe = isSafeFillTarget(descriptor);
      if (!safe.ok) {
        log.record({
          tabId,
          url,
          operation,
          target,
          outcome: "refused",
          ruleId: "unsafe-fill-type",
          error: null,
        });
        logged = true;
        throw new HyppoError(
          "REFUSED_EXTERNAL_ACT",
          `Refused fill on ${selector}: target is ${safe.reason}. ` +
            `The app only types into plain value fields (constitution Principle I).`,
          {
            ruleId: "unsafe-fill-type",
            ruleDescription: `Not a safe value field: ${safe.reason}.`,
          },
        );
      }
      await wc.executeJavaScript(fillScript(selector, value ?? ""), true);
    }

    log.record({ tabId, url, operation, target, outcome: "permitted", ruleId: null, error: null });
  } catch (e) {
    if (logged) throw e; // refusal / no-target paths already wrote their log entry
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
