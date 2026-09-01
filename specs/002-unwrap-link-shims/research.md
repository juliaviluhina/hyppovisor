# Phase 0 Research: Unwrap Link-Shim URLs

All Technical Context items resolved. The one open clarification (audit-log placement) was
settled in the spec's Clarifications 2026-09-01: a dedicated `operation: "unwrap"` entry,
only on a hop.

---

## R1 — Where the unwrap runs

**Decision**: `unwrapUrl(rawUrl)` is the first statement of both `TabManager.open()` and
`TabManager.navigate()`, before `validateUrl()` and before `load()`.

**Rationale**: FR-013 requires resolution to precede existing validation / queueing /
navigation. `TabManager.open` / `navigate` are the single point every caller funnels
through — the MCP `open_url` / `navigate` handlers (`tools.ts`), the person's address bar
(`chrome:open-url` IPC → `tabs.open(url, "person")`), and the e2e `__hyppo` handle. Putting
it in the tools layer would miss the address bar and the test handle; putting it lower
(`load()`) would run it after `validateUrl`. The action queue still wraps the whole
`open`/`navigate` call, so ordering vs. queueing is unchanged (`unwrapUrl` is synchronous
and cheap, inside the queued unit of work).

**Alternatives considered**:
- *In `tools.ts` `open_url` / `navigate` handlers.* Rejected — three-plus call sites, and a
  person typing a LinkedIn `safety/go` link in the address bar would not be unwrapped.
- *A wrapper around `validateUrl`.* Rejected — `validateUrl` is a pure string check with a
  narrow contract; folding a lookup table into it muddies both.

---

## R2 — The shim table shape and the `SHIM_RULES` entries

**Decision**: `SHIM_RULES` is a `readonly` array of

```ts
interface ShimRule {
  id: string;                 // stable, e.g. "linkedin-safety"
  hostMatch: (host: string) => boolean;  // lowercased host, no port
  pathPrefix: string;         // e.g. "/safety/go/", "/url", "/l.php", "/"
  param: string;              // "url" | "q" | "u"
}
```

Initial rows (FR-002):

| id | host match | path prefix | param |
|---|---|---|---|
| `linkedin-safety` | `=== "www.linkedin.com"` | `/safety/go/` | `url` |
| `google-redirect` | `www.google.com` **or** `www.google.<tld>` for a curated `tld` set | `/url` | `q` |
| `facebook-linkshim` | `l.facebook.com` or `lm.facebook.com` | `/l.php` | `u` |
| `reddit-out` | `out.reddit.com` | `/` | `url` |
| `outlook-safelinks` | host ends `.safelinks.protection.outlook.com` | `/` | `url` |

`hostMatch` is a small predicate per rule rather than a string list, so `outlook`'s tenant
subdomain and `google`'s ccTLD set are each expressed the way that rule needs — no
public-suffix library (spec Assumptions). `listShimRules()` returns
`{ id, pathPrefix, param }[]` (the predicate is not serialisable; its intent is covered by
the per-rule unit test), mirroring `listBlocklistRules()`.

Path-prefix match is `pathname === prefix || pathname.startsWith(prefix)` for a non-`/`
prefix; for `pathPrefix: "/"` it matches any path (Reddit / Outlook put the param at the
root). This is why the host predicate must be tight for those two.

**Alternatives considered**:
- *`hosts: string[]` + `pathPrefixes: string[]`.* Rejected — cannot express the Outlook
  tenant wildcard or a Google ccTLD family without either a huge literal list or a regex
  smuggled into a string field.
- *A single regex per rule over the whole URL.* Rejected — brittle around encoding and
  param ordering; `URL` + `searchParams` is the correct primitive.

---

## R3 — The `www.google.<tld>` variant set

