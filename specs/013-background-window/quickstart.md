# Quickstart: Unobtrusive / Background Window

Validates feature 013. Prereqs: `npm install`, `npm run build`. macOS commands shown; the
mechanism is not macOS-specific.

## 1. Three quiet instances (US1 / SC-001, SC-002)

```bash
npx electron . --instance work   --port 7358 --background
npx electron . --instance triage --port 7359 --background
npx electron . --instance draft  --port 7360 --background
```

Expect:

- **No windows appear.** Whatever app you were in keeps focus; keystrokes are not swallowed.
- No Dock icons (macOS) and no ⌘-Tab entries for HyppoVisor; no taskbar buttons
  (Windows/Linux).
- All three MCP servers answer:

  ```bash
  for p in 7358 7359 7360; do
    curl -s -XPOST 127.0.0.1:$p/mcp -H 'content-type: application/json' \
      -H 'accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' \
      | grep -o '"name":"hyppovisor[^"]*"'
  done
  # → hyppovisor-work / hyppovisor-triage / hyppovisor-draft
  ```

- Point an agent at `hyppovisor-work` and run `open_url`, `read_page`, `interact` (fill),
  `screenshot` — every call behaves exactly as against a visible instance
  (`contracts/launch-flag.md`, per-situation table).

## 2. Summon to sign in, then dismiss (US2 / SC-003)

```bash
# 'work' from step 1 is still running in the background
npx electron . --instance work
```

Expect:

- The **work** window appears in the foreground within ~2 s (Dock icon reappears on macOS).
- Sign into a site, scroll a drafted form, switch tabs — an ordinary HyppoVisor window.
- **Close the window** (red button / Cmd-W). It disappears; `curl` on `7358` still answers —
  the instance returned to the background, it did **not** quit
  (`contracts/window-lifecycle.md`, close interceptor).
- Summoning `work` did nothing to `triage` / `draft` (SC-006-adjacent).

## 3. A named instance doesn't steal focus (US3 / SC-004)

```bash
# start typing in your editor, then, without stopping:
npx electron . --instance client-a --port 7361
```

Expect: the **client-a** window appears but your editor keeps focus and every keystroke you
typed landed in the editor (`win.showInactive()` — `contracts/launch-flag.md` precedence).

```bash
# and the plain default is unchanged:
npx electron .
```

Expect: the default window appears **and takes focus**, exactly as before this feature
(SC-007).

## 4. Quit a background instance (US5 / SC-006)

```bash
# in the terminal that launched 'triage':
Ctrl-C
```

Expect: that process exits; `curl` on `7359` now fails to connect. `work` and `draft` keep
answering. (While summoned, Cmd-Q / Ctrl-Q also quits.)

## 5. Local tests run windowless (US4 / SC-005)

```bash
npm run test:e2e
```

Expect: **no HyppoVisor windows appear** on your screen during the run, and the pass/fail
result matches a run with visible windows — including `screenshot.spec.ts`
(`research.md` R2). If a screenshot assertion fails only under the hidden harness, the
`src/main/page/screenshot.ts` reveal-then-capture fallback (R2) is the fix and the spec is
re-run unchanged.

## Automated checks

```bash
npm test          # unit: instance.ts — --background parsing + composition with --instance/--port/env
npm run test:e2e  # background-window.spec.ts: US1 two hidden instances + MCP; US2 summon + close→background;
                  #                            US3 focus unchanged for a named instance; US5 quit isolates
                  # screenshot.spec.ts: unchanged, now under the --background harness (R2 proof)
npm run build && npm run lint
```

All e2e stays offline (fixture server / loopback only). `background-window.spec.ts` asserts
window state through `app.evaluate(() => BrowserWindow.getAllWindows()[0].isVisible())` and
`BrowserWindow.getFocusedWindow()`, never by looking at the screen.
