// Tab registry + embedded WebContentsView lifecycle (FR-001, FR-002, FR-005,
// FR-006, FR-008, FR-015, FR-017, research.md R1).

import { BrowserWindow, WebContentsView } from "electron";
import { config } from "../config.js";
import { HyppoError } from "../errors.js";
import type { LoadState, OpenedBy, TabDetail, TabSummary } from "../../shared/types.js";
import { validateUrl } from "./url-policy.js";

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
}

export class TabManager {
  private tabs = new Map<string, Tab>();
  private seq = 0;
  private activeId: string | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly events: TabEvents,
  ) {
    this.win.on("resize", () => this.layout());
    this.win.webContents.session.on("will-download", (event, item) => {
      event.preventDefault();
      this.events.onBlockedAction("download", item.getURL());
    });
  }

  /** Open a URL in a new tab. Throws HyppoError for policy / load failures. */
  async open(rawUrl: string, openedBy: OpenedBy): Promise<TabSummary> {
    const url = validateUrl(rawUrl);
    const id = `tab-${++this.seq}`;

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
    return this.summary(tab);
  }

  /** Point an existing tab at a new URL (FR: navigate). */
  async navigate(tabId: string, rawUrl: string): Promise<TabSummary> {
    const tab = this.require(tabId);
    const url = validateUrl(rawUrl);
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
    // Never let a page spawn windows on its own (FR-006, FR-017).
    wc.setWindowOpenHandler(({ url }) => {
      this.events.onBlockedAction("popup", url);
      return { action: "deny" };
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
      const visible = tab.id === this.activeId;
      tab.view.setVisible(visible);
      if (visible) {
        tab.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
      }
    }
  }
}