**Decision**: an explicit curated list of ~20 high-traffic Google domains, matched exactly
(lowercased): `www.google.com`, `.co.uk`, `.ca`, `.com.au`, `.de`, `.fr`, `.es`, `.it`,
`.nl`, `.pl`, `.co.in`, `.co.jp`, `.com.br`, `.com.mx`, `.ru`, `.se`, `.ch`, `.be`, `.at`,
`.ie`, `.co.nz`, `.com.sg`. Plus bare `google.com` (no `www.`). Adding more later is a
one-line table edit.

**Rationale**: spec Assumptions bar a general public-suffix library and prefer "explicit
variant lists or a documented pattern". An explicit list is enumerable (Principle III),
trivially unit-testable, and covers the realistic set an agent hits following links from
job postings and search results. A regex like `/^www\.google\.[a-z.]{2,6}$/` would also
match typo/lookalike domains (`www.google.evil`) — the list avoids that class entirely.

**Alternatives considered**:
- *Regex over the google host.* Rejected — widens the match surface to lookalikes for no
  real coverage gain.
- *All ~190 ccTLDs.* Rejected — noise; most never appear, and the table stops being
  something a person reads at a glance.

---

## R4 — Decoding, nesting, and the depth cap

**Decision**: one iteration = `new URL(current)` → check `hostMatch` + path prefix →
`u.searchParams.get(param)` (this performs exactly one percent-decode) → if the result
parses as an absolute `http`/`https` URL, that becomes `current` and we loop; otherwise
stop and keep the previous `current`. Max **3** iterations (FR-007). `hops` = iterations
that actually changed the URL.

**Rationale**:
- `URLSearchParams.get` already single-decodes, which is exactly the shim's single encode.
  A destination that itself carries a query string round-trips correctly because it was
  encoded as one param value.
- The wrapper's own `#fragment` and extra params are dropped naturally — we take only the
  named param's value, not the wrapper (spec Edge Case).
- "Parameter present more than once" → `get()` returns the first (spec Edge Case).
- Re-running the full match on the decoded value handles a shim-wrapping-a-shim (Outlook →
  LinkedIn → real). The cap of 3 bounds a crafted `A?url=B?url=A…` chain: at 3 we stop and
  open the last resolved URL, no loop (SC-004).

**Alternatives considered**:
- *Recurse until no match.* Rejected — a self-referential chain never terminates; a fixed
  cap is the spec's requirement.
- *Decode twice defensively.* Rejected — double-decoding corrupts a destination whose real
  query string contains `%`-sequences.

---

## R5 — The `operation: "unwrap"` audit entry

**Decision** (from spec Clarifications 2026-09-01): on `hops > 0`, `TabManager` calls
`log.record({ operation: "unwrap", url: wrapper, target: destination, outcome: "permitted",
ruleId: null, error: null, unwrap: { hops }, tabId })`. `InteractionLogEntry` gains
`unwrap?: { hops: number }`, exactly parallel to the existing `batch?` field (feature 004).
No entry on `hops === 0`.

**Rationale**: `open_url` / `navigate` write nothing to the interaction log today, and this
feature deliberately keeps it that way for ordinary navigation (FR-011) — the log stays "a
list of acts worth noticing", and a silently-rewritten interstitial *is* such an act
(Principle III reviewability). Reusing the `batch`-style typed sub-object keeps the entry
schema regular. `tabId` is the id of the tab being opened/navigated (available in both
methods — `open` mints it just before, `navigate` receives it).

**Alternatives considered**:
- *Start logging every `open_url` / `navigate`.* Rejected in the clarification — a broad
  new behaviour beyond this feature's scope and a much larger log.
- *No audit entry; surface the unwrap only in the tool return payload.* Rejected — loses
  the durable trail; a reviewer reading `interaction-log.jsonl` should see that an
  interstitial was rewritten.
- *A free-text `target` like `"linkedin-safety → https://…"`.* Rejected — `target` holds
  the destination URL verbatim (greppable, machine-readable); the rule id is recoverable
  from the wrapper and belongs in `ruleId` only if a rule "fired" in the blocklist sense,
  which it did not. Leave `ruleId: null`; `unwrap.hops` carries the one datum that isn't a
  URL.
