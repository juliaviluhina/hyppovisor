// Connection panel (feature 007): a full-window overlay reached from the mascot
// button in the top bar. Shows the effective MCP endpoint with
// copy-ready snippets, lets the user set the HTTP port (live, persisted) and
// optionally require a bearer token (masked, revealable, regenerable), and
// carries a static description of what HyppoVisor is.
//
// Pure text builders + the About text live in ./snippets.ts (unit-tested). This
// module is DOM + wiring only. Connection types are redeclared here the way
// app.ts redeclares TabSummary — the renderer tsconfig compiles in isolation.

import {
  ABOUT_TEXT,
  HOW_IT_WORKS_INTRO,
  HOW_IT_WORKS_STEPS,
  HYPPO_CAN,
  HYPPO_FORBIDDEN,
  HOW_IT_WORKS_CLOSING,
  endpointUrl,
  mcpAddCommand,
  mcpJsonConfig,
  stdioJsonConfig,
  type StdioLaunchLike,
} from "./snippets.js";

type ConnectionSource = "env" | "cli" | "persisted" | "default";

interface LastRequestInfo {
  at: number;
  tool: string | null;
  outcome: "ok" | "rejected";
}

interface EffectiveConnection {
  transport: "http" | "stdio";
  port: number;
  endpointUrl: string;
  tokenRequired: boolean;
  token: string | null;
  portSource: ConnectionSource;
  tokenSource: ConnectionSource;
  lastRequest: LastRequestInfo | null;
  /** feature 012 — HTTP bind outcome; `"stdio"` when `transport === "stdio"`. */
  serverStatus: "listening" | "port-unavailable" | "error" | "stdio";
  /** feature 012 — instance display label; `""` for the default instance. */
  instanceLabel: string;
  /** feature 012 — `"hyppovisor"` or `"hyppovisor-<label>"`. */
  serverName: string;
}

interface GetConnectionReply extends EffectiveConnection {
  stdioLaunch: StdioLaunchLike;
  appVersion: string;
  license: string;
}

type OkPort = { ok: true; port: number };
type Mutated = { ok: true } & EffectiveConnection;
type Failed = { ok: false; error: string };

// ── feature 014 — local instance-management panel ──────────────────────────
interface InstanceSummary {
  pid: number;
  label: string;
  port: number | null;
  mode: "foreground" | "background";
  state: "responding" | "not-responding" | "stdio";
  isCurrent: boolean;
  startedAt: string;
}
type CloseInstanceReply =
  | { ok: true; forced?: boolean; alreadyGone?: boolean }
  | { ok: false; error: string };

interface HyppoConnectionApi {
  getConnection(): Promise<GetConnectionReply>;
  setPort(port: number): Promise<OkPort | Failed>;
  setTokenRequired(required: boolean): Promise<Mutated | Failed>;
  regenerateToken(): Promise<Mutated | Failed>;
  setPanelOpen(open: boolean): Promise<void>;
  onConnectionChanged(cb: (c: EffectiveConnection) => void): void;
  recentUrls(): Promise<string[]>;
  clearRecentUrls(): Promise<void>;
  onRecentUrlsChanged(cb: (list: string[]) => void): void;
  listInstances(): Promise<InstanceSummary[]>;
  closeInstance(pid: number): Promise<CloseInstanceReply>;
}

const MASK = "••••••••••••";

