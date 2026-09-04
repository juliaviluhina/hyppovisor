# Research: Local Security Hardening

## Decisions

1. Generate the default bearer token with Node cryptographic randomness and store it in the existing per-profile settings file. This preserves the current connection-panel and env override contracts while closing the unauthenticated default.
2. Use owner-only permission requests for profile directories and settings/log/runtime files. Electron owns the profile database, so application code cannot reliably chmod every Chromium-created file; the policy therefore documents the OS boundary and treats keychain/profile encryption as future work.
3. Enable renderer sandboxing and add CSP to the local chrome document. The preload uses only Electron bridge APIs and no Node filesystem/network APIs.

## Alternatives rejected

- Making stdio the default would be a larger connection workflow change and would remove the existing convenient HTTP mode.
- Adding a new keychain dependency now would expand packaging and test scope; the existing token format and documented fallback are sufficient for this incremental hardening.
- Disabling all inline styles would require moving the existing large stylesheet and creates unrelated UI churn; a content hash preserves the current UI while enforcing script/network restrictions.
