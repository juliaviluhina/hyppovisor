# Data Model: Post-Entry Navigation Policy Enforcement

This feature introduces no persistent data and no new MCP request or response fields.

## Navigation policy decision

| Field | Type | Meaning |
|---|---|---|
| `url` | string | Candidate top-level destination supplied by the browser event |
| `allowed` | boolean | Whether the existing URL policy accepts the destination |
| `reason` | string | Safe policy failure text when denied; never page/session content |

The decision is transient and exists only while handling a browser navigation event.

## Navigation feedback

Feedback is delivered through the existing transient activity/safety event path. It is not written
to the shared data directory, interaction log, or MCP payload.
