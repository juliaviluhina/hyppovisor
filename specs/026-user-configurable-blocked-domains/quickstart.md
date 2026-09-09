# Quickstart Validation

1. Run `npm test`.
2. With no blocked setting, verify an HTTP/HTTPS URL still opens.
3. Add `example.com` in the connection panel, save, and navigate to `www.example.com`; verify
   `DOMAIN_BLOCKED` and that the tab does not navigate.
4. Redirect a permitted host to `example.com`; verify the redirect is cancelled.
5. Open a child window targeting `example.com`; verify it is denied.
6. Set `HYPPO_BLOCKED_DOMAINS=example.com`, restart, and verify the panel is read-only and the file
   value is unchanged.
7. Inspect the interaction log and verify blocked entries contain metadata only.
