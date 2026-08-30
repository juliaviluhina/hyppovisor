---
name: "commit-message"
description: "Write a commit message for the staged (or given) changes using this repo's prefix convention. Use whenever asked to commit or to draft a commit message."
argument-hint: "Optional: what the change is, or a commit SHA/range to describe"
user-invocable: true
disable-model-invocation: false
---

# Commit message

Produce a commit message for the change under discussion. If nothing is staged and no
target was given, run `git diff` / `git status` first to see what's being committed.

## Format

```
<prefix>: <summary>

<body — why the change was made, wrapped at ~72 cols>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: <session url>
```

- **Subject line**: `<prefix>: <summary>` — lowercase prefix, one space after the colon,
  imperative mood ("add", not "added"), no trailing period, aim for ≤ 70 chars.
- Optional scope: `<prefix>(<scope>): <summary>` where scope is a feature number (`001`) or
  a short area name (`mcp`, `blocklist`). Use it only when it adds clarity.
- **Body**: present when the change isn't self-explanatory. Explain *why* and any tradeoff
  or rejected alternative — the diff already shows *what*. Bullet lists are fine. Skip the
  body for trivial changes (typo, formatting, version bump).
- **Footer**: keep the `Co-Authored-By` and `Claude-Session` lines the repo already uses on
  every commit (copy them from a recent `git log` entry).

## Prefixes

**Work type**

| Prefix | Use for |
|---|---|
| `feat` | a new user-facing capability, tool, or behavior |
| `fix` | a bug fix |
| `refactor` | restructuring that preserves behavior |
| `perf` | a performance improvement |
| `test` | tests only, no product-code change |
| `build` | build system, dependencies, tooling, scripts, CI |
| `docs` | README, code comments, doc files |
| `chore` | housekeeping — `.gitignore`, formatting, renames, config |
| `license` | `LICENSE` / `NOTICE` / licensing metadata |

**Spec Kit phase** (this repo runs Spec Kit; use these for `specs/` and `.specify/` work)

| Prefix | Use for |
|---|---|
| `spec` | `spec.md` — create or clarify |
| `plan` | `plan.md`, `research.md`, `data-model.md`, `contracts/` |
| `tasks` | `tasks.md` |
| `constitution` | `.specify/memory/constitution.md` |

Pick the single prefix that best describes the change's primary purpose. If a commit
genuinely spans two types, it should probably be two commits; if it can't be split, choose
the type a reviewer cares about most (usually `feat`/`fix` over `test`/`docs`).

## Examples from this repo

```
feat: HTTP MCP transport so the app can run first, agent connects to it
fix: force a real Electron download past a broken partial dist
constitution: amend to v1.1.0 (reassign raw-capture obligation)
spec: clarify feature 001 (5 decisions recorded)
license: relicense from PolyForm Noncommercial 1.0.0 to Apache-2.0
```

## Steps

1. Determine the change (staged diff, named files, or a SHA/range).
2. Choose the one prefix, and a scope only if it helps.
3. Write the subject line.
4. Add a body if the change needs a "why"; keep it to what a reviewer needs.
5. Append the standard footer lines.
6. Output the message in a fenced block ready to paste, or commit it if asked to commit.
