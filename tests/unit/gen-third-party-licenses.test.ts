// Feature 010 (T010) — the pure THIRD-PARTY-LICENSES renderer. See quickstart.md §2.

import { describe, it, expect } from "vitest";
import { renderInventory } from "../../scripts/gen-third-party-licenses.js";

const entries = [
  {
    name: "zod",
    version: "3.24.0",
    spdx: "MIT",
    repository: "https://github.com/colinhacks/zod",
    licenseText: "MIT License\n\nCopyright (c) 2020 …\n",
  },
  {
    name: "acme",
    version: "1.0.0",
    spdx: "Apache-2.0",
    repository: "https://example.com/acme",
    licenseText: "Apache License 2.0 …",
  },
];

describe("renderInventory", () => {
  it("emits one section per entry, sorted by name", () => {
    const out = renderInventory(entries);
    expect(out.indexOf("## acme@1.0.0")).toBeLessThan(out.indexOf("## zod@3.24.0"));
  });

  it("each section carries name@version, SPDX id, repository, and license text", () => {
    const out = renderInventory(entries);
    expect(out).toContain("## zod@3.24.0");
    expect(out).toContain("License: MIT");
    expect(out).toContain("Repository: https://github.com/colinhacks/zod");
    expect(out).toContain("Copyright (c) 2020");
  });

  it("is deterministic — byte-identical on repeated calls with the same input", () => {
    expect(renderInventory(entries)).toBe(renderInventory(entries));
    // …and independent of input order.
    expect(renderInventory([...entries].reverse())).toBe(renderInventory(entries));
  });

  it("a missing SPDX id renders as UNKNOWN, a missing repo as (none)", () => {
    const out = renderInventory([
      { name: "x", version: "0.1.0", spdx: "", repository: "", licenseText: "text" },
    ]);
    expect(out).toContain("License: UNKNOWN");
    expect(out).toContain("Repository: (none)");
  });
});
