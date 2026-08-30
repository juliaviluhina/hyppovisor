// Configurable limits (FR-021). Defaults per spec; overridable via env for tests.

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  /** Max bytes of visible text returned by read_page before truncation (FR-021). */
  maxTextBytes: numFromEnv("HYPPO_MAX_TEXT_BYTES", 100 * 1024),
  /** Separate max bytes for the optional DOM payload (FR-021). */
  maxDomBytes: numFromEnv("HYPPO_MAX_DOM_BYTES", 2 * 1024 * 1024),
  /** Default wait_for_selector timeout in ms. */
  defaultWaitMs: numFromEnv("HYPPO_DEFAULT_WAIT_MS", 10_000),
  /** Chrome height reserved at the top of the window for the renderer UI. */
  chromeHeight: 104,
};
