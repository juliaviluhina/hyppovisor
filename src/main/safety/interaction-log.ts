// Append-only JSONL interaction audit (FR-024a, FR-012b, research.md R6).
//
// Lives in Electron's userData dir — operational data about the app's own
// behaviour, NOT page content, and deliberately not in the shared data
// directory (constitution Principle V). Never records page text, only the
// target selector.

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { InteractionLogEntry } from "../../shared/types.js";
import { restrictFilePermissions } from "../security/file-permissions.js";

export class InteractionLog {
  private readonly path: string;

  constructor(userDataDir: string, fileName = "interaction-log.jsonl") {
    this.path = join(userDataDir, fileName);
  }

  get filePath(): string {
    return this.path;
  }

  record(entry: Omit<InteractionLogEntry, "at"> & { at?: string }): InteractionLogEntry {
    const full: InteractionLogEntry = { at: entry.at ?? new Date().toISOString(), ...entry };
    appendFileSync(this.path, JSON.stringify(full) + "\n", "utf8");
    restrictFilePermissions(this.path);
    return full;
  }
}
