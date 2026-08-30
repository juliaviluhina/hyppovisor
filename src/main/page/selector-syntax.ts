// One enforcer for the `INVALID_SELECTOR` guarantee (feature 008, FR-018…FR-020,
// research.md R9).
//
// There is no dependency-free standalone CSS-selector parser, so detection is
// in-page: every injected script that resolves a caller-supplied selector runs
// its `document.querySelector(All)` call through the helpers below, which turn a
// `SyntaxError` DOMException — exactly what an invalid selector throws — into a
// tagged sentinel. The script's own outer `try/catch` returns
// `{ __invalidSelector: true }`, and the main-process caller passes that marker
// to `assertSelectorValid`, which raises the one fixed `HyppoError`.
//
// A *valid* selector that simply matches nothing is untouched — the caller still
// gets `TARGET_NOT_FOUND` (FR-020).

import { HyppoError } from "../errors.js";

/** The fixed message (research.md R9). Names the unsupported forms and the fix. */
export const INVALID_SELECTOR_MESSAGE =
  "Invalid CSS selector. Only standard CSS selectors are supported — text-matching " +
  "pseudo-selectors (:has-text(), :text()), and combinators like >> or the " +
  'text= / xpath= prefixes, are not. Call read_form_fields or read_page to get a ' +
  'concrete #id or [name="…"] selector.';

/**
 * In-page helper source. Prepend to any injected script that resolves a
 * caller-supplied selector, then call `__querySafe(root, sel)` /
 * `__queryAllSafe(root, sel)` instead of `root.querySelector(All)`. A bad-syntax
 * selector throws `{ __invalidSelector: true }`; wrap the script body in
 * `try { … } catch (e) { if (e && e.__invalidSelector) return { __invalidSelector: true }; throw e; }`.
 */
export const SELECTOR_SYNTAX_HELPER = `
  function __isBadSelectorError(e) {
    return e instanceof DOMException && e.name === "SyntaxError";
  }
  function __querySafe(root, sel) {
    try { return root.querySelector(sel); }
    catch (e) { if (__isBadSelectorError(e)) throw { __invalidSelector: true }; throw e; }
  }
  function __queryAllSafe(root, sel) {
    try { return root.querySelectorAll(sel); }
    catch (e) { if (__isBadSelectorError(e)) throw { __invalidSelector: true }; throw e; }
  }`;

/** Whether an in-page script's return value is the invalid-selector sentinel. */
export function isInvalidSelectorMarker(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __invalidSelector?: unknown }).__invalidSelector === true
  );
}

/**
 * Throw `INVALID_SELECTOR` when an in-page selector-resolving script reported the
 * sentinel; otherwise a no-op. Call this before interpreting any "not found"
 * result so a non-CSS selector never masquerades as `TARGET_NOT_FOUND`.
 */
export function assertSelectorValid(marker: unknown): void {
  if (isInvalidSelectorMarker(marker)) {
    throw new HyppoError("INVALID_SELECTOR", INVALID_SELECTOR_MESSAGE);
  }
}
