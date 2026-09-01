# Contract: Instance launch (`--instance` / `--port`)

The launch-time CLI surface added by feature 012. Consumed by `src/main/instance.ts`
(`resolveInstance`) and `src/main/index.ts` (`main()`). Environment variables are unchanged
from feature 007 and keep precedence.

## Flags

| Flag | Form | Value | Effect |
|---|---|---|---|
| `--instance` | `--instance <name>` or `--instance=<name>` | `/^[a-z0-9][a-z0-9_-]{0,31}$/` | Selects profile dir `<userData>/instances/<name>/` and display label `<name>`. Invalid → error dialog + exit 1, no directory created. |
| `--port` | `--port <n>` or `--port=<n>` | integer 1–65535 | MCP HTTP port for this process. Invalid/out-of-range → error message + startup aborts. Omitted → `env HYPPO_MCP_PORT ?? persisted per-instance port ?? 7357`. |

Unknown flags are ignored (Chromium/Electron may consume its own switches; `--instance` /
`--port` are not among them and always reach `process.argv`).

## Precedence (what sets the profile dir and the port)

```
profile dir : HYPPO_USER_DATA_DIR  >  --instance <name>  >  Electron default (<app-support>/hyppovisor)
port        : HYPPO_MCP_PORT        >  --port <n>         >  that profile's settings.json  >  7357
label       : --instance <name>     >  basename(HYPPO_USER_DATA_DIR) via deriveLabel  >  ""   (default → bare "HyppoVisor")
```

`HYPPO_USER_DATA_DIR` + `--instance` together: the env dir wins for storage, the
`--instance` name still provides the label.

## `resolveInstance(argv, env, baseUserDataDir) → ResolvedInstance`

Pure, synchronous, Electron-free. Fields: see `data-model.md` §1.

- `name`: validated `--instance`, or `null`.
- `userDataDir`: `env.HYPPO_USER_DATA_DIR ?? (name && join(baseUserDataDir, "instances",
  name)) ?? null`.
- `label`: `name ?? deriveLabel(basename(env.HYPPO_USER_DATA_DIR)) ?? ""` — first non-empty.
- `cliPort`: parsed `--port` (integer 1–65535) or `undefined`.
- `source`: `"instance"` | `"env-dir"` | `"default"`.

An invalid `--instance` is reported by `resolveInstance` as a distinguished result
(`{ error: "invalid-instance-name", reason }`) so `main()` can `showErrorBox` + `exit(1)`
before any side effect. An out-of-range `--port` is likewise a distinguished result
(`{ error: "invalid-port", reason }`).

## Startup behaviours

| Situation | Behaviour | FR |
|---|---|---|
| Valid `--instance foo`, dir free | `mkdir -p instances/foo`, `setPath("userData", …)`, lock acquired, window titled `HyppoVisor — foo` | FR-001, FR-016 |
| `--instance` fails the regex | `dialog.showErrorBox("Invalid --instance name", <allowed form>)`, `exit(1)`, nothing created | FR-003 |
| `--port` non-numeric / out of 1–65535 | startup aborts with a message naming the bad value | FR-002 |
| Profile dir already held by a live process | `dialog.showErrorBox(collisionMessage)`, `exit(0)`, no window | FR-007 |
| Accidental relaunch of a running profile | primary's `second-instance` handler restores + focuses its window | FR-008 |
| Two instances, different profile dirs | both start, no dialog | FR-009 |
| Lock file present but holder is dead | `requestSingleInstanceLock()` reclaims it; startup proceeds | FR-010 |
| No `--instance`, no env overrides | `userDataDir=null`, `label=""`, bare title — identical to pre-012 | FR-005, SC-007 |
| stdio transport + `--instance foo` | profile + label applied; handshake name `hyppovisor-foo`; no port, so no port-collision path | Edge case |

## Launch recipes (documented in `docs/configuration.md`)

```bash
# dev, second instance (no rebuild)
npx electron . --instance work --port 7358

# packaged, macOS
open -na HyppoVisor --args --instance work --port 7358

# stdio client config
claude mcp add hyppovisor-work -e HYPPO_MCP_STDIO=1 -- \
  /abs/path/electron /abs/path/dist/main/index.js --instance work
```

Two instances MUST NOT share a profile directory — the lock guard refuses it.
