# Phase 0 Research: Post-Entry Navigation Policy Enforcement

## R1: Which browser events cover the missing behavior?

- **Decision**: Guard `will-navigate` for page/user-initiated main-frame navigations and
  `will-redirect` for server-side redirects. Check only events whose `isMainFrame` is true.
- **Rationale**: Electron documents `will-navigate` as cancellable and main-frame-only, including
  `window.location` changes and link clicks. It documents `will-redirect` as cancellable and
  specifically intended to prevent server redirects. Same-document navigation and subframes are
  not part of the issue.
- **Source**: [Electron `webContents` navigation events](https://www.electronjs.org/docs/latest/api/web-contents)
- **Alternative considered**: `did-navigate`/`did-redirect-navigation` are observation events and
  cannot reliably prevent the denied destination, so they are insufficient as the enforcement hook.

## R2: How should destinations be evaluated?

- **Decision**: Call the existing `validateUrl(url)` directly for every guarded event. A successful
  normalized result permits the event; a `HyppoError` causes `event.preventDefault()` and safe
  blocked-navigation feedback.
- **Rationale**: This keeps one source of truth for allowed schemes and malformed URLs and makes
  post-entry behavior match explicit `open`/`navigate` behavior.
- **Alternative considered**: A second event-specific allowlist would drift from `url-policy.ts`
  and create inconsistent decisions.

## R3: How should explicit programmatic loads be handled?

- **Decision**: Preserve the current pre-validation in `open` and `loadInPlace`; add event guards
  only for event-driven navigation. If Electron emits a guard for a programmatic load on a target
  platform, the same allowed URL passes harmlessly and must not generate duplicate activity.
- **Rationale**: `loadURL` is already validated before it starts, and Electron documents that
  `will-navigate` does not emit for `webContents.loadURL`; retaining the pre-check preserves the
  existing error contract.

## R4: What feedback is safe and compatible?

- **Decision**: Extend the existing blocked-action kind with `navigation`, or use the existing
  activity/blocked channel in the smallest compatible form selected during implementation. The
  detail contains the destination and policy error only, never page content or session data.
- **Rationale**: The renderer already subscribes to blocked-action events and the issue requires
  observability without a new UI or persistence mechanism.
- **Implementation constraint**: If adding a new union member would require broad UI changes,
  use the existing activity event with a stable `blocked navigation → ...` description and keep
  the safety event separately testable.

## R5: What should happen during tab teardown?

- **Decision**: Handlers capture the tab object but do not perform asynchronous work. If the tab is
  already absent/closing, prevent/report only when the event is still associated with the live tab;
  never reopen or replace it.
- **Rationale**: Synchronous event handling avoids races and preserves the existing close behavior.
