import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InteractionLog } from "../../src/main/safety/interaction-log.js";

describe("blocked navigation audit records", () => {
  it("stores host/outcome metadata without page content", () => {
    const dir = mkdtempSync(join(tmpdir(), "hyppo-log-"));
    try {
      const log = new InteractionLog(dir);
      log.record({
        tabId: "tab-1",
        url: "https://blocked.example/secret",
        operation: "navigate",
        target: null,
        outcome: "refused",
        ruleId: "DOMAIN_BLOCKED",
        error: "Navigation to blocked.example is blocked by the blocked domains setting.",
      });
      const entry = JSON.parse(readFileSync(log.filePath, "utf8"));
      expect(entry).toMatchObject({ tabId: "tab-1", operation: "navigate", outcome: "refused", ruleId: "DOMAIN_BLOCKED" });
      expect(entry).not.toHaveProperty("content");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
