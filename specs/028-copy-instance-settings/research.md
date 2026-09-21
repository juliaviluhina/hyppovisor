# Research: Copy Instance Settings

**Feature**: `028-copy-instance-settings` | **Date**: 2026-09-21

All Technical Context unknowns are resolved below. Each entry records Decision / Rationale / Alternatives.

## R1. Data sources for a sibling row's settings

- **Decision**: Two existing per-profile files, read at display time: `<profile>/runtime.json` (effective port, mode, label, liveness input — feature 014) and `<profile>/settings.json` (`tokenRequired`, `token` — feature 007 shape). No new files, no new channel, no MCP call to the sibling.
- **Rationale**: The sibling's token is obtainable no other way (an MCP query would need the token first — circular). Same-user file ownership already gates access; unreadable files degrade to a row without copy per clarify Q2.
- **Alternatives considered**: Querying the sibling over unauthenticated loopback (rejected — the MCP port requires the bearer token when auth is on, and bypassing auth locally would weaken the security posture); a shared index/daemon (rejected — violates Principle III and the 1.5.0 carve-out).

## R2. Snippet generation per row

- **Decision**: Reuse the pure builders in `src/renderer/snippets.ts` verbatim — `mcpAddCommand` + `mcpJsonConfig` for HTTP rows, `stdioJsonConfig` for stdio rows — fed a per-row `SnippetState { port, tokenRequired, token, serverName }`. Auth-off rows omit the `Authorization` header with a visible note (clarify Q1).
- **Rationale**: Guarantees FR-007 (own row identical to the panel) by construction — same functions, same inputs shape. Pure builders stay unit-testable with no DOM/Electron.
- **Alternatives considered**: Duplicating format strings in the panel (rejected — drift risk between panel and rows).

## R3. Server-name derivation

- **Decision**: `hyppovisor` for the default (empty-label) instance, `hyppovisor-<label>` otherwise — the same rule the panel and client-registration docs use (SKILL.md, feature 012).
- **Rationale**: One rule everywhere; SC-002 verification (distinct handshake names) depends on it.
- **Alternatives considered**: Reading a stored server name (rejected — no such stored field exists; derivation is canonical).

## R4. Env-override caveat (honest limitation)

- **Decision**: Document that a sibling launched with `HYPPO_MCP_PORT` / `HYPPO_MCP_TOKEN` env overrides serves values its `settings.json` does not reflect. Port is safe (runtime.json carries the effective bound port, rewritten at bind). Token is not observable: if the sibling runs under an env-provided token, the copied block carries the persisted token and will fail auth. The row cannot detect this case; the contract states the assumption (settings reflect non-overridden launches).
- **Rationale**: No same-machine mechanism reveals another process's environment without invasive inspection (rejected as disproportionate). The common case (panel-managed tokens) works; the exotic case fails closed with a 401, never a wrong-instance connection.
- **Alternatives considered**: `/proc` env snooping (rejected — platform-specific, permission-fragile, disproportionate); hiding the token whenever uncertain (rejected — uncertainty is undetectable, would kill the feature).

## R5. Test strategy (standing user requirement: automated coverage)

- **Decision**: Unit (`vitest`): per-row `SnippetState` assembly (HTTP + auth, auth-off omission, stdio rows, server-name derivation), sibling settings-file parsing incl. corrupt/unreadable handling, unreachable marking. Integration (`playwright`, e2e): two launched instances — copy the sibling row's blocks in the visible panel, then prove the copied JSON reaches the sibling (handshake server name + a `list_open_tabs`-equivalent through it). Live agent clients (Claude Code/Desktop) stay manual-only.
- **Rationale**: Mirrors the repo's test layering; keeps tokens out of CI (e2e generates throwaway tokens in temp profiles); satisfies the user's no-manual-verification rule for everything automatable.
- **Alternatives considered**: Manual two-client verification as the primary check (rejected per standing user requirement).
