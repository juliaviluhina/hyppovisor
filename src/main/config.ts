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
  /** Byte budget for one read_form_fields payload; tail records drop past it (feature 008, FR-011). */
  formFieldReadMaxBytes: numFromEnv("HYPPO_FORM_FIELD_READ_MAX_BYTES", 65536),
  /** Byte budget for one screenshot image; the capture is scaled/compressed to fit (feature 008, FR-023). */
  screenshotMaxBytes: numFromEnv("HYPPO_SCREENSHOT_MAX_BYTES", 262144),
  /** First JPEG quality the screenshot compress loop tries (feature 008, R10). */
  screenshotJpegQualityStart: numFromEnv("HYPPO_SCREENSHOT_JPEG_QUALITY_START", 80),
  /** Lowest JPEG quality the screenshot compress loop will drop to before downscaling (feature 008, R10). */
  screenshotJpegQualityFloor: numFromEnv("HYPPO_SCREENSHOT_JPEG_QUALITY_FLOOR", 30),
  /** Max recent-URL history entries kept for the address-bar dropdown (feature 009, FR-006). */
  recentUrlsCap: numFromEnv("HYPPO_RECENT_URLS_CAP", 20),
  /**
   * Bounded wait for `document.readyState === "complete"` before read_form_fields
   * computes verdicts, so a verdict is never derived from a still-parsing DOM
   * (feature 011, US3 / FR-018). Proceeds anyway on timeout.
   */
  domReadyTimeoutMs: numFromEnv("HYPPO_DOM_READY_TIMEOUT_MS", 1000),
  /** Chrome height reserved at the top of the window for the renderer UI. */
  chromeHeight: 104,

  // ── feature 014: local instance-management panel ──────────────────────────
  /**
   * SIGTERM → SIGKILL grace window when the panel shuts down another instance
   * (feature 014, R2). The target's own `SIGTERM → app.quit()` handler does the
   * graceful part; this is how long we wait before escalating to `SIGKILL`.
   */
  instanceShutdownGraceMs: numFromEnv("HYPPO_INSTANCE_SHUTDOWN_GRACE_MS", 5000),
  /**
   * Deadline for the loopback TCP `connect` that decides an instance's
   * responding / not-responding state (feature 014, R3).
   */
  instanceProbeTimeoutMs: numFromEnv("HYPPO_INSTANCE_PROBE_TIMEOUT_MS", 400),
  /**
   * How often the renderer re-lists instances while the panel is open
   * (feature 014, FR-007 / SC-005). Consumed in `panel.ts` as a literal with a
   * comment tying it back here — the renderer never imports this module.
   */
  instancePollMs: numFromEnv("HYPPO_INSTANCE_POLL_MS", 2000),
};

/** Default HTTP MCP listening port when nothing overrides it (feature 007). */
export const defaultMcpPort = 7357;
/** The MCP HTTP server binds loopback only — never a routable interface (FR-015). */
export const mcpHost = "127.0.0.1";
