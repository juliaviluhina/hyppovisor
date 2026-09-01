// Feature 012 — instance resolution at launch. Pure module, driven directly:
// precedence matrix, name validation, label derivation, server name, the
// collision-dialog copy, and listen-error classification.
// See specs/012-multi-instance/{data-model.md §1, contracts/instance-launch.md}.

import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  INSTANCE_NAME_RE,
  classifyListenError,
  collisionMessage,
  deriveLabel,
  isResolveError,
  resolveInstance,
  serverNameFor,
  validateInstanceName,
  type ResolvedInstance,
} from "../../src/main/instance.js";

// Built with join() so the expectations match the platform separator (CI runs on Windows too).
const BASE = join("home", "u", ".config", "hyppovisor");
const instancesDir = (name: string) => join(BASE, "instances", name);
const ok = (r: ReturnType<typeof resolveInstance>): ResolvedInstance => {
  if (isResolveError(r)) throw new Error(`unexpected error: ${r.reason}`);
  return r;
};

describe("validateInstanceName", () => {
  it.each(["work", "a", "client-2", "c_2", "0", "a".repeat(32)])("accepts %j", (n) => {
    expect(validateInstanceName(n)).toEqual({ ok: true, name: n });
  });

  it.each([
    "",
    "-work",
    "_work",
    "Work",
    "wo rk",
    "work/x",
    "..",
    "work.",
    "a".repeat(33),
    "wörk",
  ])("rejects %j", (n) => {
    const r = validateInstanceName(n);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/1–32|lowercase/);
  });

  it("the exported regex matches the validator", () => {
    expect(INSTANCE_NAME_RE.test("work")).toBe(true);
    expect(INSTANCE_NAME_RE.test("Work")).toBe(false);
  });
});

describe("deriveLabel", () => {
  it.each([
    ["work", "work"],
    ["Work", "work"],
    ["ci-run", "ci-run"],
    ["My Project!", "my-project"],
    ["--weird--", "weird"],
    ["a".repeat(40), "a".repeat(32)],
    ["   ", ""],
    ["", ""],
  ])("%j → %j", (raw, want) => {
    expect(deriveLabel(raw)).toBe(want);
  });
});

describe("serverNameFor", () => {
  it("bare for the default instance", () => {
    expect(serverNameFor("")).toBe("hyppovisor");
  });
  it("suffixed for a labelled instance", () => {
    expect(serverNameFor("work")).toBe("hyppovisor-work");
  });
});

describe("resolveInstance — precedence", () => {
  it("no flags, no env → default, byte-identical launch", () => {
    const r = ok(resolveInstance(["electron", "."], {}, BASE));
    expect(r).toEqual({
      name: null,
      label: "",
      userDataDir: null,
      cliPort: undefined,
      source: "default",
    });
  });

  it("--instance selects instances/<name> and labels from the name", () => {
    const r = ok(resolveInstance(["electron", ".", "--instance", "work"], {}, BASE));
    expect(r.name).toBe("work");
    expect(r.label).toBe("work");
    expect(r.userDataDir).toBe(instancesDir("work"));
    expect(r.source).toBe("instance");
  });

  it("--instance=<name> form is accepted too", () => {
    const r = ok(resolveInstance(["electron", ".", "--instance=client-2"], {}, BASE));
    expect(r.name).toBe("client-2");
    expect(r.userDataDir).toBe(instancesDir("client-2"));
  });

  it("HYPPO_USER_DATA_DIR wins for the dir; label falls back to its basename", () => {
    const r = ok(resolveInstance(["electron", "."], { HYPPO_USER_DATA_DIR: "/tmp/ci-run" }, BASE));
    expect(r.userDataDir).toBe("/tmp/ci-run");
    expect(r.label).toBe("ci-run");
    expect(r.source).toBe("env-dir");
    expect(r.name).toBeNull();
  });

  it("HYPPO_USER_DATA_DIR + --instance: env dir wins, --instance still names the label", () => {
    const r = ok(
      resolveInstance(
        ["electron", ".", "--instance", "work"],
        { HYPPO_USER_DATA_DIR: "/tmp/ci-run" },
        BASE,
      ),
    );
    expect(r.userDataDir).toBe("/tmp/ci-run");
    expect(r.label).toBe("work");
    expect(r.source).toBe("env-dir");
  });

  it("--port in range is parsed; both space and = forms", () => {
    expect(ok(resolveInstance(["e", ".", "--port", "7358"], {}, BASE)).cliPort).toBe(7358);
    expect(ok(resolveInstance(["e", ".", "--port=7000"], {}, BASE)).cliPort).toBe(7000);
  });

  it("no --port → cliPort undefined (env/persisted/default resolved later)", () => {
    expect(ok(resolveInstance(["e", ".", "--instance", "work"], {}, BASE)).cliPort).toBeUndefined();
  });
});

describe("resolveInstance — rejections (before any side effect)", () => {
  it.each(["Work", "..", "a/b", "-x", ""])("invalid --instance %j → error", (n) => {
    const r = resolveInstance(["e", ".", "--instance", n], {}, BASE);
    expect(isResolveError(r) && r.error).toBe("invalid-instance-name");
  });

  it.each(["0", "70000", "8e9", "abc", "-1", "80.5"])("invalid --port %j → error", (p) => {
    const r = resolveInstance(["e", ".", "--port", p], {}, BASE);
    expect(isResolveError(r) && r.error).toBe("invalid-port");
  });

  it("bare --instance with no value is rejected", () => {
    const r = resolveInstance(["e", ".", "--instance"], {}, BASE);
    expect(isResolveError(r) && r.error).toBe("invalid-instance-name");
  });
});

describe("collisionMessage", () => {
  it("names a labelled profile", () => {
    const { body } = collisionMessage({ label: "work" } as ResolvedInstance);
    expect(body).toContain('"work" profile');
    expect(body).toContain("--instance");
    expect(body).toContain("--port");
  });
  it("names the default profile when unlabelled", () => {
    const { body } = collisionMessage({ label: "" } as ResolvedInstance);
    expect(body).toContain("default profile");
  });
});

describe("classifyListenError", () => {
  it("EADDRINUSE code → port-unavailable", () => {
    expect(classifyListenError({ code: "EADDRINUSE", message: "listen EADDRINUSE" })).toBe(
      "port-unavailable",
    );
  });
  it("message match → port-unavailable", () => {
    expect(classifyListenError(new Error("address already in use 127.0.0.1:7357"))).toBe(
      "port-unavailable",
    );
  });
  it("anything else → error", () => {
    expect(classifyListenError({ code: "EACCES", message: "permission denied" })).toBe("error");
    expect(classifyListenError(null)).toBe("error");
    expect(classifyListenError("boom")).toBe("error");
  });
});
