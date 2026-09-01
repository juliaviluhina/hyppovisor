# Quickstart: Run More Than One HyppoVisor

Validates feature 012. Prereqs: `npm install`, `npm run build`. macOS commands shown; the
mechanism is not macOS-specific.

## 1. Two instances, side by side (US1 / SC-001, SC-002, SC-005)

```bash
# terminal A — the default instance
npm start

# terminal B — a second, named instance (no rebuild needed)
npx electron . --instance work --port 7358
```

Expect:

- Two windows. Terminal B's title bar reads **`HyppoVisor — work`**; terminal A's reads
  **`HyppoVisor`**.
- Terminal B's data is under `~/Library/Application Support/hyppovisor/instances/work/`
  (`ls` it after the window opens — `settings.json` appears once you change a setting).
  Terminal A's stays in `~/Library/Application Support/hyppovisor/`.
- Both MCP servers answer:

  ```bash
  curl -s -XPOST 127.0.0.1:7357/mcp -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' | grep -o '"name":"[^"]*"'
  # → "name":"hyppovisor"  (default)   ... and 7358 → "name":"hyppovisor-work"
  ```

- Open the **Connection & MCP** panel in each: the header shows `work` on the second; its
  `claude mcp add` snippet reads `... hyppovisor-work http://127.0.0.1:7358/mcp`.
- Drive one instance (open a URL, fill a field) while reading pages in the other — neither
  call waits on the other; each `interaction-log.jsonl` records only its own actions.

## 2. Shared-profile guard (US2 / SC-003)

```bash
npm start                 # default instance running
npx electron .            # second launch, same (default) profile
```

Expect: the second process shows a dialog — *"Another HyppoVisor is already using this
profile…"* — and **exits without opening a window**. The first window comes to the front.
A launch with `--instance <name>` (different profile) starts normally.

## 3. Port-in-use state (US3 / SC-004)

```bash
# occupy 7358
node -e 'require("net").createServer().listen(7358,"127.0.0.1")' &
npx electron . --instance work --port 7358
```

Expect: the window opens and the browser works. The panel shows a red line — *"Port 7358 is
in use — another HyppoVisor instance? Change the port below and Apply…"*. It never binds a
different port on its own. Set the port to a free value in the panel and **Apply** → the
line clears, the endpoint updates, an agent can connect — no restart.

```bash
kill %1   # free 7358 again
```

## 4. Default instance unchanged (SC-007)

```bash
npm start        # no flags, no HYPPO_* env
```

Title is the bare `HyppoVisor`; panel header shows no label; the `claude mcp add` snippet
uses `hyppovisor`; `settings.json` / `recent-urls.json` / `interaction-log.jsonl` are in
the same directory as before this feature.

## 5. Docs (US5 / SC-008)

- `docs/configuration.md` describes `HYPPO_USER_DATA_DIR` as an **override** (not "test
  isolation"), states the precedence (env → `--instance`/`--port` → persisted → default),
  and has a **"Run more than one HyppoVisor"** section with the recipes above and the
  "never share a profile directory" warning.
- `docs/connect-an-agent.md` mentions the `hyppovisor-<name>` server name.

## Automated checks

```bash
npm test          # unit: instance.ts (precedence, validation, label, classifyListenError);
                  #       connection-snippets serverName cases
npm run test:e2e  # multi-instance.spec.ts: US1 two instances + handshake names + titles,
                  #       US3 port-unavailable → recover, US2 second launch opens no window
npm run build && npm run lint
```

All e2e stays offline (fixture server / loopback only); the `instances/<name>/` path
derivation is proven in unit tests so the suite never writes under the real app-support
directory.
