# Contract: `--background` launch flag

The launch-time CLI surface added by feature 013. Consumed by `src/main/instance.ts`
(`resolveInstance`) and `src/main/index.ts` (`main()`). Environment variables and the other
flags (`--instance`, `--port`) are unchanged from feature 012.

## Flag

| Flag | Form | Value | Effect |
|---|---|---|---|
| `--background` | `--background` (bare) | none — it is a boolean | The instance starts with **no visible window** and never takes focus. On macOS it shows no Dock icon and no ⌘-Tab entry; on Windows/Linux no taskbar button. MCP server, tabs, reads, drafts run exactly as a foreground instance. **`screenshot` is the exception** — a never-shown window has no surface, so it returns `SCREENSHOT_FAILED` (as built; see `research.md` R2). |

- `--background` never takes a value. `--background=1` / `--background=false` do **not**
  match the flag (treated as an unknown arg and ignored) — the flag is present or absent.
- `--background` never aborts startup.
- It composes with every other flag in any order:
  `--instance work --port 7358 --background` ≡ `--background --instance=work --port=7358`.

## Precedence / interaction

```
window visibility & focus, decided after win.loadFile():

  --background present                         → hidden;  never focused
  else source === "instance" (named --instance)→ shown;   never focused  (revises 012)
  else (source "default" or "env-dir")         → shown;   focused        (unchanged from 012)
```

**As-built note:** `env-dir` (`HYPPO_USER_DATA_DIR`) joins `default` on shown+focused, not
`showInactive()`. No FR constrains env-dir focus (FR-003 names `--instance`, FR-004 the
default), and `show:false` + `showInactive()` + stacked `WebContentsView`s crashed on macOS.
See `research.md` R1 / `contracts/window-lifecycle.md`.

`source` is the feature-012 `ResolvedInstance.source`. `--background` outranks `source`:
a `--background` default instance is still hidden.

## `resolveInstance(argv, env, baseUserDataDir) → ResolvedInstance`

Unchanged signature. `ResolvedInstance` gains `background: boolean` (see `data-model.md` §1).
Pure, synchronous, Electron-free — `tests/unit/instance.test.ts` drives it directly.

## Per-situation startup behaviour

| Launch | Window on screen | App/OS focus | macOS Dock + ⌘-Tab | Win/Linux taskbar | FR |
|---|---|---|---|---|---|
| `--instance work --port N --background` | none | unchanged (stays on prior app) | absent | absent | FR-001, FR-002, FR-005 |
| `--instance work --port N` (no `--background`) | visible | unchanged (window not activated) | present | present | FR-003 |
| no flags, no env (`source === "default"`) | visible | HyppoVisor activated / focused | present | present | FR-004, SC-007 |
| `--background` on the default profile (no `--instance`) | none | unchanged | absent | absent | Edge case (allowed) |
| `HYPPO_MCP_STDIO=1 --background` | none | unchanged | absent | absent | Edge case (stdio still runs) |
| platform without a hidden-window state, `--background` | visible but inactive | never focused | n/a | skip-taskbar | FR-006 |

## Summon (re-launch of a running instance)

Not a new flag — re-run the launch with the same `--instance` identity:

```bash
# dev
npx electron . --instance work

# packaged, macOS
open -na HyppoVisor --args --instance work
```

The single-instance lock (feature 012) refuses the second window and fires `second-instance`
in the running process, which reveals + focuses its window (see `window-lifecycle.md`). If
the instance is **not** running, this is just a normal launch of it.

## Launch recipes (documented in `docs/configuration.md`)

```bash
# three quiet instances
npx electron . --instance work    --port 7358 --background
npx electron . --instance client  --port 7359 --background
npx electron . --instance triage  --port 7360 --background

# summon "work" to sign in
npx electron . --instance work

# quit "work" — Ctrl-C in its launching terminal, or Cmd/Ctrl-Q while it is summoned
```
