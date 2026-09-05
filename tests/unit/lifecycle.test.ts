import { describe, expect, it } from "vitest";
import { LifecycleStateStore, normalizeFailure } from "../../src/main/lifecycle.js";

describe("LifecycleStateStore", () => {
  it("normalizes arbitrary thrown values", () => {
    expect(normalizeFailure({ reason: "bad" }, "invariant", "process").message).toBe(
      '{"reason":"bad"}',
    );
  });

  it("retains the first invariant context until recovery", () => {
    const store = new LifecycleStateStore();
    const updates: string[] = [];
    store.subscribe((s) => updates.push(s.state));
    store.invariant(new Error("broken tabs"), "tab-action");
    expect(store.current.state).toBe("degraded");
    expect(store.current.failure?.message).toBe("broken tabs");
    store.healthy("tab-action");
    expect(store.current).toMatchObject({ state: "healthy", failure: null });
    expect(updates).toEqual(["degraded", "healthy"]);
  });

  it("allows unaffected tab actions during an HTTP bind failure", () => {
    const store = new LifecycleStateStore();
    store.invariant(new Error("port busy"), "http-bind", true);
    expect(store.allows("tab-action")).toBe(true);

    store.invariant(new Error("process broken"), "process");
    expect(store.allows("tab-action")).toBe(false);
  });
});
