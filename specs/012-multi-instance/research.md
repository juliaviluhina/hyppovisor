# Phase 0 Research: Run More Than One HyppoVisor

All Technical Context items resolved. The three `/speckit-clarify` answers (2026-09-01) and
the spec Assumptions removed every NEEDS CLARIFICATION. The one plan-level decision the spec
deferred — the named-profile-directory path — is fixed in R6.

---

## R1 — Where instance resolution runs, and how the flags arrive

**Decision**: A new pure module `src/main/instance.ts` exports
`resolveInstance(argv: string[], env: NodeJS.ProcessEnv, baseUserDataDir: string)`.
`src/main/index.ts` calls it as the **first** statement of `main()`, before
`app.whenReady()` and before the existing `HYPPO_USER_DATA_DIR` block (which it subsumes).
It returns:

```ts
interface ResolvedInstance {
  /** Validated --instance name, or null (default / env-dir launch). */
  name: string | null;
  /** Title/header/serverName label: name → HYPPO_USER_DATA_DIR basename → "". */
  label: string;
  /** Absolute userData dir to setPath(), or null to leave Electron's default. */
  userDataDir: string | null;
  /** --port value if given and valid; undefined otherwise. */
  cliPort: number | undefined;
  /** "instance" | "env-dir" | "default" — for diagnostics / the panel notice. */
  source: "instance" | "env-dir" | "default";
}
```

**Rationale**:
- `app.setPath("userData", …)` and `app.requestSingleInstanceLock()` both must run before
  `whenReady`; `main()`'s top is the only correct point. `resolveInstance` is synchronous
  and Electron-free (takes `baseUserDataDir` as a string), so `tests/unit` drives it
  directly — same pattern as `settings.ts` / `unwrap-url.ts`.
- **Flag parsing**: a hand-rolled scan of `argv` for `--instance <v>` / `--instance=<v>` /
  `--port <v>` / `--port=<v>`, mirroring `readEnvOverrides`'s "small, no dependency" style.
  `--instance` and `--port` are not Chromium switches, so Electron leaves them in
  `process.argv` untouched (dev: `[electron, ".", "--instance", "work", …]`; packaged:
  `[exe, "--instance", "work", …]`; `open -na HyppoVisor --args --instance work` delivers
  them the same way). We do **not** use `app.commandLine.getSwitchValue` — it only reads
  switches Chromium knows, and would swallow/duplicate handling.

**Alternatives considered**:
- *Parse in `settings.ts`.* Rejected — `settings.ts` is filesystem-only and runs after
  `whenReady`; the lock and `setPath` are earlier.
- *A CLI arg library (yargs/commander).* Rejected — two flags; a new dependency for a
  ten-line scan fails Principle III "smallest mechanism".

---

## R2 — Profile-collision guard: `app.requestSingleInstanceLock()`

**Decision**: After `app.setPath("userData", resolved.userDataDir ?? <default>)`, call
`app.requestSingleInstanceLock()`.

- **Returns `false`** (another live process holds the lock for this `userData` dir):
  `dialog.showErrorBox(title, body)` — allowed before `whenReady` — with
  `collisionMessage(resolved)` from `instance.ts` ("Another HyppoVisor is already using
  this profile ('<label or default>'). To run a separate instance, launch with
  `--instance <name>` and a different `--port`."), then `app.exit(0)` before any
  `BrowserWindow`. FR-007.
- **Returns `true`**: register `app.on("second-instance", () => { if (win) { if
  (win.isMinimized()) win.restore(); win.show(); win.focus(); } })` so an accidental
  same-profile relaunch surfaces the running window. FR-008.

**Rationale**:
- Electron's single-instance lock **is keyed on the `userData` path** (the lock file lives
  in `userData`). So two instances with distinct `instances/<name>/` dirs each acquire
  their own lock and both start (FR-009), while a second launch of the *same* profile is
  refused — exactly the desired split, with no path bookkeeping of our own.
- A lock held by a **dead** process is reclaimed automatically by Electron/Chromium on the
  next `requestSingleInstanceLock()`, so "stale lock ⇒ startup proceeds" (FR-010) is free —
  no `SingletonLock` file handling, which is what makes issue 006's raw
  `HYPPO_USER_DATA_DIR` path confusing today.
