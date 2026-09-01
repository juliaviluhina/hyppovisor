// Tab registry + embedded WebContentsView lifecycle (FR-001, FR-002, FR-005,
// FR-006, FR-008, FR-015, FR-017, research.md R1).

import { BrowserWindow, WebContentsView } from "electron";
import { config } from "../config.js";
import { HyppoError } from "../errors.js";
import type { LoadState, OpenedBy, TabDetail, TabSummary } from "../../shared/types.js";
import { validateUrl } from "./url-policy.js";
import { unwrapUrl } from "./unwrap-url.js";
import { isAuthPopupUrl, authPopupLabel } from "./auth-popups.js";
import type { InteractionLog } from "../safety/interaction-log.js";

interface Tab {
  id: string;
  view: WebContentsView;
  loadState: LoadState;
  error: string | null;
  openedBy: OpenedBy;
}

export interface TabEvents {
  /** Fired when a tab list / active tab changes, so the renderer can redraw. */
  onChange: () => void;
  /** Fired when a page tried to open a popup or start a download (FR-017). */
  onBlockedAction: (kind: "popup" | "download", detail: string) => void;
  /** Fired when the orchestrator drives a tab, so the renderer can show activity (FR-024). */
  onActivity: (tabId: string, description: string) => void;
  /**
   * Fired when a tab the *person* opened reaches a successfully-loaded state
   * (feature 009). `url` is the `validateUrl`-normalized address they entered,
   * not the redirect landing URL. Agent opens and failed loads never fire it.
   */
  onPersonOpen: (url: string) => void;
}

export class TabManager {
  private tabs = new Map<string, Tab>();
  private seq = 0;
  private activeId: string | null = null;
  /** While true, every tab view is hidden so the renderer's full-window overlay
   *  (the connection panel, feature 007) is unobstructed — still one window. */
  private overlay = false;
  /** Last time a `window.open` / `target=_blank` was turned into a tab — a cheap
   *  rate limit so a scripted `window.open` loop can't flood the strip. */
  private lastPopupTabAt = 0;

  constructor(
    private readonly win: BrowserWindow,
    private readonly events: TabEvents,
    private readonly log: InteractionLog,
  ) {
    this.win.on("resize", () => this.layout());
    this.win.webContents.session.on("will-download", (event, item) => {
      event.preventDefault();
      this.events.onBlockedAction("download", item.getURL());
    });
  }

  /**
   * Record a link-shim resolution in the interaction audit log (feature 002).
   * One `operation: "unwrap"` entry, only when the opened URL actually changed;
   * ordinary navigations stay unlogged.
   */
  private recordUnwrap(tabId: string, r: ReturnType<typeof unwrapUrl>): void {
    if (r.hops === 0) return;
    this.log.record({
      tabId,
      url: r.wrapper as string,
      operation: "unwrap",
      target: r.url,
      outcome: "permitted",
      ruleId: null,
      error: null,
      unwrap: { hops: r.hops },
    });
  }

  /** Open a URL in a new tab. Throws HyppoError for policy / load failures. */
  async open(rawUrl: string, openedBy: OpenedBy): Promise<TabSummary> {
    // Resolve a known redirect-interstitial / link-shim URL to its stated
    // destination BEFORE validation and loading (FR-013). Non-shim URLs pass
    // through untouched.
    const resolved = unwrapUrl(rawUrl);
    const url = validateUrl(resolved.url);
    const id = `tab-${++this.seq}`;
    this.recordUnwrap(id, resolved);

    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    const tab: Tab = { id, view, loadState: "loading", error: null, openedBy };
    this.tabs.set(id, tab);
    this.wireView(tab);

    this.win.contentView.addChildView(view);
    this.setActive(id);
    this.layout();

    await this.load(tab, url);
    // Reaching here means load() resolved without throwing, i.e. loadState is
    // "loaded". Record the person's own successful opens for the address-bar
    // dropdown (feature 009, FR-003); never the agent's, never a failed load.
    if (openedBy === "person" && tab.loadState === "loaded") {
      this.events.onPersonOpen(url);
    }
    return this.summary(tab);
  }

  /** Point an existing tab at a new URL (FR: navigate). */
  async navigate(tabId: string, rawUrl: string): Promise<TabSummary> {
    const tab = this.require(tabId);
    const resolved = unwrapUrl(rawUrl); // link-shim resolution first (FR-013)
    const url = validateUrl(resolved.url);
    this.recordUnwrap(tabId, resolved);
    this.setActive(tabId);
    this.events.onActivity(tabId, `navigate → ${url}`);
    await this.load(tab, url);
    return this.summary(tab);
  }

  close(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    this.win.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    this.tabs.delete(tabId);
    if (this.activeId === tabId) {
      const next = this.tabs.keys().next();
      this.activeId = next.done ? null : next.value;
      this.layout();
    }
    this.events.onChange();
  }

  list(): TabSummary[] {
    return [...this.tabs.values()].map((t) => this.summary(t));
  }

