# `read_page` Contract Extension

The MCP tool accepts `selector?: string`, `reduceDom?: boolean`,
`ancestorLevels?: non-negative integer`, and `exclude?: string[]`.

`ancestorLevels` requires `selector`. The first selector match is resolved, then the effective
root is climbed. Exclusions are CSS selectors scoped to that root and remove matching descendant
subtrees from both `text` and `dom`. Invalid CSS produces `INVALID_SELECTOR`; an empty match is a
no-op; excluding the effective root produces a target error.

When any new scope input is supplied, the response includes `scope` with the supplied selector,
requested/effective levels, and exclusions. Existing fields and behavior are unchanged when the
new inputs are omitted.
