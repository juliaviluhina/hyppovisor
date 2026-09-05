# Quickstart Validation

1. Install dependencies with `npm install` and build with `npm run build`.
2. Run unit tests with `npm test`.
3. Run lint with `npm run lint`.
4. Run the Electron integration suite with `npm run test:e2e`.

Validation scenarios:

- Occupy the configured MCP port before launch. The panel must show degraded/non-ready status and recovery guidance.
- Start a healthy HTTP server, request a rebind to an occupied port, and verify the old listener remains safe while the panel reports the failed rebind.
- Close the server during a deliberately delayed request and verify the request settles deterministically without an unhandled rejection.
- Inject a transport failure during a queued tab action and verify the action is failed/interrupted, the lifecycle is degraded, and a subsequent dependent action is rejected or held.
- Restart after a startup or transport failure and verify the panel returns to healthy once the listener is ready.
