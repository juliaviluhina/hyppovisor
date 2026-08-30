// The `screenshot` MCP tool (feature 008, US4).
//
// A local frame capture — the viewport, an element's on-screen box, or the full
// scroll height — returned as an MCP image content block plus a small metadata
// block. It touches no site control and sends nothing (Principle I). Nothing is
// written to disk and no interaction-audit entry is made (FR-025), matching
// `read_page`. Every size reduction is reported (`scale`, `limitNotMet`) so a
// scaled shot is never mistaken for a native one (Principle V).
//
// Mechanisms: `WebContents.capturePage()` for the viewport and (with a rect) an
// element clip; the CDP `Page.captureScreenshot({ captureBeyondViewport: true })`
// via `WebContents.debugger` only for `fullPage` (see plan Complexity Tracking —
// Electron exposes no other beyond-viewport capture). The attach/detach is
// per-call and the action queue guarantees a single debugger client.

import { nativeImage, type WebContents, type NativeImage } from "electron";
import { config } from "../config.js";
import { HyppoError } from "../errors.js";
import { SELECTOR_SYNTAX_HELPER, assertSelectorValid } from "./selector-syntax.js";
import type { ScreenshotResult } from "../../shared/types.js";

export interface ScreenshotOpts {
  tabId: string;
  selector?: string;
  fullPage?: boolean;
  format?: "jpeg" | "png";
  maxBytes?: number;
}

/** Minimal surface the fit loop needs — `NativeImage` satisfies it; the unit test stubs it. */
export interface EncodableImage {
  getSize(): { width: number; height: number };
  toJPEG(quality: number): Buffer;
  toPNG(): Buffer;
  resize(options: { width: number; height: number }): EncodableImage;
}

