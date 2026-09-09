# Data Model

## BlockedDomainPolicy

- `blockedDomains`: normalized bare hostnames.
- `source`: settings file or environment override for renderer display and editability.
- Default: empty list; invalid entries are omitted individually.

## NavigationDecision

- `allowed`: boolean outcome.
- `reason`: existing scheme reason or `DOMAIN_BLOCKED`.
- `host`: normalized candidate host when available.

The policy is per application instance and is not persisted separately from settings.json.
