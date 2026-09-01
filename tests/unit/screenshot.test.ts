// Feature 008 US4 (T028) — the pure scale/compress loop. End-to-end capture
// (viewport / element clip / fullPage, no-file / no-audit) is in
// tests/integration/screenshot.spec.ts.

import { describe, it, expect } from "vitest";
import type { WebContents } from "electron";
import {
  fitImage,
  qualitySteps,
  takeScreenshot,
  type EncodableImage,
} from "../../src/main/page/screenshot.js";
import { HyppoError } from "../../src/main/errors.js";

interface StubOpts {
  /** encoded JPEG byte length for a given quality + width */
  jpeg: (q: number, w: number) => number;
  /** encoded PNG byte length for a given width */
  png: (w: number) => number;
}

class StubImage implements EncodableImage {
  constructor(
    readonly w: number,
    readonly h: number,
    private readonly opts: StubOpts,
    readonly jpegCalls: number[] = [],
    readonly resizeCalls: Array<{ width: number; height: number }> = [],
  ) {}
  getSize() {
    return { width: this.w, height: this.h };
  }
  toJPEG(q: number): Buffer {
    this.jpegCalls.push(q);
    return Buffer.alloc(this.opts.jpeg(q, this.w));
  }
  toPNG(): Buffer {
    return Buffer.alloc(this.opts.png(this.w));
  }
  resize({ width, height }: { width: number; height: number }): EncodableImage {
    this.resizeCalls.push({ width, height });
    return new StubImage(width, height, this.opts, this.jpegCalls, this.resizeCalls);
  }
}

const JPEG = { format: "jpeg" as const, qualityStart: 80, qualityFloor: 30 };
const PNG = { format: "png" as const, qualityStart: 80, qualityFloor: 30 };

describe("qualitySteps", () => {
  it("descends in ~15-point steps and always ends at the floor", () => {
    expect(qualitySteps(80, 30)).toEqual([80, 65, 50, 35, 30]);
    expect(qualitySteps(80, 80)).toEqual([80]);
    expect(qualitySteps(60, 30)).toEqual([60, 45, 30]);
  });
});

describe("fitImage", () => {
  it("returns scale 1 / limitNotMet false when the natural image already fits", () => {
    const img = new StubImage(1000, 800, { jpeg: () => 10_000, png: () => 999 });
    const r = fitImage(img, { ...JPEG, maxBytes: 50_000 });
    expect(r.scale).toBe(1);
    expect(r.limitNotMet).toBe(false);
    expect(r.width).toBe(1000);
    expect(img.resizeCalls.length).toBe(0);
    // stopped at the first quality that fit
    expect(img.jpegCalls).toEqual([80]);
  });

  it("walks JPEG quality down to the floor, then downscales by 0.8", () => {
    // quality never helps (constant bytes); only downscaling reduces size
    const img = new StubImage(1000, 500, { jpeg: (_q, w) => w * 80, png: () => 0 });
    const r = fitImage(img, { ...JPEG, maxBytes: 50_000 });
    // first pass swept the full ladder before any resize
    expect(img.jpegCalls.slice(0, 5)).toEqual([80, 65, 50, 35, 30]);
    // then downscaled by 0.8: 1000 -> 800 -> 640 -> 512 (51200/512*80=40960 ≤ 50000)
    expect(img.resizeCalls[0]).toEqual({ width: 800, height: 400 });
    expect(r.width).toBe(512);
    expect(r.scale).toBe(0.512);
    expect(r.limitNotMet).toBe(false);
  });

  it("is bounded to ≤ 6 encode iterations (≤ 5 downscales) and reports limitNotMet", () => {
    const img = new StubImage(1000, 1000, { jpeg: () => 9_999_999, png: () => 0 });
    const r = fitImage(img, { ...JPEG, maxBytes: 1000 });
    expect(img.resizeCalls.length).toBeLessThanOrEqual(5);
    expect(r.limitNotMet).toBe(true);
    expect(r.scale).toBeLessThan(1);
    // smallest image is still returned
    expect(r.bytes.length).toBeGreaterThan(1000);
  });

  it("the PNG path only downscales — no quality steps", () => {
    const img = new StubImage(1000, 1000, { jpeg: () => 0, png: (w) => w * 100 });
    const r = fitImage(img, { ...PNG, maxBytes: 50_000 });
    expect(img.jpegCalls.length).toBe(0);
    // 1000->800->640->512->410 (41000 ≤ 50000)
    expect(img.resizeCalls.map((c) => c.width)).toEqual([800, 640, 512, 410]);
    expect(r.width).toBe(410);
    expect(r.limitNotMet).toBe(false);
  });
});

describe("takeScreenshot — no rendered surface (feature 013 --background)", () => {
  const wcThatFails = (message: string) =>
    ({
      capturePage: () => Promise.reject(new Error(message)),
    }) as unknown as WebContents;

  it("maps Chromium's 'display surface not available' to a clear SCREENSHOT_FAILED", async () => {
    const wc = wcThatFails("Current display surface not available for capture");
    await expect(takeScreenshot(wc, { tabId: "tab-1" })).rejects.toMatchObject({
      code: "SCREENSHOT_FAILED",
    });
    await expect(takeScreenshot(wc, { tabId: "tab-1" })).rejects.toThrow(/--background/);
  });

  it("passes an unrelated capturePage failure through unchanged", async () => {
    const wc = wcThatFails("some other GPU error");
    await expect(takeScreenshot(wc, { tabId: "tab-1" })).rejects.not.toBeInstanceOf(HyppoError);
  });
});
