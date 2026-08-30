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
  endpointUrl,
  mcpAddCommand,
  mcpJsonConfig,
  stdioJsonConfig,
  type StdioLaunchLike,
} from "./snippets.js";

type ConnectionSource = "env" | "persisted" | "default";

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
}

interface GetConnectionReply extends EffectiveConnection {
  stdioLaunch: StdioLaunchLike;
  appVersion: string;
  license: string;
}

type OkPort = { ok: true; port: number };
type Mutated = { ok: true } & EffectiveConnection;
type Failed = { ok: false; error: string };

interface HyppoConnectionApi {
  getConnection(): Promise<GetConnectionReply>;
  setPort(port: number): Promise<OkPort | Failed>;
  setTokenRequired(required: boolean): Promise<Mutated | Failed>;
  regenerateToken(): Promise<Mutated | Failed>;
  setPanelOpen(open: boolean): Promise<void>;
  onConnectionChanged(cb: (c: EffectiveConnection) => void): void;
}

const MASK = "••••••••••••";

export function mountConnectionPanel(): void {
  const hyppo = window.hyppo as unknown as HyppoConnectionApi;
  const $ = (id: string) => document.getElementById(id)!;
  const panel = $("panel");
  const body = $("panel-body");

  let lastConn: EffectiveConnection | null = null;
  let extras: Pick<GetConnectionReply, "stdioLaunch" | "appVersion" | "license"> | null = null;
  let revealed = false;
  // Transient inline notices — kept here so a re-render (triggered by the
  // connection:changed push a mutation causes) does not wipe them.
  let portNoticeText = "";
  let tokenNoticeText = "";

  // ── open / close ────────────────────────────────────────────────────────────
  async function open(): Promise<void> {
    await hyppo.setPanelOpen(true);
    panel.hidden = false;
    const reply = await hyppo.getConnection();
    extras = {
      stdioLaunch: reply.stdioLaunch,
      appVersion: reply.appVersion,
      license: reply.license,
    };
    lastConn = reply;
    render(reply);
  }

  function close(): void {
    panel.hidden = true;
    revealed = false;
    portNoticeText = "";
    tokenNoticeText = "";
    void hyppo.setPanelOpen(false);
  }

  $("hyppo").addEventListener("click", () => void open());
  $("panel-close").addEventListener("click", close);
  $("panel-backdrop").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape" && !panel.hidden) close();
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

    renderAbout(c);
    if (c.transport === "stdio") {
      renderStdio(c);
    } else {
      renderHttp(c);
    }
    renderLastRequest(c);
  }

  function renderHttp(c: EffectiveConnection): void {
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

  function renderStdio(_c: EffectiveConnection): void {
    const s = el("div", { className: "section" });
    s.append(
      el("h3", { textContent: "Transport" }),
      el("div", { className: "notice", textContent: "Running in stdio mode — no network endpoint." }),
    );
    body.append(s);
    if (extras) {
      const json = stdioJsonConfig(extras.stdioLaunch);
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
      ver.append(document.createTextNode(" · by juliaviluhina"));
      titles.append(ver);
    }
    s.append(el("div", { className: "about-heading" }, img, titles));

    const head = el("div", { className: "row" });
    head.append(copyButton("about", () => ABOUT_TEXT));
    s.append(head, el("pre", { className: "snippet", textContent: ABOUT_TEXT }));
    body.append(s);
  }

  // ── live updates ──────────────────────────────────────────────────────────
  hyppo.onConnectionChanged((c) => {
    lastConn = c;
    if (!panel.hidden) render(c);
  });
}
