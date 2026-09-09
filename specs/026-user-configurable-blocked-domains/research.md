# Research: User-Configurable Blocked Domains

## Decision: Normalize to canonical bare hosts and match subdomains

Use lowercase URL hostname normalization, remove a trailing dot, convert IDNs with the platform URL
implementation, and match an exact host or a dot-boundary suffix. Reject ports, paths, schemes,
wildcards, and empty values in configuration.

## Decision: Environment replaces file configuration

When `HYPPO_BLOCKED_DOMAINS` is present, its valid entries are effective and the JSON value remains
untouched, matching existing env-over-file precedence.

## Decision: Enforce every top-level navigation entry point

Use the same policy for requested URLs, redirects, and window-open decisions; unwrap known link shims
before validation so the destination cannot bypass the policy.
