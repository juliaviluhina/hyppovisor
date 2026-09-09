# Settings Contract: Blocked Domains

`settings.json` may contain `{"blockedDomains":["example.com"]}`. Values are human-readable and
safe to delete. Invalid values or entries fall back to an empty/filtered list without rewriting a
malformed file. `HYPPO_BLOCKED_DOMAINS`, when present, is a comma-separated effective override and
leaves the file untouched. The panel writes valid bare hostnames, one per line.
