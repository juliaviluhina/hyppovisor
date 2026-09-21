# Quickstart: Copy Instance Settings

**Feature**: `028-copy-instance-settings` | **Date**: 2026-09-21

Validation guide proving the feature works end-to-end. Shapes: [contract](contracts/instance-settings-copy.md), [data model](data-model.md).

## Prerequisites

- HyppoVisor built from branch `028-copy-instance-settings` (`npm run build`).
- Two instances: `open -na HyppoVisor --args --instance vis --port 7357` (visible) and `--instance hid --port 7358 --background` (hidden), both with token auth on.

## Scenario 1 — Copy a background instance's settings (P1)

1. In `vis`, open the instance list; find the `hid` row.
2. Copy the command block; run it verbatim in a terminal (distinct client name scope if `hid` is already registered elsewhere).
3. Expect: the new client entry lists `hid`'s tabs (SC-001) — verified by `hid`-only tab titles.
4. Copy the JSON block into a JSON-based client; expect the same (paste-equivalence).

## Scenario 2 — Every row copies correctly (P2)

1. With `vis`, `hid`, and one more foreground instance running, copy both formats from each row.
2. Expect: 3 distinct server names/ports, each reaching its own instance (SC-002); `vis`'s own row matches its Connection & MCP panel byte-for-byte.

## Scenario 3 — Unreachable honesty (P3)

1. `kill` the `hid` process (no cleanup); re-open the list in `vis`.
2. Expect: `hid` reads unreachable with last-known blocks marked as such; using them fails fast (SC-003).
3. `chmod 000` a sibling profile mid-list (then restore); expect a settings-unavailable row with no copy action, list otherwise intact.

## Scenario 4 — No side effects

1. Snapshot all profiles' `settings.json` + `runtime.json` checksums before and after listing + copying every row.
2. Expect: identical checksums (SC-004).

## Commands

```bash
npm test          # unit incl. new settings-copy tests — $0, offline
npx playwright test instance-settings-copy  # e2e two-instance proof
```
