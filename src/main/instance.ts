// Instance resolution at launch (feature 012). Pure, synchronous, Electron-free:
// it takes argv + env + the pre-override userData path and returns the profile
// directory, display label, and CLI port for this process. `main()` calls
// `resolveInstance()` as its first statement, before `app.whenReady()`, so the
// single-instance lock and `app.setPath("userData", …)` can act on the result.
//
// See specs/012-multi-instance/data-model.md §1 and
// specs/012-multi-instance/contracts/instance-launch.md.

import { basename, join } from "node:path";

/** `--instance <name>`: 1–32 chars, lowercase letters / digits / `-` / `_`, first char alphanumeric. */
export const INSTANCE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface ResolvedInstance {
  /** Validated `--instance` name, or `null` for a default / env-dir launch. */
  name: string | null;
  /** Window title / panel header / server-name label: `name` → `HYPPO_USER_DATA_DIR` basename → `""`. */
  label: string;
  /** Absolute userData dir to `setPath()`, or `null` to leave Electron's default. */
  userDataDir: string | null;
  /** `--port` value when given and in range 1–65535; `undefined` otherwise. */
  cliPort: number | undefined;
  /** Which rule set `userDataDir` — for diagnostics and the panel's "launched with…" notice. */
  source: "instance" | "env-dir" | "default";
  /**
   * `true` iff a bare `--background` token appears anywhere in argv (feature 013).
   * A boolean flag: it takes no value, and `--background=…` forms are not the flag
   * (ignored as an unknown arg). Drives window visibility in `main()` — a
   * `--background` instance starts hidden and never takes focus. Never aborts startup.
   */
  background: boolean;
}

export interface ResolveInstanceError {
  error: "invalid-instance-name" | "invalid-port";
  /** Human-readable, shown via `dialog.showErrorBox` before any side effect. */
  reason: string;
}

export type ResolveInstanceResult = ResolvedInstance | ResolveInstanceError;

export function isResolveError(r: ResolveInstanceResult): r is ResolveInstanceError {
  return "error" in r;
}

/** First value of `--flag <v>` / `--flag=<v>` in `argv`; `undefined` when the flag is absent. */
function readFlag(argv: readonly string[], flag: string): string | undefined {
  const eq = `${flag}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === flag) return argv[i + 1] ?? ""; // present but value-less → "" (fails validation)
    if (a.startsWith(eq)) return a.slice(eq.length);
  }
  return undefined;
}

export function validateInstanceName(
  raw: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  if (INSTANCE_NAME_RE.test(raw)) return { ok: true, name: raw };
  return {
    ok: false,
    reason:
      'An --instance name is 1–32 characters: lowercase letters, digits, "-" and "_", ' +
      'starting with a letter or digit (e.g. "work", "client-2"). ' +
      `Got: ${JSON.stringify(raw)}.`,
  };
}

/**
 * Turn an arbitrary path basename into a label usable verbatim as both a window
 * title fragment and a `hyppovisor-<label>` MCP server name. May return `""`.
 */
export function deriveLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

/** `"hyppovisor-<label>"`, or the bare `"hyppovisor"` for the default instance. */
export function serverNameFor(label: string): string {
  return label ? `hyppovisor-${label}` : "hyppovisor";
}

/** The profile-collision dialog copy (FR-007). */
export function collisionMessage(r: ResolvedInstance): { title: string; body: string } {
  const which = r.label ? `the "${r.label}" profile` : "the default profile";
  return {
    title: "HyppoVisor is already running",
    body:
      `Another HyppoVisor is already using ${which}.\n\n` +
      "To run a separate instance, launch it with its own --instance name and --port, " +
      "e.g.  --instance work --port 7358.",
  };
}

/** Classify a listen() failure for the panel's `serverStatus` (FR-011). */
export function classifyListenError(err: unknown): "port-unavailable" | "error" {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e && e.code === "EADDRINUSE") return "port-unavailable";
  if (e && typeof e.message === "string" && /EADDRINUSE|in use/i.test(e.message))
    return "port-unavailable";
  return "error";
}

/**
 * Resolve the instance for this process. Returns a {@link ResolvedInstance}, or a
 * {@link ResolveInstanceError} the caller turns into `showErrorBox` + `exit(1)`
 * before touching the filesystem or the lock.
 *
 * Precedence (contracts/instance-launch.md):
 *   profile dir : HYPPO_USER_DATA_DIR > --instance <name> > Electron default
 *   port        : (env HYPPO_MCP_PORT, applied later) > --port <n> > persisted > default
 *   label       : --instance <name> > deriveLabel(basename(HYPPO_USER_DATA_DIR)) > ""
 */
export function resolveInstance(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  baseUserDataDir: string,
): ResolveInstanceResult {
  const rawInstance = readFlag(argv, "--instance");
  const rawPort = readFlag(argv, "--port");
  // Bare boolean flag (feature 013): present anywhere → hidden launch. An
  // `--background=…` form is deliberately not matched — the flag has no value.
  const background = argv.includes("--background");

  let name: string | null = null;
  if (rawInstance !== undefined) {
    const v = validateInstanceName(rawInstance);
    if (!v.ok) return { error: "invalid-instance-name", reason: v.reason };
    name = v.name;
  }

  let cliPort: number | undefined;
  if (rawPort !== undefined) {
    const n = Number(rawPort);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return {
        error: "invalid-port",
        reason: `--port must be an integer between 1 and 65535. Got: ${JSON.stringify(rawPort)}.`,
      };
    }
    cliPort = n;
  }

  const envDir = env.HYPPO_USER_DATA_DIR?.trim() || undefined;

  let userDataDir: string | null;
  let source: ResolvedInstance["source"];
  if (envDir) {
    userDataDir = envDir;
    source = "env-dir";
  } else if (name) {
    userDataDir = join(baseUserDataDir, "instances", name);
    source = "instance";
  } else {
    userDataDir = null;
    source = "default";
  }

  const label = name ?? (envDir ? deriveLabel(basename(envDir)) : "");

  return { name, label, userDataDir, cliPort, source, background };
}
