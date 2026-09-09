# Feature Specification: User-Configurable Blocked Domains

**Feature Branch**: `026-user-configurable-blocked-domains`

**Created**: 2026-09-08

**Status**: Ready for planning

**Input**: User description: Add a user-owned list of domains that HyppoVisor must never navigate to.

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Enforce blocked domains (Priority: P1)

As a user, I can configure domains that HyppoVisor must refuse, so navigation cannot reach sites I have fenced off.

**Why this priority**: Enforcement is the core safety guarantee and must work even when a request or page attempts another navigation path.

**Independent Test**: Configure one domain, attempt direct navigation, a redirect, and a child-window navigation, and verify each is refused while an unrelated domain still loads.

**Acceptance Scenarios**:

1. **Given** a blocked entry `example.com`, **When** a user or MCP client requests `https://example.com`, **Then** navigation is refused with a named domain-blocked error identifying the host and setting.
2. **Given** a blocked entry `example.com`, **When** navigation redirects to `www.example.com` or opens it in a child window, **Then** the destination is refused.
3. **Given** no blocked entries, **When** an otherwise valid HTTP or HTTPS URL is requested, **Then** behavior is unchanged.

---

### User Story 2 - Manage the blocked-domain setting (Priority: P2)

As a user, I can view and edit the blocked-domain list in connection settings, so the policy is understandable and maintainable without editing hidden state.

**Why this priority**: Users need a reliable way to own the policy; enforcement without an editable, inspectable setting is incomplete.

**Independent Test**: Enter valid and invalid bare hostnames, save, reload settings, and verify valid entries persist while invalid entries are ignored with guidance.

**Acceptance Scenarios**:

1. **Given** no environment override, **When** the user saves a list of valid hostnames, **Then** it is persisted and used on the next navigation without restarting the MCP server.
2. **Given** `HYPPO_BLOCKED_DOMAINS` is set, **When** the user opens the panel, **Then** the effective list is shown as read-only and the file value remains untouched.

---

### User Story 3 - Audit blocked attempts (Priority: P3)

As a user, I can audit that a navigation was blocked without page content being recorded, so the policy decision is observable.

**Why this priority**: Auditability supports trust and troubleshooting while remaining separate from navigation behavior.

**Independent Test**: Attempt a blocked navigation and inspect the interaction log for the host and blocked outcome, with no page contents.

**Acceptance Scenarios**:

1. **Given** a blocked navigation attempt, **When** the policy rejects it, **Then** metadata records the host and blocked outcome only.

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- Entries are bare hostnames only; URLs, paths, wildcards, malformed hosts, and empty lines are ignored.
- Matching is case-insensitive, strips a trailing dot, canonicalizes internationalized names, and includes subdomains.
- An environment list replaces the file list for that run; the file remains unchanged.
- Existing tabs are not closed when a domain is added; the next navigation is blocked.
- Link-shim destinations are unwrapped before host policy evaluation.

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: The system MUST support an optional blocked-domain list, empty by default.
- **FR-002**: The system MUST accept valid bare hostnames from settings and ignore invalid entries without rejecting the whole settings file.
- **FR-003**: The system MUST support `HYPPO_BLOCKED_DOMAINS` as a comma-separated override with precedence over the file list.
- **FR-004**: The system MUST apply case-insensitive, trailing-dot-stripped, IDN-canonicalized, subdomain-inclusive host matching.
- **FR-005**: The system MUST refuse blocked hosts for direct requests, redirects, top-level script navigation, and child windows with `DOMAIN_BLOCKED`.
- **FR-006**: The system MUST preserve existing scheme validation and produce identical behavior when the effective list is empty.
- **FR-007**: The system MUST expose the setting in the connection panel, persist changes without a server restart, and show it read-only when environment-pinned.
- **FR-008**: The system MUST log blocked attempts as metadata only, including host and blocked outcome, never page content.

*Example of marking unclear requirements:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Key Entities *(include if feature involves data)*

- **Blocked-domain policy**: The effective normalized hostname list, sourced from settings or the environment.
- **Navigation decision**: The allow or refusal outcome, reason code, and target host for one navigation attempt.

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 100% of direct, redirected, and child-window navigations whose normalized host matches the effective list are refused in automated policy tests.
- **SC-002**: With an empty effective list, all existing valid HTTP/HTTPS policy tests pass without changed outcomes.
- **SC-003**: A user can add, save, reload, and remove a blocked hostname from the panel in under 2 minutes.
- **SC-004**: Every blocked attempt has an auditable metadata record and zero recorded page-content fields.

## Assumptions

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right assumptions based on reasonable defaults
  chosen when the feature description did not specify certain details.
-->

- The setting is per instance and follows existing settings-file and environment precedence rules.
- A leading-dot marker is not needed; every valid entry includes its subdomains.
- The policy applies on the next navigation and does not retroactively close already-open tabs.
- Existing URL unwrapping and scheme policy remain authoritative and are evaluated in their established order.
