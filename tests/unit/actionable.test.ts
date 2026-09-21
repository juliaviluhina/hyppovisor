// Feature 027 — pure pieces of the actionable snapshot: the generation
// token, element assembly with refused markers, ranking validation, and the
// ranking client's no-throw failure mapping (all with stubbed network — no
// live Jev in automation, research.md R6). The DOM walk itself is exercised
// end to end in tests/integration (see quickstart.md Scenario 1).

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  generationFor,
  assembleElements,
  readActionable,
  actionableScript,
  resolveSnapshotTarget,
  storeSnapshotEntry,
  clearSnapshotRegistry,
  type ActionableRawRecord,
} from "../../src/main/page/actionable.js";
import {
  parseRanking,
  rankRelevance,
} from "../../src/main/ranking/jev.js";
import { config } from "../../src/main/config.js";
import type { TargetDescriptor } from "../../src/main/safety/blocklist.js";
import {
  fillVerdictFor,
  clickVerdictFor,
  chooseVerdictFor,
} from "../../src/main/safety/blocklist.js";

const d = (o: Partial<TargetDescriptor>): TargetDescriptor => ({
  tagName: "input",
  type: "text",
  role: null,
  hasFormAncestor: false,
  formAction: null,
  name: "where to",
  autocomplete: null,
  isContentEditable: false,
  ...o,
});

const rec = (o: Partial<ActionableRawRecord>): ActionableRawRecord => ({
  descriptor: d({}),
  role: "textbox",
  label: "Where to?",
  value: "",
  selectorCounts: {
    id: "to",
    name: null,
    tagName: "input",
    structuralPath: "",
    idCount: 1,
    nameBareCount: 0,
    nameTaggedCount: 0,
    structuralCount: 0,
  },
  ...o,
});

describe("generationFor — snapshot binding token (research.md R2)", () => {  const records = [rec({})];
  it("is deterministic for the same capture", () => {
    expect(generationFor("https://x.test", "2026-09-21T00:00:00.000Z", records, "hi")).toBe(
      generationFor("https://x.test", "2026-09-21T00:00:00.000Z", records, "hi"),
    );
  });
  it("changes when any bound input changes", () => {
    const base = generationFor("https://x.test", "2026-09-21T00:00:00.000Z", records, "hi");
    expect(generationFor("https://y.test", "2026-09-21T00:00:00.000Z", records, "hi")).not.toBe(base);
    expect(
      generationFor("https://x.test", "2026-09-21T00:00:00.000Z", [rec({ label: "Other" })], "hi"),
    ).not.toBe(base);
    expect(generationFor("https://x.test", "2026-09-21T00:00:00.000Z", records, "bye")).not.toBe(
      base,
    );
  });
});

describe("assembleElements — markers agree with interact verdicts (SC-004)", () => {
  it("marks a plain text field actionable with fill", () => {
    const [el] = assembleElements([rec({})]);
    expect(el.index).toBe(1);
    expect(el.marker).toBe("actionable");
    expect(el.operations).toEqual(["fill"]);
    expect(el.value).toBe("");
  });
  it("marks a submit button refused with no operations", () => {
    const [el] = assembleElements([
      rec({
        descriptor: d({ tagName: "button", type: "submit", name: "search flights" }),
        role: "button",
        label: "Search flights",
        value: null,
      }),
    ]);
    expect(el.marker).toBe("refused");
    expect(el.operations).toEqual([]);
  });
  it("omits a credential value entirely and refuses the entry", () => {
    const [el] = assembleElements([
      rec({
        descriptor: d({ type: "password", name: "" }),
        label: "Password",
        value: "s3cret",
      }),
    ]);
    expect(el.marker).toBe("refused");
    expect("value" in el).toBe(false);
  });
  it("marks a plain checkbox actionable with space, a consent one refused", () => {
    const [plain, consent] = assembleElements([
      rec({
        descriptor: d({ type: "checkbox", name: "direct flights only" }),
        role: "checkbox",
        label: "Direct flights only",
        value: "unchecked",
      }),
      rec({
        descriptor: d({ type: "checkbox", name: "i accept the terms and conditions" }),
        role: "checkbox",
        label: "I accept the terms and conditions",
        value: "unchecked",
      }),
    ]);
    expect(plain.marker).toBe("actionable");
    expect(plain.operations).toEqual(["space"]);
    expect(consent.marker).toBe("refused");
    expect(consent.operations).toEqual([]);
  });
  it("marks a plain link actionable with click", () => {
    const [el] = assembleElements([
      rec({
        descriptor: d({ tagName: "a", type: null, name: "today's deals" }),
        role: "link",
        label: "Today's deals",
        value: null,
      }),
    ]);
    expect(el.marker).toBe("actionable");
    expect(el.operations).toContain("click");
  });
  it("numbers indices densely in document order", () => {
    const els = assembleElements([rec({}), rec({}), rec({})]);
    expect(els.map((e) => e.index)).toEqual([1, 2, 3]);
  });
});