export function mountConnectionPanel(): void {
  const hyppo = window.hyppo as unknown as HyppoConnectionApi;
  const $ = (id: string) => document.getElementById(id)!;
  const panel = $("panel");
  const body = $("panel-body");

  let lastConn: EffectiveConnection | null = null;
  let extras: Pick<GetConnectionReply, "stdioLaunch" | "appVersion" | "license"> | null = null;
  let recentUrlCount = 0;
  let revealed = false;
  // Transient inline notices — kept here so a re-render (triggered by the
  // connection:changed push a mutation causes) does not wipe them.
  let portNoticeText = "";
  let tokenNoticeText = "";
  // feature 014 — instance list + confirm modal + close-all-tabs
  let instances: InstanceSummary[] = [];
  let instancesError = false;
  let instTimer: ReturnType<typeof setInterval> | undefined;
  let pendingClose: { pid: number; label: string; port: number | null } | null = null;
  let instNoticeText = "";

  // ── open / close ────────────────────────────────────────────────────────────
  async function open(): Promise<void> {
    await hyppo.setPanelOpen(true);
    panel.hidden = false;
    recentUrlCount = (await hyppo.recentUrls()).length;
    const reply = await hyppo.getConnection();
    extras = {
      stdioLaunch: reply.stdioLaunch,
      appVersion: reply.appVersion,
      license: reply.license,
    };
    lastConn = reply;
    render(reply);
    // feature 014 — poll the instance list while the panel is open
    // (config.instancePollMs = 2000; the renderer can't import config).
    void refreshInstances();
    instTimer = setInterval(() => void refreshInstances(), 2000);
  }

  function close(): void {
    panel.hidden = true;
    revealed = false;
    portNoticeText = "";
    tokenNoticeText = "";
    instNoticeText = "";
    pendingClose = null;
    if (instTimer) {
      clearInterval(instTimer);
      instTimer = undefined;
    }
    void hyppo.setPanelOpen(false);
  }

  async function refreshInstances(): Promise<void> {
    try {
      instances = await hyppo.listInstances();
      instancesError = false;
    } catch {
      instancesError = true;
      instances = instances.filter((i) => i.isCurrent);
    }
    // Repaint ONLY the instance list — never a full render(), which wipes
    // #panel-body and would detach whatever the user is mid-interaction with.
    if (!panel.hidden) paintInstances();
  }

  $("hyppo").addEventListener("click", () => void open());
  $("panel-close").addEventListener("click", close);
  $("panel-backdrop").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Escape" || panel.hidden) return;
    // A confirm modal is open — Esc cancels it, not the whole panel (FR-004).
    if (pendingClose) {
      pendingClose = null;
      renderConfirmModal();
      return;
    }
    close();
  });

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> = {},
    ...children: (Node | string)[]
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const c of children) node.append(c);
    return node;
  }

  const ICON_COPY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const ICON_OK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const ICON_FAIL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  /** An icon Copy control that always writes the real (unmasked) text. */
  function copyButton(kind: string, getReal: () => string): HTMLButtonElement {
    const btn = el("button", { className: "copy-btn", title: "Copy" });
    btn.dataset.copy = kind;
    btn.setAttribute("aria-label", "Copy");
    btn.innerHTML = ICON_COPY;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(getReal());
        btn.className = "copy-btn ok";
        btn.innerHTML = ICON_OK;
        btn.title = "Copied";
        btn.setAttribute("aria-label", "Copied");
      } catch {
        btn.className = "copy-btn fail";
        btn.innerHTML = ICON_FAIL;
        btn.title = "Copy failed — select and ⌘C";
        btn.setAttribute("aria-label", "Copy failed — select and ⌘C");
      }
      setTimeout(() => {
        btn.className = "copy-btn";
        btn.innerHTML = ICON_COPY;
        btn.title = "Copy";
        btn.setAttribute("aria-label", "Copy");
      }, 1500);
    });
    return btn;
  }

  function maskToken(real: string, c: EffectiveConnection): string {
    if (revealed || !c.tokenRequired || !c.token) return real;
    return real.split(c.token).join(MASK);
  }

  /** A titled `<pre>` snippet with a Copy button; copy yields the real text. */
  function snippetBlock(
    title: string,
    kind: string,
    real: string,
    display = real,
  ): HTMLElement {
    const section = el("div", { className: "section" });
    const head = el("div", { className: "row" }, el("h3", { textContent: title }));
    head.append(copyButton(kind, () => real));
    section.append(head, el("pre", { className: "snippet", textContent: display }));
    return section;
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function render(c: EffectiveConnection): void {
    lastConn = c;
    body.innerHTML = "";

    // feature 012 — instance label beside the panel title (blank for the default).
    const instanceEl = document.getElementById("panel-instance");
    if (instanceEl) instanceEl.textContent = c.instanceLabel || "";

    renderAbout(c);
    renderHowItWorks();
    renderAgentText();
    if (c.transport === "stdio") {
      renderStdio(c);
    } else {
      renderHttp(c);
    }
    renderRecentUrls();
    renderInstances();
    renderLastRequest(c);
    renderConfirmModal();
  }

  /** Feature 014 — the Instances section shell. The rows themselves live in a
   *  stable `#inst-list-mount` node that {@link paintInstances} rewrites on each
   *  poll, so the 2 s refresh never disturbs the rest of `#panel-body`. */
  function renderInstances(): void {
    const s = el("div", { className: "section" });
    s.append(el("h3", { textContent: "Instances" }), el("div", { id: "inst-list-mount" }));
    body.append(s);
    paintInstances();
  }

  /** Rewrites ONLY `#inst-list-mount` from the current `instances` snapshot. */
  function paintInstances(): void {
    const mount = document.getElementById("inst-list-mount");
    if (!mount) return;
    mount.innerHTML = "";

    if (instancesError && !instances.some((i) => !i.isCurrent)) {
      mount.append(el("div", { className: "notice", textContent: "Can't list other instances." }));
    }

    const listEl = el("div", { className: "inst-list" });
    for (const inst of instances) {
      const row = el("div", {
        className: "inst-row" + (inst.isCurrent ? " inst-current" : ""),
      });
      const portTxt = inst.port === null ? "stdio" : String(inst.port);
      row.append(
        el(
          "div",
          { className: "inst-meta" },
          el("span", { className: "inst-name", textContent: inst.label || "(default)" }),
          el("span", { className: "inst-sub", textContent: `${portTxt} · ${inst.mode} · ${inst.state}` }),
        ),
      );
      if (inst.isCurrent) {
        row.append(el("span", { className: "inst-tag", textContent: "this instance" }));
        row.append(
          el("button", {
            className: "inst-close",
            textContent: "Close",
            disabled: true,
            title: "the instance you're viewing",
          }),
        );
      } else {
        const btn = el("button", { className: "inst-close", textContent: "Close" });
        btn.addEventListener("click", () => {
          pendingClose = { pid: inst.pid, label: inst.label, port: inst.port };
          instNoticeText = "";
          renderConfirmModal();
        });
        row.append(btn);
      }
      listEl.append(row);
    }
    mount.append(listEl);
    if (instNoticeText) mount.append(el("div", { className: "notice", textContent: instNoticeText }));
  }

  /** Feature 014 — the in-panel shutdown confirmation (R4). Lives on #panel-card
   *  (not #panel-body), so it survives a body re-render; rebuilt each render. */
  function renderConfirmModal(): void {
    document.getElementById("inst-confirm-wrap")?.remove();
    if (!pendingClose) return;
    const pc = pendingClose;

    const card = el("div", { className: "inst-confirm" });
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Confirm closing an instance");

    const portTxt = pc.port === null ? "stdio" : `port ${pc.port}`;
    card.append(
      el("div", {
        className: "inst-confirm-title",
        textContent: `Close instance "${pc.label || "(default)"}" on ${portTxt}?`,
      }),
      el("div", {
        className: "inst-confirm-body",
        textContent: "Its open tabs and any in-progress work are lost. This can't be undone.",
      }),
    );

    const cancel = el("button", { className: "inst-confirm-cancel", textContent: "Cancel" });
    cancel.addEventListener("click", () => {
      pendingClose = null;
      renderConfirmModal();
    });
    const confirm = el("button", { className: "inst-confirm-go", textContent: "Close instance" });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      const r = await hyppo.closeInstance(pc.pid);
      pendingClose = null;
      instNoticeText = r.ok ? "" : r.error;
      renderConfirmModal();
      await refreshInstances();
    });

    const rowEl = el("div", { className: "inst-confirm-row" }, cancel, confirm);
    card.append(rowEl);

    // Minimal focus trap: Tab / Shift-Tab cycles between the two buttons.
    card.addEventListener("keydown", (e) => {
      const ev = e as KeyboardEvent;
      if (ev.key !== "Tab") return;
      ev.preventDefault();
      (document.activeElement === cancel ? confirm : cancel).focus();
    });

    const wrap = el("div", { id: "inst-confirm-wrap" }, card);
    $("panel-card").append(wrap);
    cancel.focus();
  }

  /** Feature 009 — a "Clear recent URLs" action for the address-bar dropdown.
   *  The dropdown itself lives in the top bar; this is only its clear affordance. */
  function renderRecentUrls(): void {
    const s = el("div", { className: "section" });
    s.append(el("h3", { textContent: "Recent URLs" }));
    const btn = el("button", {
      id: "clear-recent-urls",
      textContent: "Clear recent URLs",
      disabled: recentUrlCount === 0,
    });
    btn.addEventListener("click", () => void hyppo.clearRecentUrls());
    const count =
      recentUrlCount === 0
        ? "The address bar has no remembered URLs yet."
        : `${recentUrlCount} URL${recentUrlCount === 1 ? "" : "s"} offered in the address-bar dropdown.`;
    s.append(el("div", { className: "row" }, btn), el("div", { className: "notice", textContent: count }));
    body.append(s);
  }

  function renderHttp(c: EffectiveConnection): void {
    // feature 012 — a failed bind is a first-class state with a remedy, above
    // the (still valid, once the port is fixed) Endpoint + snippet blocks.
    if (c.serverStatus === "port-unavailable") {
      body.append(
        el("div", {
          className: "panel-error",
          textContent:
            `Port ${c.port} is in use — another HyppoVisor instance? ` +
            "Change the port below and Apply, or relaunch with a different --port.",
        }),
      );
    } else if (c.serverStatus === "error") {
      body.append(
        el("div", {
          className: "panel-error",
          textContent:
            "The MCP server could not start. Change the port below and Apply, " +
            "or relaunch with a different --port.",
        }),
      );
    }

    // Endpoint
    const epUrl = endpointUrl(c.port);
    const ep = el("div", { className: "section" });
    const epRow = el(
      "div",
      { className: "row" },
      el("h3", { textContent: "Endpoint" }),
      copyButton("endpoint", () => epUrl),
    );
    ep.append(epRow, el("pre", { className: "snippet", textContent: epUrl }));
    body.append(ep);

    // Connect an agent — command + JSON
    const cmdReal = mcpAddCommand(c);
    body.append(snippetBlock("claude mcp add", "command", cmdReal, maskToken(cmdReal, c)));
    body.append(
      el("div", { className: "notice", textContent:
        "Adds it for every project under your user. Drop --scope user for the current project only." }),
    );
    const jsonReal = mcpJsonConfig(c);
    body.append(snippetBlock("JSON config", "json", jsonReal, maskToken(jsonReal, c)));

    renderPortSection(c);
    renderTokenSection(c);
  }

  function renderPortSection(c: EffectiveConnection): void {
    const s = el("div", { className: "section" }, el("h3", { textContent: "Listening port" }));
    const input = el("input", { id: "port-input", type: "number", value: String(c.port) });
    input.min = "1";
    input.max = "65535";
    const apply = el("button", { id: "port-apply", textContent: "Apply" });
    const hint = el("span", { className: "notice", textContent: "" });
    const notice = el("div", { id: "port-notice", className: "notice", textContent: "" });

    if (c.portSource === "env") {
      input.disabled = true;
      apply.disabled = true;
      notice.textContent = "Set by the HYPPO_MCP_PORT environment variable.";
    } else if (c.portSource === "cli") {
      // feature 012 — --port set the value, but the field stays editable so a
      // --port instance in the port-unavailable state can still recover.
      notice.textContent = portNoticeText || `Launched with --port ${c.port}.`;
    } else {
      notice.textContent = portNoticeText;
    }

    const refreshHint = () => {
      hint.textContent =
        Number(input.value) < 1024 ? "ports below 1024 may need elevated privileges" : "";
    };
    input.addEventListener("input", refreshHint);
    refreshHint();

    apply.addEventListener("click", async () => {
      const r = await hyppo.setPort(Number(input.value));
      portNoticeText = r.ok
        ? `Now listening on port ${r.port} — reconnect any agents.`
        : r.error;
      notice.textContent = portNoticeText;
      if (lastConn) render(lastConn);
    });

    s.append(el("div", { className: "row" }, input, apply, hint), notice);
    body.append(s);
  }

  function renderTokenSection(c: EffectiveConnection): void {
    const s = el("div", { className: "section" }, el("h3", { textContent: "Bearer token" }));
    const notice = el("div", { id: "token-notice", className: "notice", textContent: "" });
    const envControlled = c.tokenSource === "env";

    if (!envControlled) {
      notice.textContent = tokenNoticeText;
      const cb = el("input", { id: "token-required", type: "checkbox" });
      cb.checked = c.tokenRequired;
      cb.addEventListener("change", async () => {
        const r = await hyppo.setTokenRequired(cb.checked);
        tokenNoticeText = r.ok ? "" : r.error;
        notice.textContent = tokenNoticeText;
        if (lastConn) render(lastConn);
      });
      s.append(
        el("label", { className: "row" }, cb, document.createTextNode(" Require a bearer token")),
      );
    } else {
      notice.textContent = "Set by the HYPPO_MCP_TOKEN environment variable.";
    }

    if (c.tokenRequired) {
      const field = el("input", {
        id: "token-field",
        readOnly: true,
        className: revealed ? "" : "masked",
        value: revealed || !c.token ? (c.token ?? "") : MASK,
      });
      field.size = 40;
      const reveal = el("button", {
        id: "token-reveal",
        textContent: revealed ? "Hide" : "Reveal",
      });
      reveal.addEventListener("click", () => {
        revealed = !revealed;
        if (lastConn) render(lastConn);
      });
      const row = el("div", { className: "row" }, field, reveal, copyButton("token", () => c.token ?? ""));
      if (!envControlled) {
        const regen = el("button", { id: "token-regenerate", textContent: "Regenerate" });
        regen.addEventListener("click", async () => {
          const r = await hyppo.regenerateToken();
          tokenNoticeText = r.ok
            ? "Connected clients must reconnect with the new token."
            : r.error;
          notice.textContent = tokenNoticeText;
          if (lastConn) render(lastConn);
        });
        row.append(regen);
      }
      s.append(row);
    }

    s.append(notice);
    body.append(s);
  }

  function renderStdio(c: EffectiveConnection): void {
    const s = el("div", { className: "section" });
    s.append(
      el("h3", { textContent: "Transport" }),
      el("div", { className: "notice", textContent: "Running in stdio mode — no network endpoint." }),
    );
    body.append(s);
    if (extras) {
      const json = stdioJsonConfig(extras.stdioLaunch, c.serverName);
      body.append(snippetBlock("stdio JSON config", "stdio", json));
    }
  }

  function renderLastRequest(c: EffectiveConnection): void {
    const s = el("div", { className: "section" });
    const line = el("div", { id: "last-request", className: "notice" });
    const lr = c.lastRequest;
    if (!lr) {
      line.textContent = "No requests yet.";
    } else {
      const ago = Math.max(0, Math.round((Date.now() - lr.at) / 1000));
      line.textContent =
        lr.outcome === "rejected"
          ? `Last request: ${ago}s ago — rejected`
          : `Last request: ${ago}s ago — ${lr.tool ?? "(unknown)"}`;
    }
    s.append(el("h3", { textContent: "Last request" }), line);
    body.append(s);
  }

  function renderAbout(_c: EffectiveConnection): void {
    const s = el("div", { className: "section" });

    // Mascot sits alongside the "About" header, above the copyable text.
    const img = document.createElement("img");
    img.id = "panel-mascot";
    img.src = "./mascot.png";
    img.alt = "HyppoVisor";
    img.setAttribute(
      "onerror",
      "this.replaceWith(document.createTextNode('HyppoVisor'))",
    );

    const titles = el(
      "div",
      { className: "about-titles" },
      el("h3", { textContent: "About" }),
      el("div", { className: "row" }, el("strong", { textContent: "HyppoVisor" })),
    );
    if (extras) {
      const ver = el("div", { className: "notice" });
      ver.append(document.createTextNode(`Version ${extras.appVersion} · `));
      ver.append(
        el("a", {
          href: "https://www.apache.org/licenses/LICENSE-2.0",
          textContent: extras.license,
        }),
      );
      ver.append(document.createTextNode(" · by "));
      ver.append(
        el("a", {
          href: "https://github.com/juliaviluhina",
          textContent: "juliaviluhina",
        }),
      );
      titles.append(ver);
    }
    s.append(el("div", { className: "about-heading" }, img, titles));
    body.append(s);
  }

  /** The copy-ready blurb a person pastes into their AI agent app. Sits after
   *  "How it works" so the walkthrough is what a reader meets first. */
  function renderAgentText(): void {
    const s = el("div", { className: "section" });
    s.append(el("h3", { textContent: "Tell your AI agent app" }));
    const head = el("div", { className: "row" });
    head.append(copyButton("about", () => ABOUT_TEXT));
    s.append(head, el("pre", { className: "snippet", textContent: ABOUT_TEXT }));
    body.append(s);
  }

  function renderHowItWorks(): void {
    const s = el("div", { className: "section" });
    s.append(el("h3", { textContent: "How it works" }));
    s.append(el("p", { className: "how-intro", textContent: HOW_IT_WORKS_INTRO }));

    const steps = el("ol", { className: "how-list" });
    for (const step of HOW_IT_WORKS_STEPS) steps.append(el("li", { textContent: step }));
    s.append(steps);

    s.append(el("div", { className: "how-label", textContent: "HyppoVisor can" }));
    const can = el("ul", { className: "how-list" });
    for (const item of HYPPO_CAN) can.append(el("li", { textContent: item }));
    s.append(can);

    s.append(
      el("div", {
        className: "how-label forbidden",
        textContent: "Fully forbidden for HyppoVisor",
      }),
    );
    const no = el("ul", { className: "how-list" });
    for (const item of HYPPO_FORBIDDEN) no.append(el("li", { textContent: item }));
    s.append(no);

    s.append(el("p", { className: "how-closing", textContent: HOW_IT_WORKS_CLOSING }));
    body.append(s);
  }

  // ── live updates ──────────────────────────────────────────────────────────
  hyppo.onConnectionChanged((c) => {
    lastConn = c;
    if (!panel.hidden) render(c);
  });

  hyppo.onRecentUrlsChanged((list) => {
    recentUrlCount = list.length;
    if (!panel.hidden && lastConn) render(lastConn);
  });
}
