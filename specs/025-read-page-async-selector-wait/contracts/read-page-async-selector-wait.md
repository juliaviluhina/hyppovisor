# `read_page` Contract Extension

The MCP tool adds `waitForSelector?: boolean` and `timeoutMs?: positive integer` to its existing
input. `waitForSelector` requires `selector`. When enabled, the tool waits for DOM presence of the
CSS selector in the selected tab. Omitted `timeoutMs` uses `config.defaultWaitMs` (10,000 ms by
default, controlled by `HYPPO_DEFAULT_WAIT_MS`).

Invalid CSS fails immediately with `INVALID_SELECTOR`. If the valid selector does not appear in
time, the tool returns a distinct timeout error containing selector and timeout. It never returns
an unscoped or exclude-only payload after a positive-selector failure.

Once present, the existing scoped read runs unchanged: text, optional DOM, reduction,
ancestor/exclusion behavior, truncation, metadata, and response fields are preserved. Omitting the
wait option preserves immediate behavior. Exclude-only and unscoped reads remain available, but
exclude-only reads are not a privacy guarantee for authenticated pages.