- `dialog.showErrorBox` is the one dialog call explicitly documented to work before
  `ready`; `showMessageBoxSync` would need `whenReady` and thus a window-less app loop.

**Interaction with FR-005 (default instance byte-identical)**: a *single* default instance
is unchanged. The guard only changes what a *second simultaneous* default launch does —
today two windows fight over one profile; now the second shows the dialog and exits. That
is precisely US2's intent for the default profile, not a regression of the single-instance
experience.

**Test note**: Playwright `_electron.launch` spawns a fresh process per call; unrelated
specs each use their own `HYPPO_USER_DATA_DIR`, so no cross-test lock contention. The US2
spec deliberately launches twice into one reused dir.

**Alternatives considered**:
- *Read Chromium's `SingletonLock` directly.* Rejected — reimplements what
  `requestSingleInstanceLock` already does correctly, including stale-lock recovery.
- *`net.connect` probe of the MCP port to detect a sibling.* Rejected — conflates "profile
  in use" (the real hazard) with "port in use" (a separate, recoverable state, R3); a
  stdio instance has no port.

---

## R3 — `EADDRINUSE` becomes a first-class `serverStatus`

**Decision**: `EffectiveConnection` gains
`serverStatus: "listening" | "port-unavailable" | "error" | "stdio"`.

- `main()` already wraps `startHttpMcpServer` in `try/catch` and only `console.error`s.
  The catch now sets a `serverStatus` variable via
  `classifyListenError(err)` — `err.code === "EADDRINUSE"` or `/EADDRINUSE|in use/i` →
  `"port-unavailable"`, else `"error"` — and keeps `httpHandle` undefined. On success,
  `"listening"`. stdio transport → `"stdio"`.
- `currentEffective()` includes `serverStatus`; the existing `pushConnection()` /
  `connection:changed` carry it to the panel with no new channel.
- **Recovery (FR-015)**: `chrome:set-port` today early-returns
  `{ ok:false, "server is not running" }` when `!httpHandle`. Changed: if transport is
  http and `portSource !== "env"` and there is no handle, it calls `startHttpMcpServer`
  afresh on the requested port; on success it sets `httpHandle`, persists (when the port
  differs from `env`/default), and `pushConnection()` (now `"listening"`). A retry on the
  *same* port is therefore just "Apply" with the unchanged number.
- No automatic next-free-port pick (FR-013) — the configured port is authoritative.

**Panel (FR-011/FR-012)**: `renderHttp` renders, above the Endpoint block when
`serverStatus === "port-unavailable"`, a `.panel-error` div: *"Port <n> is in use —
another HyppoVisor instance? Change the port below and Apply, or relaunch with a different
`--port`."* For `"error"` it shows *"The MCP server could not start: <message>."* The
Endpoint / snippet blocks still render (they are valid once the port is fixed).

**Rationale**: reuses feature 007's state-push plumbing; the only new surface is one enum
field and one conditional block. `classifyListenError` is pure and unit-tested.

**Alternatives considered**:
- *A separate `mcpError` string only.* Rejected — the panel needs a stable discriminant to
  pick copy and styling; a free string invites string-matching in the renderer.
- *Make a failed bind fatal.* Rejected — FR-014 and the existing "a transport failure must
  not take the window down" behavior; the browser stays fully usable.

---

## R4 — Instance identity: title, panel header, `serverInfo.name`, snippet name

**Decision**: one derived `label` (R1) drives four surfaces.

1. **Window title** — `new BrowserWindow({ title })` with
   `title = label ? \`HyppoVisor — ${label}\` : "HyppoVisor"`, **plus** a guard:
   `win.webContents.on("page-title-updated", (e) => { e.preventDefault(); win.setTitle
   (title); })`. The renderer `index.html` ships `<title>HyppoVisor</title>`, which
   Electron would otherwise copy onto the window on load; the guard keeps our computed
   title for every instance and makes the default case (`"HyppoVisor"`) byte-identical.
