# Feature Specification: Local Security Hardening

**Feature Branch**: `security-hardening-014-016`

**Created**: 2026-09-04

**Status**: Ready for implementation

**Input**: Security hardening for issues 014–016: authenticated local MCP transport, sandboxed app chrome, and an explicit profile/token storage policy.

## User Scenarios & Testing

### User Story 1 - Protected local control plane (Priority: P1)

As a person who has logged into browser tabs, I want the local MCP endpoint to require a secret by default so another local process cannot control my sessions without authorization.

**Why this priority**: The endpoint can read and modify every logged-in tab, so an unauthenticated default is a high-impact local security exposure.

**Independent Test**: Start the HTTP endpoint with no prior configuration, confirm an unauthenticated request is rejected, then confirm the generated token works and replacement invalidates the old token.

**Acceptance Scenarios**:

1. **Given** no settings file and HTTP transport selected, **When** the endpoint starts, **Then** it requires a newly generated bearer token and does not print that token in ordinary diagnostics.
2. **Given** a valid token, **When** a request includes it, **Then** the request is accepted; a request with no token or a previous token is rejected.
3. **Given** stdio transport is selected, **When** the app starts, **Then** no network listener or bearer token is required.

### User Story 2 - Reduced renderer blast radius (Priority: P2)

As a person using the app, I want the app-owned chrome to run with the same renderer isolation baseline as browsed pages and to reject unexpected resource types.

**Why this priority**: A renderer injection or future unsafe IPC mistake should not receive unnecessary operating-system-adjacent capabilities.

**Independent Test**: Inspect the created chrome window preferences and load the chrome document; verify sandboxing, context isolation, and a restrictive CSP are present.

**Acceptance Scenarios**:

1. **Given** the app chrome window is created, **When** its preferences are inspected, **Then** sandboxing and context isolation are enabled and Node integration is disabled.
2. **Given** the chrome document is loaded, **When** its policy is inspected, **Then** scripts are limited to packaged resources, objects and frames are disallowed, and network connections are not permitted.

### User Story 3 - Explicit local storage boundary (Priority: P3)

As a person using a shared computer or backups, I want clear guidance about what the local profile protects and a reliable way to remove it so I can make an informed security decision.

**Why this priority**: The profile contains live authenticated session state and the MCP token; users need an explicit OS-boundary policy and recovery procedure.

**Independent Test**: Review the security policy and exercise the documented reset procedure against a throwaway profile; verify app-created settings and logs use owner-only permissions where supported and never contain the bearer token.

**Acceptance Scenarios**:

1. **Given** a profile is created or a settings file is written, **When** permissions are inspected on a supporting OS, **Then** the profile and security-sensitive settings are accessible only to the owning user.
2. **Given** a user wants to log out everywhere, **When** they follow the reset procedure, **Then** the profile is removed and the next launch starts without the old session or token.
3. **Given** diagnostics are emitted, **When** they are reviewed, **Then** bearer tokens, cookies, page content, and credentials are absent.

### Edge Cases

- Existing settings with token authentication remain usable; existing explicit token opt-out is preserved as a deliberate compatibility choice and is visible in the connection panel.
- Permission tightening is best-effort on platforms/filesystems that do not support POSIX modes and never prevents startup solely because chmod is unavailable.
- A corrupt settings file falls back to a newly generated protected default without rewriting the corrupt file until a legitimate settings update.
- A failed bind or stdio startup does not expose a token in the error message.

## Requirements

### Functional Requirements

- **FR-001**: HTTP MCP transport MUST require a cryptographically random bearer token by default.
- **FR-002**: The token MUST be generated locally, persisted outside the shared data directory, and omitted from ordinary logs and error messages.
- **FR-003**: Replacing the token MUST invalidate the previous token immediately.
- **FR-004**: Stdio transport MUST remain available without opening a network listener.
- **FR-005**: The app-owned renderer MUST enable sandboxing, context isolation, and disabled Node integration.
- **FR-006**: The app chrome document MUST declare a restrictive content security policy that permits only packaged resources needed by the UI and disallows objects, frames, and network connections.
- **FR-007**: Profile directories and security-sensitive settings files MUST request owner-only permissions where the operating system supports them.
- **FR-008**: Documentation MUST state the protection boundary: other network peers and ordinary same-user accidental access are out of scope, while another local OS user, root/administrator, malware, backups, and a compromised account may still access local profile data depending on OS policy.
- **FR-009**: Documentation MUST provide a logout/profile-reset procedure and explain that removing the profile revokes the stored token and active sessions.
- **FR-010**: Automated tests MUST cover default authentication, token rotation, secret-safe diagnostics, renderer security settings, CSP, and permission requests.

### Key Entities

- **MCP bearer token**: A locally generated secret authorizing access to the loopback MCP control plane.
- **Browser profile**: Electron persistent session storage containing live authenticated web sessions and app configuration.
- **Security policy**: Human-readable documentation describing storage, threat boundaries, reset, backup, and logging behavior.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of HTTP startup paths without an explicit opt-out reject requests that omit the generated token.
- **SC-002**: 100% of token-rotation tests show the previous token rejected immediately.
- **SC-003**: The chrome security test confirms sandboxing, context isolation, disabled Node integration, and all required CSP directives.
- **SC-004**: Security-sensitive files are created with owner-only mode requests on POSIX test environments, and no test diagnostic contains a token.
- **SC-005**: A user can remove the profile and understand the resulting session/token revocation using one documented procedure.

## Assumptions

- HTTP remains the convenient default transport; users who cannot accept a local listener can choose stdio.
- Existing users who explicitly disabled token enforcement are not silently disconnected; the new secure default applies to new or reset profiles.
- Platform keychains may be adopted in a later release; this feature establishes the policy and owner-only fallback without adding a new persistence service.
- The shared data directory remains separate from Electron profile storage.
