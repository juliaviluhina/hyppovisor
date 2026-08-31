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

## Publishing a release

Releases are cut by pushing a `v*` tag. `.github/workflows/release.yml` then runs
lint + unit tests, builds the unsigned macOS `.dmg` + `.zip` for `arm64` and
`x64` on native runners, and attaches all four to a GitHub Release.

```bash
git checkout main && git pull

# Bump the version — commits package.json + package-lock.json and creates the tag.
npm version patch            # or: minor / major

git push --follow-tags       # pushes the commit and the vX.Y.Z tag
```

If `main` is protected against direct pushes, open the version-bump commit as a
PR, merge it, then push just the tag:

```bash
git tag -a vX.Y.Z -m "HyppoVisor vX.Y.Z" <merge-commit-sha>
git push origin vX.Y.Z
```

The tag must equal `v` + `package.json`'s `version` — the workflow's `verify`
job fails the release otherwise.

- **Watch it**: the repo's **Actions → Release** run.
- **Dry run**: trigger the workflow manually (**Run workflow**) — it builds the
  artifacts and leaves them on the run page without creating a Release.
- **Staging**: set `draft: false` → `true` in the workflow to hold releases for
  review before they go public.
- The build is **unsigned / un-notarized** — the Release notes carry the
  Gatekeeper steps. Signing is a separate follow-up.

Full packaging detail — the license gate, the LGPL `libffmpeg.dylib` swap,
building locally — is in [PACKAGING.md](../PACKAGING.md).