2. **Panel header** — `index.html` `#panel-head` gains
   `<span id="panel-instance"></span>`; `panel.ts` sets its text to `label` (empty →
   nothing shown) from the `chrome:get-connection` reply.
3. **MCP handshake** — `makeServer(deps, serverName)` passes `{ name: serverName }` to
   `new McpServer(...)`; `serverName = serverNameFor(label)` =
   `label ? \`hyppovisor-${label}\` : "hyppovisor"`. Threaded through
   `startHttpMcpServer` / `startStdioMcpServer` as an option (default `"hyppovisor"`), and
   captured in the per-request `makeServer` closure in the HTTP handler.
4. **Snippets** — `SnippetState` / the stdio-config builder take `serverName`
   (default `"hyppovisor"`); `mcpAddCommand` / `mcpJsonConfig` / `stdioJsonConfig` emit it
   as the server key. `panel.ts` passes `reply.serverName`.

**`serverName` safety**: for `--instance`, the name is already `[a-z0-9][a-z0-9_-]*`
(R5), so `hyppovisor-<name>` is a valid `claude mcp add` name verbatim. For the
`HYPPO_USER_DATA_DIR`-basename label (FR-004a), `deriveLabel` sanitises first
(lowercase, non-`[a-z0-9_-]` → `-`, collapse repeats, trim `-`, clamp 32); if the result is
empty the label is `""` and both title and server name fall back to bare. Title and
`serverName` therefore always agree.

**Rationale**: a single `label` string computed once in `instance.ts` keeps the four
surfaces from drifting. The `page-title-updated` guard is the minimal robust fix for the
`<title>` override (no renderer round-trip, no flash).

**Alternatives considered**:
- *Set `document.title` from the renderer.* Rejected — a visible flash of "HyppoVisor"
  before the IPC reply, and it splits the title logic across processes.
- *Only label non-default instances' `serverInfo`.* Kept — the default stays `hyppovisor`
  so existing registrations and SC-007 hold.

---

## R5 — `--instance` name validation

**Decision**: `validateInstanceName(raw): { ok: true; name: string } | { ok: false;
reason: string }` with `/^[a-z0-9][a-z0-9_-]{0,31}$/` (Clarifications 2026-09-01). When
`--instance` is present but invalid, `main()` shows
`dialog.showErrorBox("Invalid --instance name", reason)` and `app.exit(1)` **before**
`setPath`, the lock, or any directory creation (FR-003). A valid name is used verbatim as
both the directory segment and the `hyppovisor-<name>` suffix — no second transform.

**Rationale**: one regex satisfies "valid directory name on macOS/Windows/Linux" and
"valid `claude mcp add` server name" simultaneously, which is why the clarification picked
this set. Lowercase-only avoids case-insensitive-filesystem collisions
(`Work` vs `work`).

**Alternatives considered**: allowing `.` / uppercase and sanitising for the server name —
rejected in clarification (two rules + a transform for no real gain).

---

## R6 — The named-profile-directory path

