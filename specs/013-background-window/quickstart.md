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

- Point an agent at `hyppovisor-work` and run `open_url`, `read_page`, `read_form_fields`,
  `interact` (fill) — every call behaves exactly as against a visible instance
  (`contracts/launch-flag.md`, per-situation table).
- `screenshot` is the **one exception**: a never-shown window has no rendered surface, so it
  returns `SCREENSHOT_FAILED` naming the fix. Summon the window (step 2) or run without
  `--background` to capture. Every other tool is unaffected. (`research.md` R2 — as built.)

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

Expect: **almost no HyppoVisor windows appear** during the run. Three specs keep a visible
window: `recent-urls.spec.ts` (drives the address bar through the renderer) and
`screenshot.spec.ts` (`capturePage` needs a rendered surface) both opt out via
`--no-background` / `{ background: false }`, and `auth-popup.spec.ts` opens the OAuth child
window. Everything else is windowless. Pass/fail matches a visible run.

> `screenshot` on a real standalone `--background` instance returns `SCREENSHOT_FAILED` — a
> never-shown window has no compositor surface (and on headless CI the capture hangs the
> renderer). `screenshot.spec.ts` therefore runs with a visible window. See `research.md` R2
> (as built) and step 1's screenshot note.

## Automated checks

```bash
npm test          # unit: instance.ts — --background parsing + composition with --instance/--port/env
npm run test:e2e  # background-window.spec.ts: US1 two hidden instances + MCP + open/read/fill;
                  #                            US2 summon + close→background; US3 named instance no focus;
                  #                            US5 quit isolates
                  # screenshot.spec.ts: runs with a VISIBLE window ({ background: false }) — capture
                  #                     needs a surface; standalone --background returns SCREENSHOT_FAILED (R2)
npm run build && npm run lint
```

All e2e stays offline (fixture server / loopback only). `background-window.spec.ts` asserts
window state through `app.evaluate(() => BrowserWindow.getAllWindows()[0].isVisible())` and
`BrowserWindow.getFocusedWindow()`, never by looking at the screen.
