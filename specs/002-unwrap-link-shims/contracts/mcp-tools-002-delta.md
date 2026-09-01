# MCP Tools — feature 002 delta

Baseline: the feature-001 contract (`specs/001-open-any-url/contracts/mcp-tools.md`). No
tool is added or removed; no parameter changes; no new error code.

---

## `open_url`

### Description

Was:

> Open an http(s) URL in a new embedded tab using the person's existing session. Does not
> log in, submit, or follow links on its own.

Now:

> Open an http(s) URL in a new embedded tab using the person's existing session. Does not
> log in or submit. Resolves a known redirect-interstitial / link-shim URL (LinkedIn
> `/safety/go/`, Google `/url`, Facebook `/l.php`, Reddit `out.reddit.com`, Outlook Safe
> Links) to the `http(s)` destination carried in its query parameter and opens that
> directly; every other URL opens verbatim.

### Behaviour

- Before validation and loading, the input URL is passed through link-shim resolution
  (feature 002). If it matches a known shim (host + path prefix) and the named parameter
  holds an absolute `http(s)` URL, that destination is opened instead — following a
  shim-wrapping-a-shim up to 3 hops.
- A shim whose extracted destination is not `http(s)` (e.g. `javascript:`, `data:`,
  `mailto:`), is unparseable, or is absent/empty → the wrapper URL is opened verbatim.
- A URL whose host is not a known shim, or is a known shim host but the path/param does not
  match → opened verbatim, even if it carries a `url` / `q` / `u` parameter.
- **Returns** the same shape as before. On a resolved shim the returned `url` is the
  destination the tab landed on, not the wrapper.

---

## `navigate`

Identical link-shim resolution as `open_url`, applied to the target URL before the existing
tab is pointed at it. Same fall-through rules, same 3-hop cap. Description gains the same
"resolves known link-shim URLs" sentence.

---

## Interaction audit log

New entry type (feature 002), written **only** when a shim resolution changed the opened
URL:

```jsonc
{
  "operation": "unwrap",
  "url":     "<the original wrapper URL>",
  "target":  "<the final resolved destination URL>",
  "outcome": "permitted",
  "ruleId":  null,
  "error":   null,
  "unwrap":  { "hops": <1..3> }
}
```

`open_url` / `navigate` continue to write **no** audit entry for an ordinary navigation
(no shim, or nothing to unwrap). This feature does not introduce general navigation
logging.

---

## Enumeration

`listShimRules()` (main-process accessor, exposed to tests like `listBlocklistRules()`)
returns the recognized shim set as `{ id, pathPrefix, param }[]`. Not part of the MCP tool
surface; it is the "one enumerable table" Principle III asks for.