  detail(tabId: string): TabDetail {
    const tab = this.require(tabId);
    return { ...this.summary(tab), error: tab.error, openedBy: tab.openedBy };
  }

  /** The live webContents for a tab; throws TAB_NOT_FOUND if unknown/closed (FR-015). */
  webContentsFor(tabId: string) {
    return this.require(tabId).view.webContents;
  }

  setActive(tabId: string): void {
    if (!this.tabs.has(tabId)) return;
    this.activeId = tabId;
    this.layout();
    this.events.onChange();
  }

  /** Hide (or restore) every tab web view so a renderer overlay can cover the
   *  whole window. Idempotent; leaves tab/active state untouched (feature 007). */
  setChromeOverlay(on: boolean): void {
    this.overlay = on;
    this.layout();
  }

  private require(tabId: string): Tab {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new HyppoError(
        "TAB_NOT_FOUND",
        `No open tab with id "${tabId}" (it may have been closed).`,
      );
    }
    return tab;
  }

  private async load(tab: Tab, url: string): Promise<void> {
    tab.loadState = "loading";
    tab.error = null;
    this.events.onChange();
    try {
      await tab.view.webContents.loadURL(url);
      tab.loadState = "loaded";
    } catch (e) {
      tab.loadState = "failed";
      tab.error = e instanceof Error ? e.message : String(e);
      this.events.onChange();
      throw new HyppoError("LOAD_FAILED", `Failed to load ${url}: ${tab.error}`, {
        cause: tab.error,
      });
    }
    this.events.onChange();
  }

  private wireView(tab: Tab): void {
    const wc = tab.view.webContents;
    // A page may not spawn windows on its own (FR-006, FR-017). The one
    // exception: a sign-in popup to a known identity provider, which the human
    // summoned and needs to establish their own session (Principle IV). It must
    // be a real child window — OAuth `ux_mode=popup` flows (Google GSI) rely on
    // `window.opener` + cross-window postMessage to return the result and close
    // themselves, which a detached tab/view cannot do. We make it a **modal
    // child of the main window** (moves with it, no separate taskbar entry,
    // closes with the app) so it reads as part of the one window, not a
    // stray second app surface.
    wc.setWindowOpenHandler(({ url }) => {
      if (isAuthPopupUrl(url)) {
        this.events.onActivity(tab.id, `sign-in popup → ${authPopupLabel(url)}`);
        return {
          action: "allow",
          overrides: {
            parent: this.win,
            modal: true,
            width: 520,
            height: 640,
            resizable: true,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            autoHideMenuBar: true,
            title: `Sign in — ${authPopupLabel(url)}`,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        };
      }
      // A plain http(s) popup / `target="_blank"` link is a navigation the person
      // asked for — open it as a new tab in the one window (standard browser
      // behaviour), under the same URL policy as `open_url`. Rate-limited so a
      // scripted `window.open` loop can't flood the tab strip.
      if (/^https?:\/\//i.test(url)) {
        const now = Date.now();
        if (now - this.lastPopupTabAt < 700) {
          this.events.onBlockedAction("popup", `${url} (too many in a row)`);
          return { action: "deny" };
        }
        this.lastPopupTabAt = now;
        this.events.onActivity(tab.id, `opened in new tab → ${url}`);
        void this.open(url, "person").catch((e) => {
          this.events.onBlockedAction(
            "popup",
            `${url} (${e instanceof Error ? e.message : String(e)})`,
          );
        });
        return { action: "deny" };
      }
      this.events.onBlockedAction("popup", url);
      return { action: "deny" };
    });
    // Lock down whatever child window the auth popup produced: centre it on the
    // parent, no menu bar, and gate its own popups by the same allowlist.
    // Downloads are already blocked session-wide (constructor).
    wc.on("did-create-window", (child) => {
      child.setMenuBarVisibility(false);
      child.center();
      child.webContents.setWindowOpenHandler(({ url }) => {
        if (isAuthPopupUrl(url)) return { action: "allow" };
        this.events.onBlockedAction("popup", url);
        return { action: "deny" };
      });
    });
    wc.on("did-start-loading", () => {
      tab.loadState = "loading";
      this.events.onChange();
    });
    wc.on("did-stop-loading", () => {
      if (tab.loadState === "loading") tab.loadState = "loaded";
      this.events.onChange();
    });
    wc.on("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ERR_ABORTED */) return;
      tab.loadState = "failed";
      tab.error = `${desc} (${code})`;
      this.events.onChange();
    });
    wc.on("page-title-updated", () => this.events.onChange());
  }

  private summary(tab: Tab): TabSummary {
    return {
      tabId: tab.id,
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
      loadState: tab.loadState,
    };
  }

  private layout(): void {
    const [width, height] = this.win.getContentSize();
    const top = config.chromeHeight;
    for (const tab of this.tabs.values()) {
      const visible = !this.overlay && tab.id === this.activeId;
      tab.view.setVisible(visible);
      if (visible) {
        tab.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
      }
    }
  }
}
