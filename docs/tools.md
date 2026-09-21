# Tools

Nine MCP tools. No others. Every call goes through one action queue; every
error returns a named code.

| Tool | Purpose |
|---|---|
| `open_url` | Open an http(s) URL in a new tab. Resolves known link-shim / redirect-interstitial URLs first (see below). |
| `list_open_tabs` | List open tabs: id, URL, title, load state. |
| `navigate` | Point an existing tab at a new URL. Same link-shim resolution as `open_url`. |
| `read_page` | One tab's verbatim visible text; DOM only when asked. Nothing stored. |
| `read_form_fields` | Read-only view of a tab's form controls (see below). |
| `read_actionable` | Read-only snapshot: indexed table of actionable elements plus budgeted visible text in one call; optional Jev relevance ranking when a `goal` is passed (see below). |
| `interact` | One bounded action: `click` / `fill` / `scroll` / `space` / `choose_option` / `list_options`. Never submits. |
| `wait_for_selector` | Wait for an element, up to a timeout. |
| `screenshot` | Picture of a tab — viewport, element clip, or full page. JPEG, ≤256 KB, inline, never written to disk. Needs a visible window: on a `--background` instance it returns `SCREENSHOT_FAILED` (every other tool still works). |

Full contract:
[`specs/001-open-any-url/contracts/mcp-tools.md`](../specs/001-open-any-url/contracts/mcp-tools.md).

## Link-shim resolution

`open_url` and `navigate` recognize five redirect-interstitial families and open the
`http(s)` destination the wrapper carries, so an agent never stalls at a "Continue" button
the blocklist refuses: LinkedIn `/safety/go/?url=`, Google `/url?q=` (all regional
domains), Facebook `l.facebook.com/l.php?u=`, Reddit `out.reddit.com/?url=`, Outlook Safe
Links `*.safelinks.protection.outlook.com/?url=`. A shim wrapping a shim resolves through,
up to 3 hops. Everything else — any other host, a non-matching path, an absent parameter,
or a destination that is not `http(s)` — opens verbatim. It is a pure string transform: no
network request, no page read. Each resolution that changes the opened URL writes one
`operation: "unwrap"` line to the interaction audit log.

## read_form_fields

Form controls in document order. Per control: selector, kind, verbatim label,
current value (omitted for credentials), `<select>` / combobox options, the
`fill` / `click` / `choose` verdict `interact` would give, an `operation` hint,
and `maxLength` / `pattern` / `inputMode` where declared.

Bounded by a `fields` projection, `only: "required-unfilled"`, and a 64 KB byte
budget. Derived and read-only — it acts on nothing and writes no audit entry.
The default record is lean (selector, kind, label, value, required, operation,
verdicts); `includeNonInteractive: true` adds the diagnostic fields
(`selectorSynthesised`, `duplicateId`, `optionsAvailable`, `optionsTruncated`)
and every record's `options`. Verdicts are computed after the DOM settles, so a
re-read of an unchanged page returns the same verdict. `read_page` is unaffected.

## read_actionable

One tab's actionable elements as an indexed table plus its meaningful visible
text, from a single atomic capture. Per entry: snapshot-scoped `index`, `role`,
verbatim `label`, current `value` (omitted for credentials), an `actionable` /
`refused` marker, and the `operations` `interact` could use. Credential,
file-upload, consent, and submit controls are listed with `refused` markers —
listed so the agent can see why a visible control has no usable entry, never
usable. Hidden, disabled, offscreen, and decorative nodes are excluded and
counted in `omissions`, alongside over-budget drops and text truncation —
never silent.

Derived and read-only — it acts on nothing and writes no audit entry. Indices
are valid for the snapshot's `generation` only; using one after the page
changes fails stale rather than applying elsewhere.

With `goal`, the same call adds Jev relevance `ranking` (ordering with
per-candidate probabilities and confidence) — advisory only. Ranking needs the
user's `TYPESAFE_API_KEY`; when ranking is unavailable the snapshot still
returns with an explicit `rankingStatus` (`unavailable-missing-key` /
`unavailable-request-failure`), never an error.

## interact

- **`fill`** — type a value into a plain field (`text` / `email` / `tel` / `url`
  / `search` / `number`, `<textarea>`, `contenteditable`), including inside a
  `<form>` and a combobox filter input. Types character by character with real
  key events so an input mask receives it, then reads the value back: a permitted
  `fill` returns `currentValue`; a well-formed value the page would not accept is
  `WRITE_NOT_APPLIED` (not a refusal), and the field was not filled. Also takes
  an ordered `fields` batch (max 50) that drafts a whole form in one call under
  the same rules. Prepares a draft; never submits.
- **`choose_option`** — select one option in a `<select>` or combobox by exact
  `label` / `value` (no fuzzy, no creation), then re-read to confirm it stuck.
- **`list_options`** — list a dropdown's choices, read-only.
- **`click` / `space`** — reveal content, toggle non-outward controls. Since
  constitution 1.4.0 a `click` on a non-submit in-form `<button type="button">`
  (no `formaction`, own label not an outward act) is permitted, to expand a
  repeatable sub-form.

What it refuses, and the exact nuances: [Safety](safety.md).
