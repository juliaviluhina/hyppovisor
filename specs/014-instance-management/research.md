# Phase 0 Research: Local Instance Management Panel

Six decisions. All resolvable from the existing codebase (features 007 / 012 / 013) plus
the four `/speckit-clarify` answers; no external spike needed.

---

## R1 — How does one instance discover the others?

**Decision**: Each process writes a small `runtime.json` into its **own** profile
directory when its MCP server has bound, and removes it on `before-quit`. The panel
enumerates candidate profile directories, reads each `runtime.json`, discards any whose
`pid` is not alive (`process.kill(pid, 0)` throws `ESRCH`), and returns the rest — merging
in the current instance from authoritative in-process data.

Candidate directories:

- the **default profile** = the app-support root captured as `app.getPath("userData")`
  *before* `app.setPath("userData", …)` runs in `main()` (feature 012 already reads this
  same value as `baseUserDataDir`);
- every immediate subdirectory of `<app-support-root>/instances/` — the exact location
  feature 012 puts a `--instance <name>` profile (`join(baseUserDataDir, "instances",
  name)`).

`runtime.json` (atomic temp-write + `rename`, like `settings.ts` / `recent-urls.ts`):

```jsonc
{ "schema": 1, "pid": 40321, "port": 7358, "mode": "background",
  "label": "work", "startedAt": "2026-09-01T18:22:04.511Z" }
```

**Rationale**: PID is nowhere else on disk and the *effective* port (which may come from
`--port` or `HYPPO_MCP_PORT`, neither persisted) is nowhere else either — `settings.json`
only has the persisted port. A per-process file each instance owns is not a "cross-instance
registry or shared index" (Principle III): there is no aggregate, no coordination, no
concurrent writers to one file. It sits beside the existing per-profile `settings.json` /
`recent-urls.json` / `interaction-log.jsonl`, not in the shared data directory. Staleness
from a crash / `SIGKILL` is self-healing: the next scan sees the dead PID, skips the entry,
and best-effort `unlink`s the file.

**Alternatives considered**:
- *Parse Electron's `SingletonLock`* (macOS/Linux symlink target `hostname-pid`) — gets a
  PID with zero new files, but undocumented Chromium internals, platform-specific, and no
  port or mode. Rejected as a fragile dependency.
- *Probe a fixed port range* (7357–7400) — instances bind arbitrary ports (`--port`,
  OS-assigned in tests); slow, misses instances, false hits on unrelated listeners.
- *One shared registry file all instances append to* — this is precisely the shared index
  Principle III forbids, and needs file-locking for concurrent start/stop.
- *A broker/daemon process* — a background service, forbidden by Principle III, and
  overkill for ≲ 10 local processes.

**Limitation (documented, FR-010)**: an instance started with `HYPPO_USER_DATA_DIR`
pointing outside the `instances/` tree (the test/CI harness, wrapper scripts) writes its
`runtime.json` there and is not enumerable. The current instance always appears (from
in-process data); if the sibling scan yields nothing the panel shows a "can't list other
instances" note rather than implying none run.

---

## R2 — How is another instance shut down, gracefully then forced?

**Decision**: `chrome:close-instance` → (in-panel confirm, R4) → `process.kill(targetPid,
"SIGTERM")`; poll `process.kill(targetPid, 0)` every 250 ms; if still alive after
`config.instanceShutdownGraceMs` (default 5000, env-overridable) → `process.kill(targetPid,
"SIGKILL")`; then best-effort `unlink` the target's now-stale `runtime.json`. Return
`{ ok: true, forced: boolean }` or `{ ok: false, error }` (e.g. `EPERM`, or `ESRCH` = the
instance was already gone → treat as success, `{ ok: true, alreadyGone: true }`).

The target needs **no new code** for the graceful path: `main()` already registers
`process.on("SIGTERM", () => app.quit())` (feature 013 FR-011), and `app.quit()` →
`before-quit` (sets `quitting`, and now also `clearRuntimeFile()`) → the `--background`
close interceptor lets the window go → `window-all-closed` → process exits, port released.

**In-flight MCP call** (Clarification Q2 → immediate, clean failure): `app.quit()` tears
the process down; the HTTP server's socket closes and any streaming response ends, so the
connected client sees a normal transport disconnect / aborted request — a clean error it
can retry against another instance. We additionally call `httpHandle?.close()` in the new
`before-quit` handler so the listener stops accepting *before* teardown (a tidy FIN rather
than a dropped connection), but correctness does not depend on it.

**Double-trigger** (spec edge case): a second `close-instance` for the same PID while the
first is mid-grace finds `ESRCH` (or the in-progress marker) and is a no-op success.

**Rationale**: POSIX signals are the standard, dependency-free way to stop a local process
you own, and feature 013 already wired the graceful half. SIGKILL after a bounded wait
satisfies FR-006 and SC-003 (10 s) with margin.

**Alternatives considered**:
- *An MCP `shutdown` tool* — adds an external-control tool surface, requires presenting the
  bearer token from the panel, and invites a Principle I/II debate. Rejected.
- *IPC via a "please quit" flag file the target polls* — needs a new watcher loop in every
  instance; a signal already does it.
- *Only SIGTERM, no SIGKILL* — a wedged instance (main-process event loop blocked) would
  never exit; FR-006 explicitly wants the forced escalation.

**Windows note**: `process.kill(pid, "SIGTERM")` maps to `TerminateProcess` (no graceful
hook fires), so on Windows the "graceful" step is already forceful; the SIGKILL escalation
is then a redundant no-op. macOS/Linux get the true graceful-then-forced behaviour. Called
out in `contracts/instance-shutdown.md`.

