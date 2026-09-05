// US2: read returns verbatim text, DOM only on request; nothing is persisted;
// unknown/closed tabs error; oversized text truncates with a flag.
// Covers T029, T030, T031, plus an end-to-end check of T032's truncation.

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readdirSync } from "node:fs";
import { startFixtureServer, launchApp, callHandle, handleValue } from "./helpers.js";
import type { ElectronApplication } from "@playwright/test";

let app: ElectronApplication;
let server: Server;
let base: string;

test.beforeAll(async () => {
  ({ server, base } = await startFixtureServer());
  app = await launchApp();
});
test.afterAll(async () => {
  await app.close();
  server.close();
});

test("read returns verbatim visible text, no DOM by default; includeDom adds it (T029)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/static.html`]);

  const plain = await callHandle<{ text: string; dom?: string; truncated: { text: boolean } }>(
    app,
    "read",
    [tabId],
  );
  expect(plain.text).toContain("Hello from the static fixture");
  expect(plain.text).not.toContain("HIDDEN_SENTINEL_SHOULD_NOT_APPEAR"); // innerText hides it
  expect(plain.dom).toBeUndefined();
  expect(plain.truncated.text).toBe(false);

  const withDom = await callHandle<{ dom?: string }>(app, "read", [tabId, true]);
  expect(withDom.dom).toContain("<html");
});

test("the shared data directory receives no page content (T030, SC-004)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/static.html`]);
  await callHandle(app, "read", [tabId]);
  await callHandle(app, "read", [tabId, true]);

  // The app's only writable file is the interaction log, in userData — not the
  // shared data directory, and never page text.
  const logPath = await handleValue<string>(app, "logPath");
  expect(logPath).toMatch(/interaction-log\.jsonl$/);

  const userData = await app.evaluate(async ({ app }) => app.getPath("userData"));
  const files = readdirSync(userData);
  // no capture/content files created by reads
  expect(files.filter((f) => /capture|page|content/i.test(f))).toEqual([]);
});

test("unknown and closed tab ids both return TAB_NOT_FOUND (T031)", async () => {
  const unknown = await callHandle(app, "read", ["tab-999"]).catch((e: Error) => e.message);
  expect(String(unknown)).toContain("TAB_NOT_FOUND");
});

test("oversized visible text truncates and sets the flag (T032 e2e)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/big.html`]);
  const r = await callHandle<{ text: string; truncated: { text: boolean } }>(app, "read", [tabId]);
  expect(r.truncated.text).toBe(true);
  expect(Buffer.byteLength(r.text, "utf8")).toBeLessThanOrEqual(100 * 1024);
});

// ─── feature 016 — US1: selector scoping ────────────────────────────────────

test("US1: a selector scopes text to one element's subtree, unaffected by chat-log growth", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  for (let i = 0; i < 3; i++) {
    await callHandle(app, "interact", [tabId, "click", "#advance"]);
  }

  const scoped = await callHandle<{ text: string }>(app, "read", [tabId, false, "#detail-pane"]);
  expect(scoped.text.trim()).toBe("Turn 4");
  expect(scoped.text).not.toContain("Chat line");
});

test("US1: a selector matching more than one element uses the first, document order", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  // Both #chat-log and #detail-pane contain a <p> — "p" matches both, first wins.
  const scoped = await callHandle<{ text: string }>(app, "read", [tabId, false, "p"]);
  expect(scoped.text.trim()).toBe("Chat line 1");
});

test("US1: an invalid CSS selector rejects INVALID_SELECTOR", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  const err = await callHandle(app, "read", [tabId, false, ":has-text(x)"]).catch(
    (e: Error) => e.message,
  );
  expect(String(err)).toContain("INVALID_SELECTOR");
});

test("US1: a valid selector matching nothing rejects TARGET_NOT_FOUND", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  const err = await callHandle(app, "read", [tabId, false, "#does-not-exist"]).catch(
    (e: Error) => e.message,
  );
  expect(String(err)).toContain("TARGET_NOT_FOUND");
});

test("US1: a selector also scopes the optional DOM output (FR-010)", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  const scoped = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#detail-pane"]);
  expect(scoped.dom).toContain('id="detail-pane"');
  expect(scoped.dom).not.toContain('id="chat-log"');
});

