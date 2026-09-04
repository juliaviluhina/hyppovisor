# Phase 1 Data Model: Read Page Reduction Hardening

This feature adds no new entity and changes no field's type. The one entity it touches is the
existing `read_page` response shape, whose *behavior* (not shape) two of the four fixes
correct.

## `PageReadResult` (`src/shared/types.ts`)

Unchanged shape (as of feature 017):

| Field | Type | Notes |
|---|---|---|
| `tabId` | `string` | unchanged |
| `url` | `string` | unchanged |
| `title` | `string` | unchanged |
| `text` | `string` | unchanged — always computed from the original, unreduced element; unaffected by this feature (FR-010) |
| `dom` | `string`, optional | present only when `includeDom: true`. FR-001/FR-002 change what this string contains when the selected root itself matches a removal target: previously the root's own markup leaked through unstripped; now it is stripped (or the whole value becomes `""` if the root is itself the only removable node — the same empty-string convention removal already produces for a fully-emptied non-root case). |
| `observedAt` | `string` | unchanged |
| `truncated.text` | `boolean` | unchanged |
| `truncated.dom` | `boolean` | unchanged — still applies to whichever string (reduced or verbatim) was produced, now proven for the reduced case by FR-008's test |
| `queueDepth` | `number` | unchanged |
| `scopedTo` | `string`, optional | unchanged (feature 016) |
| `domReduced` | `boolean`, optional | unchanged — present and `true` only when `dom` is present and reduction was applied, including the new root-removal case |

No new field is introduced. FR-009/FR-010 change *when work is performed* to produce this
shape (skipped entirely when `includeDom` is `false`), not the shape's fields or their
meaning — a text-only response is byte-for-byte identical to today's, only cheaper to produce.

## State / lifecycle

None. `read_page` remains a stateless, per-request read (Principle V) — this feature does not
introduce any state that persists between calls.

## Validation rules

Unchanged. `reduceDom` and `includeDom` remain plain optional booleans validated by the
existing MCP schema layer (`src/main/mcp/tools.ts`); this feature introduces no new parameter
and no new validation rule.