describe("parseRanking — jev-ultrafast validate_choice precedent (research.md R3)", () => {
  const offered = [1, 2, 3];
  it("accepts a well-formed answer and sorts most-relevant first", () => {
    const r = parseRanking(
      { choice: "2", probabilities: { "1": 0.2, "2": 0.7, "3": 0.1 }, confidence: 0.8 },
      offered,
    );
    expect(r).not.toBeNull();
    expect(r!.order).toEqual([2, 1, 3]);
    expect(r!.confidence).toBe(0.8);
  });
  it("rejects coverage mismatch, bad sums, non-top picks, and non-finite numbers", () => {
    expect(
      parseRanking({ choice: "1", probabilities: { "1": 1 }, confidence: 1 }, offered),
    ).toBeNull();
    expect(
      parseRanking(
        { choice: "1", probabilities: { "1": 0.5, "2": 0.3, "3": 0.1 }, confidence: 0.5 },
        offered,
      ),
    ).toBeNull();
    expect(
      parseRanking(
        { choice: "1", probabilities: { "1": 0.3, "2": 0.6, "3": 0.1 }, confidence: 0.5 },
        offered,
      ),
    ).toBeNull();
    expect(
      parseRanking(
        { choice: "9", probabilities: { "1": 0.3, "2": 0.6, "3": 0.1 }, confidence: 0.5 },
        [1, 2, 9],
      ),
    ).toBeNull();
    expect(parseRanking(undefined, offered)).toBeNull();
  });
});

describe("rankRelevance — no-throw failure mapping (FR-010)", () => {
  const elements = [
    { index: 1, role: "textbox", label: "Where to?", marker: "actionable" as const, operations: ["fill" as const] },
  ];
  const page = { url: "https://x.test", title: "T", text: "hello" };
  const savedKey = process.env["TYPESAFE_API_KEY"];
  const savedFetch = globalThis.fetch;
  afterEach(() => {
    if (savedKey === undefined) delete process.env["TYPESAFE_API_KEY"];
    else process.env["TYPESAFE_API_KEY"] = savedKey;
    globalThis.fetch = savedFetch;
    vi.unstubAllGlobals();
  });

  it("reports missing-key without attempting a request", async () => {
    delete process.env["TYPESAFE_API_KEY"];
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const out = await rankRelevance(elements, page, "fill the destination");
    expect(out).toEqual({ status: "unavailable-missing-key", ranking: null });
    expect(spy).not.toHaveBeenCalled();
  });
  it("returns ok on a valid response", async () => {
    process.env["TYPESAFE_API_KEY"] = "test-key";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          answers: { ranked: { choice: "1", probabilities: { "1": 1 }, confidence: 0.9 } },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const out = await rankRelevance(elements, page, "fill the destination");
    expect(out.status).toBe("ok");
    expect(out.ranking!.order).toEqual([1]);
  });
  it("retries a 429 then succeeds", async () => {
    process.env["TYPESAFE_API_KEY"] = "test-key";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response("{}", { status: 429 });
      return new Response(
        JSON.stringify({
          answers: { ranked: { choice: "1", probabilities: { "1": 1 }, confidence: 0.9 } },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const out = await rankRelevance(elements, page, "goal");
    expect(out.status).toBe("ok");
    expect(calls).toBe(2);
  });
  it("maps exhausted retries, 401s, malformed bodies, and network throws to request-failure", async () => {
    process.env["TYPESAFE_API_KEY"] = "test-key";
    globalThis.fetch = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    expect((await rankRelevance(elements, page, "goal")).status).toBe(
      "unavailable-request-failure",
    );
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    expect((await rankRelevance(elements, page, "goal")).status).toBe(
      "unavailable-request-failure",
    );
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ answers: {} }), { status: 200 })) as unknown as typeof fetch;
    expect((await rankRelevance(elements, page, "goal")).status).toBe(
      "unavailable-request-failure",
    );
    globalThis.fetch = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect((await rankRelevance(elements, page, "goal")).status).toBe(
      "unavailable-request-failure",
    );
  });
  it("never ranks an empty table", async () => {
    process.env["TYPESAFE_API_KEY"] = "test-key";
    const out = await rankRelevance([], page, "goal");
    expect(out).toEqual({ status: "unavailable-request-failure", ranking: null });
  });
});

