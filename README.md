# HyppoVisor

An Electron companion app that opens **any URL you give it** in an embedded browser tab
carrying your own logged-in session, and exposes those tabs to a connected agent over an
embedded **MCP server**.

It retrieves and returns; it never stores page content and never performs an external act
(no form submission, no "apply", no messages). See
[`specs/001-open-any-url/`](specs/001-open-any-url/) for the spec, plan, and tasks, and
[`.specify/memory/constitution.md`](.specify/memory/constitution.md) for the principles that
bound every design decision here.

> **License:** [Apache License 2.0](LICENSE) — a permissive OSI-approved open-source license.
> Free to use, modify, and redistribute, including commercially; keep the `LICENSE` and
> `NOTICE` files with any copy. Contributions are accepted under the same license (Apache-2.0
> §5). A binary release additionally carries a generated `THIRD-PARTY-LICENSES` inventory for
> the bundled dependencies.

## Requirements

- Node 22+ (`.nvmrc` pins 22)
- macOS (primary target; Windows/Linux build but are unverified)

## Build and run standalone

```bash
npm install    # also downloads the Electron runtime binary (postinstall)
npm start      # builds, then launches the app
```

`npm start` re-checks the Electron binary before launching, so a fresh clone
needs nothing beyond these two commands. If your npm skipped the dependency
install script and the binary is still missing, run it once by hand:

```bash
node node_modules/electron/install.js
```

A window opens with a tab strip and an address bar. Type a URL to try it without any agent
attached. Log into any site you want available to later reads — sessions persist in the app's
own profile.

## Connect an agent (MCP)

### Default: HTTP — start the app, then attach an agent

The app is a long-lived thing you set up once; the agent connects to it.

1. **Start HyppoVisor and leave it running:**

   ```bash
   npm start
   ```

   The window opens and its bottom edge shows the address:

   ```
   MCP: http://127.0.0.1:7357/mcp
   ```

2. **Register it with Claude Code (one time):**

   ```bash
   claude mcp add --transport http hyppovisor http://127.0.0.1:7357/mcp
   ```

3. **Verify the connection:**

   ```bash
   claude mcp list          # → hyppovisor  ✓ connected
   ```

   or run `/mcp` inside a session.

4. **Use it.** Log into whatever sites you need in the HyppoVisor window, then in a Claude Code
   session ask the agent to `open_url`, `read_page`, `interact`, and so on. The app keeps
   running across sessions.

#### Configuration

| Env var | Default | Effect |
|---|---|---|
| `HYPPO_MCP_PORT` | `7357` | Port the HTTP server listens on (always bound to `127.0.0.1`) |
| `HYPPO_MCP_TOKEN` | _unset_ | If set, callers must send `Authorization: Bearer <token>`. Add `--header "Authorization: Bearer <token>"` to the `claude mcp add` command. |
| `HYPPO_MCP_STDIO` | _unset_ | Set to `1` to use stdio instead of HTTP (see below) |

Set them inline, e.g. `HYPPO_MCP_PORT=8080 HYPPO_MCP_TOKEN=s3cret npm start`.

> **Security note.** The HTTP transport is a loopback port that can drive whatever you're
> logged into in the app. It is bound to `127.0.0.1` only (never `0.0.0.0`) and can require a
> bearer token, but any process on your machine can still reach it. It is opt-in — you chose to
> run the app. If that posture doesn't suit you, use stdio, which opens no socket. The tool
> set, blocklist, and audit log are identical on both transports.

### Alternative: stdio — the client spawns the app

No open port; the app starts and stops with the session. It must run under `electron`, not
`node` (the main process needs the Electron runtime):

```bash
claude mcp add hyppovisor -e HYPPO_MCP_STDIO=1 -- \
  /absolute/path/to/node_modules/.bin/electron /absolute/path/to/dist/main/index.js
```

Build first (`npm run build`) so `dist/main/index.js` exists. You cannot attach to an
already-running instance this way — the client owns the process lifecycle.

### Tools

In a session, the agent can call:

| Tool | Purpose |
|---|---|
| `open_url` | Open an http(s) URL in a new tab |
| `list_open_tabs` | List open tabs (id, URL, title, load state) |
| `read_page` | Return one tab's verbatim visible text; DOM only when asked. Nothing is stored. |
| `read_form_fields` | Return the tab's form controls in document order — selector, kind, verbatim label, current value (omitted for credentials), `<select>`/combobox options, and the `fill` / `click` verdict `interact` would give each. Read-only, derived view; `read_page` is unchanged. |
| `navigate` | Point an existing tab at a new URL |
| `interact` | `click` / `fill` / `scroll` / `space` — reveal content and prepare a draft; never submit, send, apply, or press Enter. `fill` also takes a batch form (an ordered `fields` list, max 50) that drafts a whole form in one call |
| `wait_for_selector` | Wait for an element, up to a timeout |

Full contract: [`specs/001-open-any-url/contracts/mcp-tools.md`](specs/001-open-any-url/contracts/mcp-tools.md).

### What the app will not do

No tool submits a form, enters credentials, or accepts a download. `interact` refuses, with a
named rule (`REFUSED_EXTERNAL_ACT`), any target that would perform an external act:

- **submit controls** — a `<button>`/`<input>` that submits a form (refused for `click` and
  `space`)
- **clicking anything inside a `<form>`** — `click` on a form control is refused; `fill`ing a
  value into a plain field is **not** (see below), and `space` is gated by the rules here,
  not by the form boundary
- **buttons or links labelled** save, confirm, submit, apply, send, delete, remove, connect,
  message, subscribe, pay, checkout, or **log in / sign in / sign up / register**
- **consent checkboxes / switches** labelled accept, agree, consent, terms, privacy, opt in,
  subscribe (the label is read even when it's a separate `<label for>` element; refused for
  `click` and `space`)
- **credential inputs** (`fill` or `space` on a password / one-time-code field)
- **the Enter key** — never available on any operation (it can trigger an implicit submit)

`fill` **is** allowed to type a value into a plain, non-credential, non-consent field
(`text` / `email` / `tel` / `url` / `search` / `number`, `<textarea>`, `contenteditable`),
including one inside a `<form>` and the filter input of a combobox — this prepares a draft
the human reviews and submits. It stays refused on `<input type="file">`, `<select>`, a
listbox, and a combobox container. `fill` can also carry an ordered `fields` list (up to 50
`{ selector, value }` pairs) applied in one call, under the **same** rules — every target is
checked first and one forbidden or unresolved target refuses the whole batch with nothing
written; after that check writing is best-effort, so a field whose element vanished mid-write
is reported and the rest still fill. The batch adds no new permission and never submits.
`space` activates the focused element (a plain checkbox, a highlighted listbox option, a
non-submit button) under exactly the rules above; it inserts a single space when a text field
has focus and can never submit.

The blocklist is defined in one file (`src/main/safety/blocklist.ts`) and is enumerable. It
permits by default, so every interaction — permitted or refused — is appended to
`interaction-log.jsonl` in the app's `userData` directory (never the shared data directory,
never page text), which is what makes an unanticipated external act detectable after the fact.

`read_form_fields` only *reports* these verdicts (`fillVerdict` / `clickVerdict` per control),
computed from the same blocklist; it acts on nothing, writes nothing, and adds no audit-log
entry.

## Tests

```bash
npm test        # Vitest — url policy, action queue, blocklist, truncation (pure logic)
npm run test:e2e   # Playwright _electron — real app against local fixture pages, offline
```

The e2e suite requires the Electron binary to be installed (`npm install` fetches it) and a
display; it drives a real app instance through the same code paths the MCP tools use.
