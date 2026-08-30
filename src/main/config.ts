// Configurable limits (FR-021). Defaults per spec; overridable via env for tests.

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const defaultWaitMs = numFromEnv("HYPPO_DEFAULT_WAIT_MS", 10_000);

export const config = {
  /** Max bytes of visible text returned by read_page before truncation (FR-021). */
  maxTextBytes: numFromEnv("HYPPO_MAX_TEXT_BYTES", 100 * 1024),
  /** Separate max bytes for the optional DOM payload (FR-021). */
  maxDomBytes: numFromEnv("HYPPO_MAX_DOM_BYTES", 2 * 1024 * 1024),
  /** Default wait_for_selector timeout in ms. */
  defaultWaitMs,
  /**
   * Bounded wait for a custom combobox's options to render and for the read-back
   * check (feature 006, FR-010 / FR-013). Defaults to defaultWaitMs;
   * env-overridable so a test can hit `option-not-appeared` quickly.
   */
  chooseOptionWaitMs: numFromEnv("HYPPO_CHOOSE_OPTION_WAIT_MS", defaultWaitMs),
  /** Max (selector, value) pairs one batch `fill` may carry (feature 004, FR-003). */
  batchFillCap: numFromEnv("HYPPO_BATCH_FILL_CAP", 50),
  /** Max form controls one read_form_fields call returns before truncation (feature 005, FR-010). */
  formFieldControlCap: numFromEnv("HYPPO_FORM_FIELD_CONTROL_CAP", 200),
  /** Max options per control read_form_fields returns before per-record truncation (feature 005, FR-010). */
  formFieldOptionCap: numFromEnv("HYPPO_FORM_FIELD_OPTION_CAP", 200),
  /** Chrome height reserved at the top of the window for the renderer UI. */
  chromeHeight: 104,
};
