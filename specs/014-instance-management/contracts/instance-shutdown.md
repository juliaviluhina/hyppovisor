# Contract: Instance shutdown (`chrome:close-instance`)

The action half of User Story 1. Confirmation in the renderer, mechanical kill in `main`.

## Flow

```
renderer: row "Close"  →  in-panel confirm modal
          ("Close instance "work" on port 7358? Its open tabs and any
            in-progress work are lost. This can't be undone.")
          Cancel (focused)          → nothing
          Close instance            → hyppo.closeInstance(pid)
                                          │
main:  chrome:close-instance(pid) ────────┘
   1. pid === process.pid ?  → { ok:false, error:"can't close the current instance" }
   2. process.kill(pid, "SIGTERM")
   3. poll process.kill(pid, 0) every 250 ms
   4. alive after config.instanceShutdownGraceMs (default 5000) ?
        → process.kill(pid, "SIGKILL");  forced = true
   5. best-effort unlink <that profile>/runtime.json
   6. → { ok:true, forced }         (forced omitted when false)
   errors:  ESRCH at step 2/3  → { ok:true, alreadyGone:true }   (idempotent)
            EPERM  at step 2    → { ok:false, error:"not permitted (different user)" }
            other               → { ok:false, error:<message> }
```

## Target side — no new code needed for the graceful path

`main()` already has (feature 013):

```ts
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => app.quit());
app.on("before-quit", () => { quitting = true; });
win.on("close", (e) => { if (quitting || !resolved.background) return; /* …hide… */ });
```

So `SIGTERM` → `app.quit()` → `before-quit` (`quitting = true`, **and now**
`clearRuntimeFile(userDataDir)` + `httpHandle?.close()`) → `win.on("close")` allows the
close → `window-all-closed` → `app.quit()` → process exits, MCP port released.

## In-flight MCP call (Clarification Q2)

Shutdown does **not** wait for an in-flight `read_page` / `fill` / etc. `app.quit()` closes
the HTTP listener and ends any streaming response; the connected client observes a normal
transport disconnect / aborted request — a clean error, retryable against another instance.
`httpHandle?.close()` in `before-quit` makes the listener stop accepting first (tidy FIN);
correctness does not depend on it.

## `chrome:close-instance`

| | |
|---|---|
| Args | `pid: number` |
| Reply | `{ ok: true, forced?: true, alreadyGone?: true }` &nbsp;\|&nbsp; `{ ok: false, error: string }` |
| Guard | `pid === process.pid` → refused (`{ ok:false, … }`), independent of the renderer's disabled control (FR-005 defence in depth) |
| Timing | SIGTERM immediately; SIGKILL at `config.instanceShutdownGraceMs`; whole call resolves ≤ grace + ~250 ms (SC-003: 10 s) |

## Renderer confirm modal

- Centered card over `#panel-body`, `role="dialog"`, `aria-modal="true"`, focus trapped,
  `Esc` = Cancel.
- Title text includes the **label** (or `"(default)"`) and the **port** verbatim
  (Clarification Q3).
- "Close instance" calls `hyppo.closeInstance(pendingClose.pid)`. On `{ ok:false }` an
  inline `.notice` in the Instances section shows `error`. On success, the modal closes and
  the next `listInstances` poll (≤ `instancePollMs`) drops the row.
- The current instance's row renders its close control `disabled` with hint text
  *"the instance you're viewing"* (FR-003 / FR-005) — no modal path from it.

## Windows

`process.kill(pid, "SIGTERM")` = `TerminateProcess` (immediate; no `before-quit`). The
SIGKILL escalation is then a redundant no-op and `forced` may be `false` even though the
stop was abrupt. macOS / Linux get true graceful-then-forced. The renderer copy ("any
in-progress work is lost") holds on every platform.
