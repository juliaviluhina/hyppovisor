// Resolves TYPESAFE_API_KEY at startup so Jev ranking (feature 027) works
// regardless of launch method.
//
// A GUI app started via Dock, Finder, or `open -na` is launched by launchd,
// which does not inherit the invoking terminal's exported environment — only
// a direct `TYPESAFE_API_KEY=... ./HyppoVisor` exec (or a wrapper script, or
// CI) puts the var in this process's own environment. A value set once at the
// OS-user level with `launchctl setenv TYPESAFE_API_KEY ...` *is* visible to
// every launch method, via `launchctl getenv`. Resolution order:
//
//   1. This process's own environment (explicit — a specific launch always wins).
//   2. macOS only: `launchctl getenv TYPESAFE_API_KEY` (the OS-user environment).
//   3. Unresolved — Jev ranking stays unavailable (rankRelevance's existing
//      "unavailable-missing-key" status already surfaces this per call).

import { execFile } from "node:child_process";
import { config } from "../config.js";

export type ApiKeySource = "process-env" | "launchctl" | "none";

export interface ApiKeyResolution {
  key: string | undefined;
  source: ApiKeySource;
}

/** Runs `launchctl getenv <name>`; injectable for tests. */
export type LaunchctlGetenv = (name: string) => Promise<string | undefined>;

async function launchctlGetenv(name: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "launchctl",
      ["getenv", name],
      { timeout: config.launchctlGetenvTimeoutMs },
      (err, stdout) => {
        if (err) return resolve(undefined);
        const value = stdout.trim();
        resolve(value || undefined);
      },
    );
  });
}

/**
 * Resolve TYPESAFE_API_KEY per the order above. Never throws — a `launchctl`
 * failure (not on macOS, not found, times out) just falls through to "none".
 */
export async function resolveTypeSafeApiKey(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  getenv: LaunchctlGetenv = launchctlGetenv,
): Promise<ApiKeyResolution> {
  const direct = env["TYPESAFE_API_KEY"]?.trim();
  if (direct) return { key: direct, source: "process-env" };
  if (platform !== "darwin") return { key: undefined, source: "none" };
  const fromOsUser = await getenv("TYPESAFE_API_KEY");
  if (fromOsUser) return { key: fromOsUser, source: "launchctl" };
  return { key: undefined, source: "none" };
}

/** One-line startup breadcrumb — never includes the key value itself. */
export function describeApiKeySource(source: ApiKeySource): string {
  switch (source) {
    case "process-env":
      return "TYPESAFE_API_KEY found in the process environment";
    case "launchctl":
      return "TYPESAFE_API_KEY found in the OS user environment (launchctl getenv)";
    case "none":
      return "TYPESAFE_API_KEY not set — Jev ranking unavailable until one is set";
  }
}
