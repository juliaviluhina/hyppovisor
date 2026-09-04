# Security hardening verification

1. Start a fresh profile in HTTP mode.
2. Read the connection panel token and request `/mcp` without `Authorization`; expect `401`.
3. Request with `Authorization: Bearer <token>`; expect the MCP request to proceed.
4. Regenerate the token; verify the old value receives `401`.
5. Confirm the chrome window has `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` in `src/main/index.ts`, and inspect the CSP meta tag in `src/renderer/index.html`.
6. To log out everywhere, quit HyppoVisor and remove the profile directory shown by the app/runtime configuration. Relaunch with a new profile; this removes active cookies and the old token.
