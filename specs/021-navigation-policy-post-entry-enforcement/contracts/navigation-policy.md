# Contract: Post-Entry Navigation Policy

## Scope

For each embedded tab's main `WebContents`:

1. A `will-navigate` event with `isMainFrame: true` is checked against the existing URL policy.
2. A `will-redirect` event with `isMainFrame: true` is checked against the existing URL policy.
3. If validation fails, the event is prevented and one safe blocked-navigation notification is
   emitted.
4. If validation succeeds, the event proceeds without changing existing tab or activity behavior.

Events for subframes, resources, same-document changes, and child windows are outside this
contract. Explicit `open`/`navigate` calls retain their current pre-validation and error behavior.

## Safety requirements

- A denied event must not complete on its candidate URL.
- A denied event must not open a new tab or child window.
- Feedback may identify the candidate URL and policy reason, but must not contain cookies,
  credentials, bearer tokens, or page body content.
