// TYPESAFE_API_KEY resolution order: this process's own env wins; macOS falls
// back to the OS-user environment via `launchctl getenv`; other platforms and
// an empty/missing value on macOS leave ranking unavailable (feature 027 follow-up).

import { describe, it, expect, vi } from "vitest";
import { resolveTypeSafeApiKey, describeApiKeySource } from "../../src/main/ranking/api-key.js";

describe("resolveTypeSafeApiKey", () => {
  it("uses the process's own env when present, without touching launchctl", async () => {
    const getenv = vi.fn();
    const result = await resolveTypeSafeApiKey({ TYPESAFE_API_KEY: "proc-key" }, "darwin", getenv);
    expect(result).toEqual({ key: "proc-key", source: "process-env" });
    expect(getenv).not.toHaveBeenCalled();
  });

  it("trims a whitespace-padded process env value", async () => {
    const result = await resolveTypeSafeApiKey({ TYPESAFE_API_KEY: "  proc-key  " }, "darwin");
    expect(result).toEqual({ key: "proc-key", source: "process-env" });
  });

  it("falls back to launchctl getenv on macOS when the process env has none", async () => {
    const getenv = vi.fn().mockResolvedValue("os-user-key");
    const result = await resolveTypeSafeApiKey({}, "darwin", getenv);
    expect(result).toEqual({ key: "os-user-key", source: "launchctl" });
    expect(getenv).toHaveBeenCalledWith("TYPESAFE_API_KEY");
  });

  it("resolves to none when neither source has a value", async () => {
    const getenv = vi.fn().mockResolvedValue(undefined);
    const result = await resolveTypeSafeApiKey({}, "darwin", getenv);
    expect(result).toEqual({ key: undefined, source: "none" });
  });

  it("never calls launchctl off macOS", async () => {
    const getenv = vi.fn();
    const result = await resolveTypeSafeApiKey({}, "linux", getenv);
    expect(result).toEqual({ key: undefined, source: "none" });
    expect(getenv).not.toHaveBeenCalled();
  });

  it("treats an empty process env value as absent, falling back to launchctl", async () => {
    const getenv = vi.fn().mockResolvedValue("os-user-key");
    const result = await resolveTypeSafeApiKey({ TYPESAFE_API_KEY: "" }, "darwin", getenv);
    expect(result).toEqual({ key: "os-user-key", source: "launchctl" });
  });
});

describe("describeApiKeySource", () => {
  it("names the source without ever including a key value", () => {
    expect(describeApiKeySource("process-env")).toContain("process environment");
    expect(describeApiKeySource("launchctl")).toContain("OS user environment");
    expect(describeApiKeySource("none")).toContain("not set");
  });
});
