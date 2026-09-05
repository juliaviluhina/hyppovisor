# Data Model: Read Page Ancestor Escalation and Exclusion

No persisted entities are introduced. Reads remain transient.

## Request additions

| Field | Type | Default | Rules |
|---|---|---|---|
| `ancestorLevels` | non-negative integer | `0` | Requires `selector`; clamped at document root. |
| `exclude` | string array | `[]` | CSS selectors inside effective root; invalid selectors fail; no match is a no-op. |

## Result additions

`PageReadResult.scope` is present when `selector`, `ancestorLevels`, or `exclude` was supplied.

| Field | Type | Meaning |
|---|---|---|
| `selector` | string, optional | Original scope selector. |
| `requestedAncestorLevels` | number, optional | Caller-requested climb count. |
| `effectiveAncestorLevels` | number, optional | Actual climb count after root clamping. |
| `exclusions` | string array, optional | Exclusion selectors in request order. |

Existing `scopedTo` and `domReduced` fields remain unchanged.