describe("readActionable — assembly with a stubbed tab (FR-004)", () => {
  const collectorResult = {
    observedAt: "2026-09-21T00:00:00.000Z",
    url: "https://x.test/search",
    title: "Search",
    text: "Find your next trip.",
    hardCeilingHit: false,
    hiddenNodes: 2,
    records: [
      {
        descriptor: d({}),
        role: "textbox",
        label: "Where to?",
        value: "",
        selectorCounts: {
          id: "to",
          name: null,
          tagName: "input",
          structuralPath: "",
          idCount: 1,
          nameBareCount: 0,
          nameTaggedCount: 0,
          structuralCount: 0,
        },
      },
    ],
  };
  const wc = (records: typeof collectorResult.records, text = collectorResult.text) =>
    ({
      executeJavaScript: async (script: string) => {
        if (typeof script === "string" && script.includes("CANDIDATE_SELECTOR")) {
          return { ...collectorResult, records, text };
        }
        return true;
      },
      getURL: () => "https://x.test/search",
    }) as unknown as import("electron").WebContents;

  it("assembles a snapshot with dense indices and omission counts", async () => {
    const snap = await readActionable(wc(collectorResult.records), "tab-1", 0);
    expect(snap.tabId).toBe("tab-1");
    expect(snap.elements.map((e) => e.index)).toEqual([1]);
    expect(snap.elements[0]!.marker).toBe("actionable");
    expect(snap.text).toEqual({ text: "Find your next trip.", truncated: false });
    expect(snap.ranking).toBeNull();
    expect(snap.rankingStatus).toBeNull();
    expect(snap.omissions.hiddenNodes).toBe(2);
    expect(snap.generation).toMatch(/^[0-9a-f]{64}$/);
  });
  it("applies the element cap and counts over-budget drops", async () => {
    const many = Array.from({ length: config.actionableElementCap + 50 }, (_, i) => ({
      descriptor: d({ name: `field ${i}` }),
      role: "textbox",
      label: `Field ${i}`,
      value: "",
      selectorCounts: {
        id: `f${i}`,
        name: null,
        tagName: "input",
        structuralPath: "",
        idCount: 1,
        nameBareCount: 0,
        nameTaggedCount: 0,
        structuralCount: 0,
      },
    }));
    const snap = await readActionable(wc(many), "tab-1", 0);
    expect(snap.elements.length).toBe(config.actionableElementCap);
    expect(snap.omissions.overBudgetElements).toBe(50);
    expect(snap.elements.map((e) => e.index)).toEqual(
      Array.from({ length: config.actionableElementCap }, (_, i) => i + 1),
    );
  });
  it("truncates over-budget text with an explicit flag", async () => {
    const snap = await readActionable(
      wc(collectorResult.records, "x".repeat(config.actionableTextBytes + 100)),
      "tab-1",
      0,
    );
    expect(snap.text.truncated).toBe(true);
    expect(snap.omissions.textTruncated).toBe(true);
  });
});

