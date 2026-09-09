# Quickstart: Async Selector Readiness

## Prerequisites

- Node.js `>=22`
- Dependencies installed with `npm install`

## Validation

```sh
npx vitest run tests/unit/read-page-selector.test.ts
npm run test:e2e -- tests/integration/read-page.spec.ts
```

Use a deterministic fixture with a persistent private panel that inserts the positive target after
a delay. Call `read_page` with the target selector, `waitForSelector: true`, and a timeout longer
than the delay. Verify the result contains only the target subtree and excludes the panel.

Repeat with a shorter timeout and verify an error names the selector and timeout with no broader
content. Repeat without the wait option for immediate `TARGET_NOT_FOUND`, and with invalid CSS for
immediate `INVALID_SELECTOR`.

See [contracts/read-page-async-selector-wait.md](./contracts/read-page-async-selector-wait.md) and
[data-model.md](./data-model.md) for the request and result contract. Existing read-page tests
must continue to pass unchanged.