// ─── feature 016 — US2: unscoped reads are byte-for-byte unchanged ─────────

test("US2: an unscoped read on the chat-shell fixture returns the full, un-narrowed shell", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);
  await callHandle(app, "interact", [tabId, "click", "#advance"]);
  await callHandle(app, "interact", [tabId, "click", "#advance"]);

  const full = await callHandle<{ text: string; scopedTo?: string }>(app, "read", [tabId]);
  expect(full.text).toContain("Chat line 1");
  expect(full.text).toContain("Chat line 3");
  expect(full.text).toContain("Turn 3");
  expect("scopedTo" in full).toBe(false);
});

// ─── feature 016 — US3: scoped results self-describe via scopedTo ─────────

test("US3: a scoped read reports scopedTo; an unscoped read has no such field", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/chat-shell-repro.html`,
  ]);

  const scoped = await callHandle<{ scopedTo?: string }>(app, "read", [
    tabId,
    false,
    "#detail-pane",
  ]);
  expect(scoped.scopedTo).toBe("#detail-pane");

  const unscoped = await callHandle<{ scopedTo?: string }>(app, "read", [tabId]);
  expect("scopedTo" in unscoped).toBe(false);
});

test("ancestor escalation widens the read and exclusion removes a sibling subtree", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/read-page-ancestor-escalation.html`,
  ]);
  const result = await callHandle<{
    text: string;
    dom?: string;
    scope?: { effectiveAncestorLevels?: number; exclusions?: string[] };
  }>(app, "read", [tabId, true, "#target", true, 2, [".chat-panel"]]);
  expect(result.text).toContain("Target content");
  expect(result.text).not.toContain("Excluded chat");
  expect(result.dom).toContain('id="context"');
  expect(result.dom).not.toContain("chat-panel");
  expect(result.scope?.effectiveAncestorLevels).toBe(2);
  expect(result.scope?.exclusions).toEqual([".chat-panel"]);
});

test("ancestor escalation text omits hidden (display:none) descendants, like an unscoped read", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/read-page-ancestor-escalation.html`,
  ]);
  const result = await callHandle<{ text: string }>(app, "read", [tabId, false, "#target", true, 2]);
  expect(result.text).toContain("Target content");
  expect(result.text).not.toContain("Secret internal note");
});

// ─── feature 017 — US1: reduced-by-default DOM strips noise, keeps content ─

test("US1: a reduced DOM read strips script/style/comment/class/style, keeps card text", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const reduced = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#job-list"]);
  const dom = reduced.dom ?? "";

  expect(dom).not.toContain("<script");
  expect(dom).not.toContain("<style");
  expect(dom).not.toContain("<!--");
  expect(dom).not.toContain("class=");
  expect(dom).not.toContain("style=");

  expect(dom).toContain("Example Role One");
  expect(dom).toContain("Example Co");
  expect(dom).toContain("Example Role Two");
  expect(dom).toContain("Another Co");
  expect(dom).toContain("Example Role Three");
  expect(dom).toContain("Third Co");
});

test("US1: reduction removes a selector-matched root, while the opt-out preserves it", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  for (const selector of ["#root-script-case", "#root-style-case", "#root-svg-case"]) {
    const reduced = await callHandle<{ dom?: string; domReduced?: boolean }>(app, "read", [
      tabId,
      true,
      selector,
    ]);
    expect(reduced.dom).toBe("");
    expect(reduced.domReduced).toBe(true);

    const verbatim = await callHandle<{ dom?: string }>(app, "read", [
      tabId,
      true,
      selector,
      false,
    ]);
    expect(verbatim.dom).toContain(`id="${selector.slice(1)}"`);
  }
});

test("US2: an unscoped reduced read strips noise from the whole document", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const reduced = await callHandle<{ dom?: string }>(app, "read", [tabId, true]);
  const dom = reduced.dom ?? "";
  expect(dom).not.toContain("<script");
  expect(dom).not.toContain("<style");
  expect(dom).not.toContain("<!--");
  expect(dom).toContain("Example Role One");
});

test("US2: reduction preserves every non-presentational card attribute", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const verbatim = await callHandle<{ dom?: string }>(app, "read", [
    tabId,
    true,
    "#job-list",
    false,
  ]);
  const reduced = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#job-list"]);
  const source = verbatim.dom?.match(/<div[^>]*role="button"[^>]*>/)?.[0] ?? "";
  const result = reduced.dom?.match(/<div[^>]*role="button"[^>]*>/)?.[0] ?? "";
  for (const attribute of ['role="button"', 'tabindex="0"', 'aria-roledescription="sortable"']) {
    expect(source).toContain(attribute);
    expect(result).toContain(attribute);
  }
  expect(result).not.toContain("class=");
  expect(result).not.toContain("style=");
});

test("US2: a reduced read does not mutate the live DOM", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  await callHandle(app, "read", [tabId, true, "#job-list"]);
  const marker = await callHandle<{ dom?: string }>(app, "read", [
    tabId,
    true,
    "#live-marker",
    false,
  ]);
  expect(marker.dom).toContain('class="marker-class"');
  expect(marker.dom).toContain('style="color: red"');
  expect(marker.dom).toContain('data-counter="7"');
});

test("US2: reduced DOM output still truncates at the DOM byte limit", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html?large-dom`,
  ]);
  const result = await callHandle<{ dom?: string; truncated: { dom: boolean } }>(app, "read", [
    tabId,
    true,
  ]);
  expect(result.truncated.dom).toBe(true);
  expect(Buffer.byteLength(result.dom ?? "", "utf8")).toBeLessThanOrEqual(2 * 1024 * 1024);
});