describe("markers agree with live verdicts (feature 027, T019 / SC-004)", () => {
  const cases: Array<{ name: string; descriptor: TargetDescriptor; role: string }> = [
    { name: "plain field", descriptor: d({}), role: "textbox" },
    { name: "submit", descriptor: d({ tagName: "button", type: "submit", name: "search" }), role: "button" },
    { name: "credential", descriptor: d({ type: "password", name: "" }), role: "textbox" },
    {
      name: "consent",
      descriptor: d({ type: "checkbox", name: "i accept the terms" }),
      role: "checkbox",
    },
    { name: "plain box", descriptor: d({ type: "checkbox", name: "direct only" }), role: "checkbox" },
    { name: "link", descriptor: d({ tagName: "a", type: null, name: "deals" }), role: "link" },
  ];
  it("actionable ⟺ some verdict permits; refused ⟺ none do (or credential)", () => {
    for (const c of cases) {
      const [el] = assembleElements([
        rec({ descriptor: c.descriptor, role: c.role, label: c.name, value: "" }),
      ]);
      const fillOk = fillVerdictFor(c.descriptor).verdict === "permitted";
      const clickOk = clickVerdictFor(c.descriptor).verdict === "permitted";
      const chooseOk = chooseVerdictFor(c.descriptor).allowed;
      const credential = fillVerdictFor(c.descriptor).ruleId === "credential-field";
      expect(el.marker === "actionable", c.name).toBe((fillOk || clickOk || chooseOk) && !credential);
      expect(el.operations.length > 0, c.name).toBe(el.marker === "actionable");
    }
  });
});

describe("resolveSnapshotTarget — stale-safe index resolution (feature 027, US3)", () => {
  const descriptor = d({ tagName: "input", type: "text", role: null, name: "where to" });
  const url = "https://x.test/search";
  beforeEach(() => {
    clearSnapshotRegistry();
    storeSnapshotEntry("gen-1", {
      url,
      selectors: ["#to"],
      descriptors: [descriptor],
      roles: ["textbox"],
      labels: ["Where to?"],
    });
  });
  const wc = (live: unknown, atUrl = url) =>
    ({
      executeJavaScript: async () => live,
      getURL: () => atUrl,
    }) as unknown as import("electron").WebContents;

  it("resolves a fresh entry to its private selector", async () => {
    await expect(resolveSnapshotTarget(wc(descriptor), "gen-1", 1)).resolves.toBe("#to");
  });
  it("rejects unknown generations, bad indices, navigation, change, and removal as stale", async () => {
    await expect(resolveSnapshotTarget(wc(descriptor), "nope", 1)).rejects.toMatchObject({
      code: "TARGET_NOT_FOUND",
    });
    await expect(resolveSnapshotTarget(wc(descriptor), "gen-1", 2)).rejects.toMatchObject({
      code: "TARGET_NOT_FOUND",
    });
    await expect(
      resolveSnapshotTarget(wc(descriptor, "https://x.test/other"), "gen-1", 1),
    ).rejects.toThrow(/navigated/);
    await expect(
      resolveSnapshotTarget(wc({ ...descriptor, name: "different" }), "gen-1", 1),
    ).rejects.toThrow(/changed/);
    await expect(resolveSnapshotTarget(wc(null), "gen-1", 1)).rejects.toThrow(/changed/);
  });
  it("readActionable stores entries the resolver can use (private selectors stay out of the payload)", async () => {
    const tab = {
      executeJavaScript: async (script: string) => {
        if (typeof script === "string" && script.includes("CANDIDATE_SELECTOR")) {
          return {
            observedAt: "2026-09-21T00:00:00.000Z",
            url,
            title: "Search",
            text: "hi",
            hardCeilingHit: false,
            hiddenNodes: 0,
            records: [
              {
                descriptor,
                role: "textbox",
                label: "Where to?",
                value: "",
                selectorCounts: {
                  id: "to",
                  name: null,
                  tagName: "input",
                  structuralPath: "",
                  idCount: 1,
                  nameBareCount: 0,
                  nameTaggedCount: 0,
                  structuralCount: 0,
                },
              },
            ],
          };
        }
        return true;
      },
      getURL: () => url,
    } as unknown as import("electron").WebContents;
    const snap = await readActionable(tab, "tab-1", 0);
    expect(JSON.stringify(snap)).not.toContain("#to");
    await expect(resolveSnapshotTarget(wc(descriptor), snap.generation, 1)).resolves.toBe("#to");
  });
});

describe("actionableScript — generated collector parses (syntax guard)", () => {
  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(actionableScript())).not.toThrow();
  });
  it("collects candidates, visibility filtering, and private selector counts", () => {
    const script = actionableScript();
    expect(script).toContain("CANDIDATE_SELECTOR");
    expect(script).toContain("checkVisibility");
    expect(script).toContain("elementFromPoint");
    expect(script).toContain("structuralPath");
    expect(script).not.toContain("outerHTML");
  });
});
