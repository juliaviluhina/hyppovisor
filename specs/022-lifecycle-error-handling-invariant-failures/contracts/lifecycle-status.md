# Lifecycle Status Contract

The existing `chrome:get-connection` reply and `connection:changed` event gain:

```ts
type LifecycleState = "healthy" | "degraded" | "stopping" | "stopped";
type FailureKind = "operational" | "invariant";

interface FailureClassification {
  kind: FailureKind;
  subsystem: "process" | "http-bind" | "http-transport" | "queue" | "tab-action";
  message: string;
  at: string;
  recoverable: boolean;
  guidance: string;
}

interface LifecycleStatus {
  state: LifecycleState;
  failure: FailureClassification | null;
  updatedAt: string;
}
```

The renderer must show `degraded` and the failure message/guidance. A healthy status has `failure: null`. The contract carries no credentials or page content.
