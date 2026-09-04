import { chmodSync } from "node:fs";

/** Request owner-only access where the host filesystem supports POSIX modes. */
export function restrictFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows and some managed filesystems do not expose POSIX chmod semantics.
  }
}

/** Request owner-only access for an application profile directory. */
export function restrictDirectoryPermissions(path: string): void {
  try {
    chmodSync(path, 0o700);
  } catch {
    // Best effort by design; Electron still owns the profile location.
  }
}
