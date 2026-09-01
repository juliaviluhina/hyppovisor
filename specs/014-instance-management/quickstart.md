# Quickstart: Local Instance Management Panel

Validates feature 014. Prereqs: `npm install`, `npm run build`. macOS commands shown; the
mechanism is not macOS-specific (see `contracts/instance-shutdown.md` for the Windows
note).

The Instances list and the "Close all tabs" button are new sections in the connection
panel — click the hippo button (top-right of the window) to open it.

---

## 1. See every running instance (US1 / SC-001, FR-001–FR-003)

```bash
npx electron . --instance acme    --port 7358
npx electron . --instance contoso --port 7359
npx electron . --instance initech --port 7360 --background
```

In the `acme` window, open the panel → **Instances** section. Expect within ~3 s:

| Instance | Port | Mode | State | Closable |
|---|---|---|---|---|
| acme *(this instance)* | 7358 | foreground | responding | no — hint "the instance you're viewing" |
| contoso | 7359 | foreground | responding | yes |
| initech | 7360 | background | responding | yes |

- The list refreshes on its own every ~2 s (`config.instancePollMs`).
- Open the panel in the **background** instance too (summon it first:
  `npx electron . --instance initech`) — it lists the same three, with `initech` now marked
  *(this instance)* and non-closable.

Under the hood: `cat "$HOME/Library/Application Support/hyppovisor/instances/acme/runtime.json"`
→ `{ "schema":1, "pid":…, "port":7358, "mode":"foreground", "label":"acme", "startedAt":… }`.

---

## 2. Shut down another instance from the panel (US1 / SC-002, SC-003, FR-004, FR-006)

In the `acme` panel, click **Close** on the `initech` row → confirm modal:

> Close instance "initech" on port 7360? Its open tabs and any in-progress work are lost.
> This can't be undone.  &nbsp; **[ Cancel ]  [ Close instance ]**

Click **Close instance**. Expect:

- `initech`'s process exits (its `runtime.json` is gone) and port 7360 stops answering
  within 10 s:
  ```bash
  curl -s -m2 -XPOST 127.0.0.1:7360/mcp -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' ; echo "exit=$?"
  # → connection refused (exit=7)
  ```
- The `initech` row disappears from the panel here **and** in the `contoso` panel within
  ~5 s (SC-005).
- `acme` and `contoso` are untouched — still listed, still serving.

Kill an instance from outside the panel (`kill <pid>` of `contoso`, or just close its
window) → its row drops on the next poll (FR-007, US1 scenario 4).

---

## 3. The current instance can't be closed (SC-004, FR-005)

In any panel, the *(this instance)* row has its Close control `disabled`. There is no
code path from it to `chrome:close-instance`, and `main` additionally refuses
`pid === process.pid` with `{ ok:false, error:"can't close the current instance" }`.

---

## 4. Close all tabs (US2 / SC-006, FR-011–FR-013)

In one instance, open several tabs (address bar, or an agent):

```bash
for u in https://example.com https://example.org https://example.net; do :; done
# …or just type three URLs into the address bar
```

Panel → **Tabs** section → **Close all tabs**. Expect:

- Every content tab closes; the tab strip is empty (the freshly-launched state).
- Inline notice: *"Closed 3 tabs."*
- The instance is still running: the panel's Endpoint / snippets are unchanged, and
  ```bash
  curl -s -XPOST 127.0.0.1:<port>/mcp -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' \
    | grep -o '"name":"hyppovisor[^"]*"'
  ```
  still returns the server name. MCP `list_open_tabs` → `[]`.
- `settings.json` is byte-unchanged; a site you had logged into is still logged in when you
  reopen it (session store is not per-tab).
- With no tabs open, **Close all tabs** is `disabled` (FR-013 no-op).

---

## 5. Automated checks

```bash
npm test -- instances-registry          # unit: parse / staleness / enumerate / SIGTERM→SIGKILL
npm run test:e2e -- instance-management  # US1 + edge cases + SC-001/003/004/005
npm run test:e2e -- close-all-tabs       # US2 + SC-006
```

---

## 6. Constitution gate (FR-014)

US1 requires the Principle III amendment (1.4.2 → 1.5.0) to be in
`.specify/memory/constitution.md` before it ships — run `/speckit-constitution` or hand-edit
per `plan.md`. US2 (section 4 above) does not depend on it.
