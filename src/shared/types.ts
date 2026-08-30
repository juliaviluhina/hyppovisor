// Shapes shared between the MCP surface, tab manager, and renderer IPC.
// Mirrors specs/001-open-any-url/data-model.md.

export type LoadState = "loading" | "loaded" | "failed";
export type OpenedBy = "person" | "orchestrator";

export interface TabSummary {
  tabId: string;
  url: string;
  title: string;
  loadState: LoadState;
}

export interface TabDetail extends TabSummary {
  error: string | null;
  openedBy: OpenedBy;
}

export interface PageReadResult {
  tabId: string;
  url: string;
  title: string;
  text: string;
  dom?: string;
  observedAt: string;
  truncated: { text: boolean; dom: boolean };
  queueDepth: number;
}

export type InteractOperation = "click" | "fill" | "scroll" | "space";

export interface InteractResult {
  tabId: string;
  operation: InteractOperation | "wait_for_selector" | "navigate";
  outcome: "permitted";
  queueDepth: number;
}

export interface InteractionLogEntry {
  at: string;
  tabId: string;
  url: string;
  operation: string;
  target: string | null;
  outcome: "permitted" | "refused" | "error";
  ruleId: string | null;
  error: string | null;
}