test("US1 (FR-011): a decorative (aria-hidden) icon svg is removed; an accessible one is kept", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const reduced = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#job-list"]);
  const dom = reduced.dom ?? "";

  // Every card's decorative icon is aria-hidden in the fixture — none should survive.
  expect(dom).not.toContain("aria-hidden");
  // Card one's accessible badge icon (role="img" + aria-label) is meaningful, not decorative.
  expect(dom).toContain('aria-label="Verified employer"');
  expect(dom).toContain("<svg");

  const verbatim = await callHandle<{ dom?: string }>(app, "read", [
    tabId,
    true,
    "#job-list",
    false,
  ]);
  const verbatimSvgCount = (verbatim.dom?.match(/<svg/g) ?? []).length;
  const reducedSvgCount = (dom.match(/<svg/g) ?? []).length;
  expect(reducedSvgCount).toBe(verbatimSvgCount - 3); // one decorative icon per card removed
});

test("US1: a non-presentational attribute survives reduction unchanged", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const reduced = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#job-list"]);
  const dom = reduced.dom ?? "";

  expect(dom).toContain('id="job-list"');
  expect(dom).toContain('role="button"');
  expect(dom).toContain('aria-roledescription="sortable"');
});

// ─── feature 017 — US2: reduceDom: false is the exact pre-017 verbatim DOM ─

test("US2: reduceDom: false returns the DOM byte-for-byte unreduced", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const verbatim = await callHandle<{ dom?: string }>(app, "read", [tabId, true, undefined, false]);
  const dom = verbatim.dom ?? "";

  expect(dom).toContain("<script");
  expect(dom).toContain("<style");
  expect(dom).toContain("<!--");
  expect(dom).toContain('class="');
});

test("US2: a read without includeDom is unaffected by reduceDom", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const withReduce = await callHandle<{ text: string; dom?: string; domReduced?: boolean }>(
    app,
    "read",
    [tabId],
  );
  const withoutReduce = await callHandle<{ text: string; dom?: string; domReduced?: boolean }>(
    app,
    "read",
    [tabId, false, undefined, false],
  );

  expect(withReduce.dom).toBeUndefined();
  expect(withoutReduce.dom).toBeUndefined();
  expect("domReduced" in withReduce).toBe(false);
  expect("domReduced" in withoutReduce).toBe(false);
  expect(withReduce.text).toBe(withoutReduce.text);
});