**Decision**: `<userData>/instances/<name>/`, i.e.
`join(app.getPath("userData"), "instances", name)` computed from the **pre-override**
`userData` (Electron's default app-support location), then `mkdirSync(dir, { recursive:
true })` and `app.setPath("userData", dir)`.

**Rationale**:
- Keeps every instance's data under the one app-support root a person already knows
  (`~/Library/Application Support/hyppovisor/` on macOS), so "where is my data" has one
  answer and the set of instances is `ls instances/`.
- `mkdirSync` first because `app.setPath("userData", …)` does not reliably create the
  directory on all platforms; `InteractionLog` and `loadSettings` then create their files
  lazily as today. Full isolation (SC-002) falls out because *every* `app.getPath
  ("userData")` call in `main()` now returns the instance dir.
- `HYPPO_USER_DATA_DIR` still overrides this wholesale (FR-004) — it wins and the label is
  taken from `--instance` if present, else the override path's basename (FR-004a).

**Alternatives considered**:
- *A sibling `hyppovisor-<name>/` next to the default dir.* Rejected — scatters instances
  across the app-support parent; `instances/` groups them and reads as intentional.
- *`<userData>/../hyppovisor-instances/<name>/`.* Rejected — same scattering, and steps
  outside the app's own tree.

---

## R7 — No-`--port` port precedence (FR-002a)

**Decision**: `resolveEffective(settings, env, existed, cliPort?)` gains a fourth argument;
effective port = `env.port ?? cliPort ?? settings.port`. `portSource` becomes
`"env" | "cli" | "persisted" | "default"`. `main()` passes `resolved.cliPort`; the
`startHttpMcpServer` call and `chrome:set-port`'s guards use the resolved value.

- `--instance work` alone → `loadSettings(<instance dir>)` supplies that instance's own
  persisted port if it has one, else `DEFAULTS.port` (7357). A first-run clash with the
  default instance surfaces as `serverStatus: "port-unavailable"` (R3); the panel-set port
  writes that instance's `settings.json` and is used on the next `--port`-less launch.
- `portSource === "cli"` → the panel port field stays **editable** (only `"env"` is
  read-only) with an info notice *"Launched with --port <n>."* — because a `--port`
  instance that hits `port-unavailable` needs the field to recover (FR-015).

**Rationale**: reuses feature 007's precedence resolver with one more term in the same
place; no new persistence, no new file. Matches the clarified answer exactly.

**Alternatives considered**: `--port` locking the field like `env` — rejected: it removes
the only in-app recovery path for a `--port` instance in the `port-unavailable` state.

---

## R8 — Constitution amendment (PATCH 1.4.0 → 1.4.1)

**Decision**: bundle a PATCH bump. Principle III bullet one gains a sentence; Amendment
History gains a 1.4.1 entry; the footer becomes
`**Version**: 1.4.1 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-09-01`.

Proposed clause (Principle III, after "One installable artifact, one window."):

> Running that one artifact more than once at a time is permitted: each process is one
> window with its own profile directory under the app-support root (`instances/<name>/`),
> shares no state with the others, and is identified by its `--instance` label and the OS
> process list. This is N independent single-window instances, not a multi-window app;
> there is no cross-instance registry or shared index.

Amendment History entry:

> **1.4.1** (2026-09-01) — Principle III: added a sentence permitting several concurrent
> instances of the one artifact, each one window with its own `instances/<name>/` profile
> directory and no shared state, identified by an `--instance` label. PATCH: a scoped
> clarification of "one window" — redefines no principle, adds no persistent store *kind*
> (the per-instance dir holds the existing per-profile files), adds no MCP tool, adds no
> external act. Precedent: 1.3.1 / 1.3.2 (scoped clarifications of the same principle).
> Recorded in feature `012-multi-instance` and `specs/issues/006-*`.

**Rationale**: without the clause the review gate ("a change that … introduces a
database/service … MUST be rejected or escalated") could read "run it N times, N profile
dirs" as hidden state or a second window. PATCH — not MINOR — because no principle is
redefined and no new *kind* of capability or store is blessed (contrast 1.2.0/1.3.0, which
expanded what a browser action may *do*).

**Alternatives considered**:
- *MINOR bump.* Rejected — nothing is materially expanded; a single instance behaves
  exactly as before.
- *No amendment.* Rejected — see feature 007's 1.3.1: a scoped PATCH is cheaper than
  leaving the gate to argue it case by case.

---

## R9 — Test strategy and the offline constraint

**Decision**:
- **Unit** carries the derivation logic: `resolveInstance` precedence matrix (env-dir vs
  `--instance` vs default; label fallback chain), `validateInstanceName`, `deriveLabel`
  sanitising, `serverNameFor`, `classifyListenError`. The profile-path derivation
  (`instances/<name>/`) is unit-tested here by injecting `baseUserDataDir`.
- **Integration** (`multi-instance.spec.ts`, `_electron`, offline):
  - **US1** — launch two full apps via `launchAppFull`, each with its own
    `HYPPO_USER_DATA_DIR` (real isolation) **and** `args: [mainEntry, "--instance", "<n>",
    "--port", "<p>"]` for identity. Assert: both `ping` on their ports; `initialize`
    `serverInfo.name` is `hyppovisor-work` / `hyppovisor-personal`; window titles differ
    (`app.evaluate` → `BrowserWindow.getAllWindows()[0].getTitle()`); each `settings.json`
    lives under its own dir. (Injecting `HYPPO_USER_DATA_DIR` means `--instance` supplies
    only the label here — the `instances/<name>/` path itself is proven in unit tests, so
    the suite stays hermetic and never writes under the real app-support dir.)
  - **US3** — occupy a port with `net.createServer`; `launchAppFull({ HYPPO_MCP_PORT: p })`;
    `page.evaluate` `getConnection()` → `serverStatus === "port-unavailable"`; free the
    port; `page.evaluate` `setPort(free)` → `"listening"`; `mcpPost(free, ping)` ok.
  - **US2** — `launchAppFull` (dir D); then `electron.launch({ args:[mainEntry], env:{ …
    HYPPO_USER_DATA_DIR: D } })`; assert the second app exposes no window within a short
    poll and its process exits on its own. The dialog *text* is asserted by a unit test on
    `collisionMessage`.
- `helpers.ts` `launchAppFull` gains an optional `extraArgs: string[]` appended after
  `mainEntry`.
- No live-site traffic anywhere (fixture server / loopback only), per the standing suite
  rule.

**Rationale**: keeps the hermetic guarantee (no writes under the real app-support dir, no
network) while still covering every FR — the one thing e2e can't easily assert (native
error-box text) is covered by a pure unit test.

---

## R10 — Passing the flags in dev and packaged builds

**Decision**: document, don't tool.

- **Dev, second instance**: `npx electron . --instance work --port 7358` (skips
  `postinstall`/`build`, which the first `npm start` already did). `npm start -- --instance
  work --port 7358` also works (npm forwards after `--`), but rebuilds.
- **Packaged, macOS**: `open -na HyppoVisor --args --instance work --port 7358`
  (`-n` forces a new process; `-a` names the app; `--args` passes the rest through).
- **stdio**: `--instance` still selects the profile and labels the handshake; add it to the
  spawn command in the MCP client config next to `HYPPO_MCP_STDIO=1`.

`docs/configuration.md` gets a "Run more than one HyppoVisor" section with these recipes and
the "never share a profile directory" warning; `docs/connect-an-agent.md` notes the
`hyppovisor-<name>` server name.

**Rationale**: the flags are the contract; an `npm run instance` wrapper would be one more
thing to keep in sync for no capability gain (Principle III).

---

## R11 — `requestSingleInstanceLock` vs the existing e2e suite

**Problem**: the lock is keyed on `userData`. The `HYPPO_E2E` helper `launchApp` in
`tests/integration/helpers.ts` launches **without** `HYPPO_USER_DATA_DIR`, i.e. against the
real dev `~/Library/Application Support/hyppovisor/`. After this feature:

- running `npm run test:e2e` while a dev `npm start` window is open would make the test app
  hit the collision guard and exit;
- back-to-back specs share that dir, so a slow lock-file release between one spec's
  `app.close()` and the next spec's launch is a (small, serial — `workers: 1`) race.

**Decision**: give `launchApp` its own throwaway `HYPPO_USER_DATA_DIR` (a `mkdtemp` dir),
exactly as `launchAppFull` already does, cleaned up in the returned close path or a
`test.afterAll`. Specs that relaunch into the same dir already pass one explicitly via
`tempUserDataDir()` / `reuseDir`, so they are unaffected. This also removes the pre-existing
smell of the e2e suite touching real dev state.

**Rationale**: strictly better hermeticity, and it makes the lock a non-issue for every
spec except the US2 collision spec, which opts in by reusing one dir. No production code
changes for this — only `helpers.ts`.

**Alternatives considered**:
- *Skip `requestSingleInstanceLock` when `HYPPO_E2E === "1"`.* Rejected — then the guard is
  never exercised end-to-end, and US2's spec (which uses the full, non-E2E `launchAppFull`)
  would be the only coverage; better to keep the guard always on and isolate the dirs.
- *Leave `launchApp` as is and serialise harder.* Rejected — doesn't fix the "can't run
  e2e while a dev instance is open" friction.
