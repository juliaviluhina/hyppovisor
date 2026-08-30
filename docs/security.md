# Security

The HTTP transport is a loopback port that can drive whatever you're logged into
in the app.

- Bound to `127.0.0.1` only — never `0.0.0.0`.
- Can require a bearer token.
- **But** any process on your machine can still reach it.
- It's opt-in — you chose to run the app.

If that posture doesn't suit you, use **stdio** — it opens no socket. The tool
set, blocklist, and audit log are identical on both transports.