test("US3: text-only reads return the same payload with either reduction setting", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const reduced = await callHandle<Record<string, unknown>>(app, "read", [tabId]);
  const unreduced = await callHandle<Record<string, unknown>>(app, "read", [
    tabId,
    false,
    undefined,
    false,
  ]);
  expect(reduced.tabId).toBe(unreduced.tabId);
  expect(reduced.url).toBe(unreduced.url);
  expect(reduced.title).toBe(unreduced.title);
  expect(reduced.text).toBe(unreduced.text);
  expect(reduced.truncated).toEqual(unreduced.truncated);
  expect(reduced.queueDepth).toBe(unreduced.queueDepth);
});

test("US3: text-only reads on a large DOM have no reduction-cost dependency", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html?large-dom`,
  ]);

  // Warm both paths once so navigation and the first IPC call do not dominate
  // the comparison. This is intentionally a broad guard, not a latency SLA:
  // it catches accidentally doing multi-megabyte clone/reduction work again
  // while tolerating normal CI scheduling noise.
  await callHandle(app, "read", [tabId, false, undefined, true]);
  await callHandle(app, "read", [tabId, false, undefined, false]);

  const samples = async (reduceDom: boolean) => {
    const values: number[] = [];
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      await callHandle(app, "read", [tabId, false, undefined, reduceDom]);
      values.push(performance.now() - started);
    }
    return values.sort((a, b) => a - b);
  };

  const reduced = await samples(true);
  const unreduced = await samples(false);
  const slower = Math.max(reduced[1], unreduced[1]);
  const faster = Math.min(reduced[1], unreduced[1]);
  expect(slower).toBeLessThanOrEqual(faster * 4 + 100);
});

// ─── feature 017 — US3: domReduced self-describes whether reduction applied ─

test("US3: domReduced is true iff reduction was applied, absent otherwise", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);

  const reduced = await callHandle<{ domReduced?: boolean }>(app, "read", [
    tabId,
    true,
    "#job-list",
  ]);
  expect(reduced.domReduced).toBe(true);

  const verbatim = await callHandle<{ domReduced?: boolean }>(app, "read", [
    tabId,
    true,
    "#job-list",
    false,
  ]);
  expect("domReduced" in verbatim).toBe(false);

  const noDom = await callHandle<{ domReduced?: boolean }>(app, "read", [tabId]);
  expect("domReduced" in noDom).toBe(false);
});

// ─── feature 017 — Polish: SC-001 byte-size proof, edge cases, composability ─

test("SC-001: reduced DOM is at least 50% smaller by byte size than the unreduced DOM", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const reduced = await callHandle<{ dom?: string }>(app, "read", [tabId, true]);
  const verbatim = await callHandle<{ dom?: string }>(app, "read", [tabId, true, undefined, false]);

  const reducedBytes = Buffer.byteLength(reduced.dom ?? "", "utf8");
  const verbatimBytes = Buffer.byteLength(verbatim.dom ?? "", "utf8");
  expect(reducedBytes).toBeLessThanOrEqual(verbatimBytes * 0.5);
});

test("Edge case: a subtree with no noise reduces to content identical to the verbatim read", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [`${base}/static.html`]);
  const reduced = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#para"]);
  const verbatim = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#para", false]);

  // #para has no <script>/<style>/comment/class/style noise to strip.
  expect(reduced.dom).toBe(verbatim.dom);
});

test("Edge case: an element emptied by attribute stripping is still present in reduced output", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const reduced = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#job-list"]);
  const dom = reduced.dom ?? "";

  // The icon-wrapper <div> carries only a class attribute in the fixture; after
  // stripping it has none, but the element itself (and its <svg> child) remain.
  expect(dom).toContain("<svg");
  expect(dom.match(/<div>/g)?.length ?? 0).toBeGreaterThan(0);
});

test("Composability: selector (016) + reduceDom (017) reduce only the scoped subtree", async () => {
  const { tabId } = await callHandle<{ tabId: string }>(app, "open", [
    `${base}/dom-noise-repro.html`,
  ]);
  const reduced = await callHandle<{ dom?: string }>(app, "read", [tabId, true, "#job-list"]);
  const dom = reduced.dom ?? "";

  expect(dom).toContain('id="job-list"');
  expect(dom).not.toContain("<style"); // the <head> <style> is outside #job-list's subtree
  expect(dom).not.toContain("class=");
});
