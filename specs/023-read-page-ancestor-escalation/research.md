# Research: Read Page Ancestor Escalation and Exclusion

## R1 — Effective-root resolution

**Decision**: Resolve the first `selector` match, then follow `parentElement` up to
`ancestorLevels` times, stopping at the highest available element. `ancestorLevels: 0` preserves
the existing match root; no selector keeps the existing document-root path unchanged.

**Rationale**: This reuses the established first-match convention and makes conservative levels
safe across pages with different wrapper depth.

## R2 — Exclusion semantics

**Decision**: Clone the effective root, query each exclusion selector inside the clone, remove all
matching descendants, and serialize text/DOM from the clone. A selector matching the root itself
is rejected; no matches are no-ops. Invalid selectors use the existing invalid-selector pathway.

**Rationale**: Cloning prevents live-page mutation and makes text and DOM agree. Querying within
the clone naturally bounds exclusions to the selected root.

## R3 — Public shape and compatibility

**Decision**: Add optional request fields `ancestorLevels?: number` and `exclude?: string[]` and
optional result metadata `scope?: { selector?: string; requestedAncestorLevels?: number;
effectiveAncestorLevels?: number; exclusions?: string[] }`. Reject ancestor levels without a
selector at the MCP boundary. Keep `scopedTo` for compatibility.

## R4 — Reduction and truncation order

**Decision**: Exclude before text extraction and before optional DOM reduction; apply existing byte
truncation after serialization. `reduceDom: false` remains the opt-out for un-reduced retained DOM.