---

## R3 — What does "responding" / "not responding" mean, and how is it checked?

**Decision**: For each enumerated instance with a live PID, attempt a bare TCP `connect` to
`127.0.0.1:<port>` with a `config.instanceProbeTimeoutMs` (default 400 ms) deadline, in
parallel across instances. Connect succeeds → `state: "responding"`. Connect refused /
times out → `state: "not-responding"` (still listed, with its mode, per the spec edge
case: "starting up, or wedged"). The current instance is always `"responding"` (it is
serving this panel) unless it is in stdio mode, in which case `port` is `null` and `state`
is `"stdio"`.

**Rationale**: A TCP connect is the lightest possible liveness signal — no HTTP request, no
MCP `initialize`, nothing that counts as a page/tool action or needs the token (Principle
V). Whether the MCP handshake *fully* works is not what the panel promises; "is something
listening on the port this instance advertised" is.

**Alternatives considered**: an MCP `ping` — heavier, needs `accept` headers and possibly
the bearer token, and a 200 vs 401 distinction the panel does not need. A pure PID check
with no probe — cannot distinguish "up and serving" from "process alive but MCP server
failed to bind (`serverStatus: "error"`)", which is exactly the state the edge case wants
surfaced.

---

## R4 — Where does the shutdown confirmation live?

**Decision**: An **in-panel confirmation modal** (a small centered card over the panel
body, same styling vocabulary as `#panel-card`), not a native `dialog.showMessageBox`.
Copy: *"Close instance "work" on port 7358? Its open tabs and any in-progress work are
lost. This can't be undone."* Buttons: **Cancel** (default/focused) / **Close instance**.
`chrome:close-instance` only runs after the user picks "Close instance".

**Rationale**: Clarification Q3 requires a confirmation naming the target + port. A native
modal cannot be driven by the Playwright integration tests (the repo already routes around
this — `failStartup` suppresses `dialog.showErrorBox` under `HYPPO_E2E`). An in-DOM modal
is fully testable, matches the panel's existing overlay look, and keeps confirmation logic
in one place (the renderer) with `main` doing only the mechanical kill.

**Alternatives considered**: native `dialog.showMessageBox` with parent `win` — better OS
integration but untestable here and splits the flow across processes. A typed-confirmation
("type the instance name") — heavier than the risk warrants; the current-instance guard
plus a named one-click confirm is the Q3 answer.

---

## R5 — What is the tab state after "Close all tabs"?

**Decision**: Zero content tabs — byte-identical to a freshly launched instance, which
opens with an empty tab strip and the address bar ready (`TabManager` starts with an empty
map; `app.ts` renders no tab). `TabManager.closeAll()` removes every child view, calls
`webContents.close()` on each, clears the map, sets `activeId = null`, re-lays-out, and
fires one `onChange`. The "Close all tabs" button is `disabled` when the tab count is 0
(FR-013 no-op).

**Reconciliation with the spec**: FR-013 / the US2 clarification say "a single blank/home
tab (the same state as a freshly launched instance)". HyppoVisor has **no** blank-tab
concept — a fresh instance has *no* tabs. "The same state as a freshly launched instance"
is the operative clause; it resolves to the zero-tab empty state. No placeholder tab is
invented (that would be a new concept and a new thing for the MCP `list_open_tabs` to
report). `data-model.md` and `quickstart.md` state this explicitly; the spec's wording is
noted as satisfied by the zero-tab reading.

**Rationale**: Smallest mechanism; no new "home page" asset or URL policy question; keeps
`list_open_tabs` honest (empty means empty).

**Alternatives considered**: opening an `about:blank` tab — `about:` is not http(s) and the
URL policy (`validateUrl`) would reject it through the normal path; special-casing it adds
surface for no user value. A bundled local `home.html` — a new asset, a new navigable
surface, and still not "the freshly launched state".

---

## R6 — Constitution amendment: needed? what level?

**Decision**: Yes — a **MINOR** bump, 1.4.2 → 1.5.0. Principle III's third bullet gains a
sentence permitting a *bounded local instance-management surface*: one instance MAY
enumerate and shut down other instances of the same user on the same machine, using
per-instance transient runtime files (no daemon, no shared store, nothing written to the
shared data directory). Amendment History gains a 1.5.0 entry citing this feature.

**Rationale**: The principle explicitly says "there is no cross-instance registry or shared
index" and "not a multi-window app" — this feature's US1 is directly in that territory, so
silence is not an option (same reasoning that made 013 take a bump rather than leave it to
the gate). It is MINOR, not PATCH: 1.4.1 and 1.4.2 were PATCHes because they clarified the
"one window" sentence and blessed *no new capability kind*. This blesses a new capability
(cross-instance shutdown) and a new UI surface — the governance policy's MINOR criterion
("a new principle or section is added, or existing guidance is materially expanded").

**What the amendment must NOT do**: it does not weaken Principle I (no external act),
Principle IV (credentials), or Principle V (pace/queue); it does not permit a background
service, a shared database, or shared-data-directory writes. Those stay forbidden and are
reaffirmed in the clause.

**Sequencing**: FR-014 says the amendment lands before US1 is implemented. In `tasks.md`
the amendment task is an early gate for the US1 tasks; US2 (close-all-tabs) has no such
dependency and can proceed in parallel. Run `/speckit-constitution` to apply the bump, or
hand-edit `.specify/memory/constitution.md` per the plan.
