import type {
  FailureClassification,
  FailureKind,
  FailureSubsystem,
  LifecycleStatus,
} from "../shared/types.js";

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

export function normalizeFailure(
  value: unknown,
  kind: FailureKind,
  subsystem: FailureSubsystem,
  recoverable = kind === "operational",
): FailureClassification {
  return {
    kind,
    subsystem,
    message: messageOf(value),
    at: new Date().toISOString(),
    recoverable,
    guidance:
      kind === "operational"
        ? "The app can continue; review the log if the problem repeats."
        : "Stop relying on affected actions and restart HyppoVisor or re-establish the affected service.",
  };
}

export class LifecycleStateStore {
  private status: LifecycleStatus = {
    state: "healthy",
    failure: null,
    updatedAt: new Date().toISOString(),
  };
  private listeners = new Set<(status: LifecycleStatus) => void>();
  private invariantFailures = new Map<FailureSubsystem, FailureClassification>();

  get current(): LifecycleStatus {
    return { ...this.status, failure: this.status.failure && { ...this.status.failure } };
  }

  /** Whether work owned by a subsystem is safe to start. */
  allows(subsystem: FailureSubsystem): boolean {
    if (this.status.state === "healthy") return true;
    if (this.status.state !== "degraded") return false;
    // A failure in another subsystem, such as HTTP binding, must not disable
    // the standalone tab surface.
    return !this.invariantFailures.has(subsystem) && !this.invariantFailures.has("process");
  }

  subscribe(listener: (status: LifecycleStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Mark one subsystem recovered without clearing unrelated failures. */
  healthy(subsystem: FailureSubsystem): void {
    this.invariantFailures.delete(subsystem);
    // A shutdown in progress owns `state` from here on — recovering an
    // unrelated subsystem must not resurrect "healthy" underneath it.
    if (this.status.state === "stopping" || this.status.state === "stopped") return;
    const failure = this.invariantFailures.values().next().value as
      | FailureClassification
      | undefined;
    this.status = {
      state: failure ? "degraded" : "healthy",
      failure: failure ?? null,
      updatedAt: new Date().toISOString(),
    };
    this.emit();
  }

  stopping(): void {
    this.status = { ...this.status, state: "stopping", updatedAt: new Date().toISOString() };
    this.emit();
  }

  stopped(): void {
    this.status = { ...this.status, state: "stopped", updatedAt: new Date().toISOString() };
    this.emit();
  }

  operational(value: unknown, subsystem: FailureSubsystem): FailureClassification {
    const failure = normalizeFailure(value, "operational", subsystem);
    console.error(`[hyppovisor] operational ${subsystem} failure:`, failure.message);
    return failure;
  }

  invariant(
    value: unknown,
    subsystem: FailureSubsystem,
    recoverable = false,
  ): FailureClassification {
    const failure = normalizeFailure(value, "invariant", subsystem, recoverable);
    if (!this.invariantFailures.has(subsystem)) this.invariantFailures.set(subsystem, failure);
    console.error(`[hyppovisor] invariant ${subsystem} failure:`, failure.message);
    if (this.status.state === "degraded" && this.status.failure) {
      return this.status.failure;
    }
    this.status = {
      state: "degraded",
      failure: this.invariantFailures.get(subsystem)!,
      updatedAt: new Date().toISOString(),
    };
    this.emit();
    return failure;
  }

  private emit(): void {
    const snapshot = this.current;
    for (const listener of this.listeners) listener(snapshot);
  }
}
