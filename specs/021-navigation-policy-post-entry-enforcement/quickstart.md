# Quickstart: Post-Entry Navigation Policy Enforcement

## Prerequisites

- Node dependencies installed with `npm install`.
- Electron integration tests available in the normal repository environment.

## Automated validation

Run the focused tests:

```bash
npm run test:e2e -- navigation-policy
```

Expected results:

1. A valid page that redirects to a disallowed scheme does not finish on that destination.
2. A valid page whose script assigns a disallowed top-level destination remains on a safe page.
3. A valid page can navigate to another allowed `http`/`https` page.
4. Each denied navigation produces safe blocked-navigation feedback and no extra tab.
5. Existing popup and navigation tests remain green.

Run the complete validation before handoff:

```bash
npm test
npm run test:e2e
npm run lint
npm run build
```

See [navigation-policy.md](contracts/navigation-policy.md) for the behavioral contract.

## Validation note

The focused navigation suite and all unit tests pass. A full E2E run currently has four failures
in pre-existing security-hardening connection-panel/close-all-tabs cases (401 authentication
expectations and one request-state expectation); none involve this feature's files or tests.
