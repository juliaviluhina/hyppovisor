# HyppoVisor local security policy

HyppoVisor keeps the browser profile and MCP connection settings in Electron's per-user application-data directory, separate from the shared data directory. The profile may contain live authenticated website sessions. The MCP bearer token authorizes local clients to read and control those sessions.

HTTP binds to loopback and requires an app-generated bearer token for new or reset profiles. The token is never sent to a website and is not printed in ordinary logs. `HYPPO_MCP_TOKEN` remains an explicit environment override; `HYPPO_MCP_STDIO=1` opens no network listener.

The protection boundary is the owning OS account and the loopback boundary. This protects against network peers and casual unauthenticated local requests. It does not protect against another local OS user with filesystem access, root/administrator access, malware or a compromised owning account, nor does it guarantee that OS backup/indexing tools will not copy profile files. File permissions are requested as owner-only where the platform supports them. Packaged-build keychain storage is a follow-up hardening option; the current fallback is the Electron profile with OS access controls.

## Log out and reset

1. Quit every HyppoVisor instance using the app's normal quit action.
2. Remove the instance's Electron user-data/profile directory (the directory supplied by `HYPPO_USER_DATA_DIR`, or the platform's HyppoVisor application-data directory; named instances are under its `instances/` directory).
3. Relaunch HyppoVisor. It creates a new profile, clears the old authenticated sessions, and generates a new MCP token.

Removing the profile is irreversible for the local sessions. Back up only files you intentionally need; never copy `Cookies`, `Network/`, `Local Storage/`, or `settings.json` to an untrusted location.
