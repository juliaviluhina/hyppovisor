// App-wide serialization of page loads and interactions (FR-013, FR-013a).
//
// Every open / navigate / read / interact acquires this single queue before
// touching any webContents, so at most one operation is in flight across all
// tabs. Errors in one task never stall the queue.

export interface QueueRunResult<T> {
  value: T;
  /** Number of tasks that were waiting when this one started (FR-013a). */
  queueDepth: number;
}

export class ActionQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  /** Tasks currently queued behind the running one. */
  get depth(): number {
    return this.waiting;
  }

  /**
   * Run `task` once every previously-enqueued task has settled.
   * The task receives the queue depth observed when it was enqueued (FR-013a);
   * the result also carries it for callers that don't need it inside the task.
   */
  run<T>(task: (queueDepth: number) => Promise<T>): Promise<QueueRunResult<T>> {
    this.waiting += 1;
    const depthAtEnqueue = this.waiting - 1;

    const result = this.tail.then(async () => {
      this.waiting -= 1;
      const value = await task(depthAtEnqueue);
      return { value, queueDepth: depthAtEnqueue };
    });

    // Keep the chain alive regardless of whether `result` rejected.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