export interface FitResult {
  bytes: Buffer;
  width: number;
  height: number;
  /** returned width ÷ natural width; `1` when not downscaled. */
  scale: number;
  /** still over `maxBytes` after the last iteration — the smallest image is returned anyway. */
  limitNotMet: boolean;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** JPEG quality ladder: from `start` down in ~15-point steps, always ending at `floor`. */
export function qualitySteps(start: number, floor: number): number[] {
  const steps: number[] = [];
  for (let q = start; q > floor; q -= 15) steps.push(q);
  steps.push(floor);
  return steps;
}

/**
 * Scale + compress `image` until its encoded bytes fit `maxBytes`, or the loop is
 * exhausted (research.md R10). JPEG: sweep quality `start → floor`; if still over,
 * downscale by 0.8 and retry. PNG: downscale only. Bounded to **≤ 6** encode
 * iterations (≤ 5 downscales). Pure — no Electron dependency, so the unit test
 * drives it with a stubbed encoder.
 */
export function fitImage(
  image: EncodableImage,
  opts: { format: "jpeg" | "png"; maxBytes: number; qualityStart: number; qualityFloor: number },
): FitResult {
  const MAX_ITERS = 6;
  const natural = image.getSize();
  let img = image;

  const encodeBest = (im: EncodableImage): Buffer => {
    if (opts.format === "png") return im.toPNG();
    let last: Buffer | undefined;
    for (const q of qualitySteps(opts.qualityStart, opts.qualityFloor)) {
      last = im.toJPEG(q);
      if (last.length <= opts.maxBytes) return last;
    }
    return last as Buffer; // floor-quality bytes (qualitySteps is never empty)
  };

  for (let i = 0; i < MAX_ITERS; i++) {
    const bytes = encodeBest(img);
    const { width, height } = img.getSize();
    const scale = round4(natural.width === 0 ? 1 : width / natural.width);
    if (bytes.length <= opts.maxBytes) {
      return { bytes, width, height, scale, limitNotMet: false };
    }
    if (i === MAX_ITERS - 1) return { bytes, width, height, scale, limitNotMet: true };
    const nextW = Math.round(width * 0.8);
    const nextH = Math.round(height * 0.8);
    if (nextW < 1 || nextH < 1) return { bytes, width, height, scale, limitNotMet: true };
    img = img.resize({ width: nextW, height: nextH });
  }
  /* c8 ignore next */ throw new Error("unreachable");
}

// ─── element rect probe ──────────────────────────────────────────────────────

interface RectProbe {
  __invalidSelector?: true;
  notFound?: true;
  rect?: { x: number; y: number; width: number; height: number };
  inViewport?: boolean;
}

function rectScript(selector: string): string {
  const SEL = JSON.stringify(selector);
  return `(() => {${SELECTOR_SYNTAX_HELPER}
    try {
      const el = __querySafe(document, ${SEL});
      if (!el) return { notFound: true };
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const inViewport = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
      return { rect: { x: r.left, y: r.top, width: r.width, height: r.height }, inViewport: inViewport };
    } catch (e) {
      if (e && e.__invalidSelector) return { __invalidSelector: true };
      throw e;
    }
  })()`;
}

const NOT_RENDERABLE = "The element resolved but is not renderable (zero-size or fully off-viewport).";

async function captureElement(wc: WebContents, selector: string): Promise<NativeImage> {
  const probe = (await wc.executeJavaScript(rectScript(selector), true)) as RectProbe;
  assertSelectorValid(probe);
  if (probe.notFound || !probe.rect) {
    throw new HyppoError("SCREENSHOT_FAILED", `No element matches selector ${JSON.stringify(selector)}.`);
  }
  const { x, y, width, height } = probe.rect;
  if (width < 1 || height < 1 || !probe.inViewport) {
    throw new HyppoError("SCREENSHOT_FAILED", NOT_RENDERABLE);
  }
  return wc.capturePage({
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.round(width),
    height: Math.round(height),
  });
}

async function captureFullPage(wc: WebContents, format: "jpeg" | "png"): Promise<NativeImage> {
  try {
    wc.debugger.attach("1.3");
  } catch (e) {
    throw new HyppoError("SCREENSHOT_FAILED", "Could not attach the debugger for a full-page capture.", {
      cause: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    await wc.debugger.sendCommand("Page.enable");
    const params: Record<string, unknown> = {
      format: format === "png" ? "png" : "jpeg",
      captureBeyondViewport: true,
      fromSurface: true,
    };
    if (format !== "png") params.quality = config.screenshotJpegQualityStart;
    const res = (await wc.debugger.sendCommand("Page.captureScreenshot", params)) as {
      data: string;
    };
    const img = nativeImage.createFromBuffer(Buffer.from(res.data, "base64"));
    if (img.isEmpty()) throw new Error("captured image was empty");
    return img;
  } catch (e) {
    if (e instanceof HyppoError) throw e;
    throw new HyppoError("SCREENSHOT_FAILED", "The full-page capture pipeline failed.", {
      cause: e instanceof Error ? e.message : String(e),
    });
  } finally {
    try {
      wc.debugger.detach();
    } catch {
      /* already detached / gone */
    }
  }
}

/**
 * Capture one tab. `selector` clips to that element's on-screen box and wins over
 * `fullPage`. Returns the encoded bytes, their mime type, and the metadata block.
 * Throws `HyppoError` (`INVALID_SELECTOR` / `SCREENSHOT_FAILED`); the caller adds
 * `TAB_NOT_FOUND` for an unknown tab.
 */
export async function takeScreenshot(
  wc: WebContents,
  opts: ScreenshotOpts,
): Promise<{ bytes: Buffer; mimeType: string; meta: ScreenshotResult }> {
  const format: "jpeg" | "png" = opts.format === "png" ? "png" : "jpeg";
  // The caller may only *lower* the budget meaningfully (contract) — clamp to the
  // configured default and a small floor.
  const requested = typeof opts.maxBytes === "number" ? opts.maxBytes : config.screenshotMaxBytes;
  const maxBytes = Math.max(1000, Math.min(requested, config.screenshotMaxBytes));

  let image: NativeImage;
  let fullPage = false;
  if (opts.selector) {
    image = await captureElement(wc, opts.selector);
  } else if (opts.fullPage) {
    image = await captureFullPage(wc, format);
    fullPage = true;
  } else {
    image = await wc.capturePage();
  }
  if (image.isEmpty()) {
    throw new HyppoError("SCREENSHOT_FAILED", "The capture produced an empty image.");
  }

  const fit = fitImage(image as unknown as EncodableImage, {
    format,
    maxBytes,
    qualityStart: config.screenshotJpegQualityStart,
    qualityFloor: config.screenshotJpegQualityFloor,
  });

  const meta: ScreenshotResult = {
    tabId: opts.tabId,
    width: fit.width,
    height: fit.height,
    scale: fit.scale,
    format,
    fullPage,
    limitNotMet: fit.limitNotMet,
    ...(opts.selector ? { element: opts.selector } : {}),
  };
  return {
    bytes: fit.bytes,
    mimeType: format === "png" ? "image/png" : "image/jpeg",
    meta,
  };
}
