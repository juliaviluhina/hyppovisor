# Tools

Eight MCP tools. No others. Every call goes through one action queue; every
error returns a named code.

| Tool | Purpose |
|---|---|
| `open_url` | Open an http(s) URL in a new tab. |
| `list_open_tabs` | List open tabs: id, URL, title, load state. |
| `navigate` | Point an existing tab at a new URL. |
| `read_page` | One tab's verbatim visible text; DOM only when asked. Nothing stored. |
| `read_form_fields` | Read-only view of a tab's form controls (see below). |
| `interact` | One bounded action: `click` / `fill` / `scroll` / `space` / `choose_option` / `list_options`. Never submits. |
| `wait_for_selector` | Wait for an element, up to a timeout. |
| `screenshot` | Picture of a tab — viewport, element clip, or full page. JPEG, ≤256 KB, inline, never written to disk. |

Full contract:
[`specs/001-open-any-url/contracts/mcp-tools.md`](../specs/001-open-any-url/contracts/mcp-tools.md).

## read_form_fields

Form controls in document order. Per control: selector, kind, verbatim label,
current value (omitted for credentials), `<select>` / combobox options, the
`fill` / `click` / `choose` verdict `interact` would give, an `operation` hint,
and `maxLength` / `pattern` / `inputMode` where declared.

Bounded by a `fields` projection, `only: "required-unfilled"`, and a 64 KB byte
budget. Derived and read-only — it acts on nothing and writes no audit entry.
`read_page` is unaffected.

## interact

- **`fill`** — type a value into a plain field (`text` / `email` / `tel` / `url`
  / `search` / `number`, `<textarea>`, `contenteditable`), including inside a
  `<form>` and a combobox filter input. Also takes an ordered `fields` batch
  (max 50) that drafts a whole form in one call under the same rules. Prepares a
  draft; never submits.
- **`choose_option`** — select one option in a `<select>` or combobox by exact
  `label` / `value` (no fuzzy, no creation), then re-read to confirm it stuck.
- **`list_options`** — list a dropdown's choices, read-only.
- **`click` / `space`** — reveal content, toggle non-outward controls.

What it refuses, and the exact nuances: [Safety](safety.md).
