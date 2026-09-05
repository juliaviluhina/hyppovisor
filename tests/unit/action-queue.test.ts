import { describe, it, expect } from "vitest";
import { ActionQueue } from "../../src/main/queue/action-queue.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ActionQueue (FR-013, FR-013a)", () => {
  it("never runs two tasks concurrently, even when enqueued at once", async () => {
    const q = new ActionQueue();
    let active = 0;
    let maxActive = 0;

    const task = () => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active -= 1;
    };

    await Promise.all(Array.from({ length: 8 }, () => q.run(task())));
    expect(maxActive).toBe(1);
  });

  it("preserves FIFO order", async () => {
    const q = new ActionQueue();
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        q.run(async () => {
          await delay(5 - n < 0 ? 0 : (5 - n) * 2);
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it("reports the queue depth observed at enqueue time", async () => {
    const q = new ActionQueue();
    const results = await Promise.all(Array.from({ length: 4 }, () => q.run(async () => delay(5))));
    expect(results.map((r) => r.queueDepth)).toEqual([0, 1, 2, 3]);
  });

  it("keeps running after a task throws", async () => {
    const q = new ActionQueue();
    const failing = q.run(async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");

    const after = await q.run(async () => 42);
    expect(after.value).toBe(42);
  });

  it("rejects new work while its health gate is closed", async () => {
    const q = new ActionQueue();
    q.setHealthGate(() => false);
    await expect(q.run(async () => 42)).rejects.toThrow("degraded");
  });
});
