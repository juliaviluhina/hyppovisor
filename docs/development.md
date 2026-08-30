# Development

## Process

Spec-Driven Development with [GitHub Spec Kit](https://github.com/github/spec-kit).
Each feature starts as a spec, plan, and task list before code:

- `.specify/` — templates, scripts, and the [constitution](../.specify/memory/constitution.md)
  that bounds every design decision
- `specs/NNN-name/` — per-feature `spec.md`, `plan.md`, `research.md`, `tasks.md`,
  and `contracts/`
- Slash commands drive it: `/speckit-specify` → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-implement` (plus `/speckit-clarify`,
  `/speckit-analyze`, `/speckit-checklist`)

## Commands

```bash
npm test         # Vitest — pure logic: url policy, action queue, blocklist, truncation
npm run test:e2e # Playwright _electron — real app vs local fixture pages, offline
npm run lint
npm run format
```

The e2e suite needs the Electron binary (`npm install` fetches it) and a
display. It drives a real app instance through the same code paths the MCP tools
use.
