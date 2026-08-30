// App chrome: a browser-like top bar (tab switcher + address bar + connection
// button), a scrollable tab strip, and a dismissible notice line for transient
// status — what the orchestrator is doing to a tab (FR-024) and any blocked
// popup / download (FR-017). The connection panel lives in panel.ts.

import { mountConnectionPanel } from "./panel.js";

interface TabSummary {
  tabId: string;
  url: string;
  title: string;
  loadState: string;
}

interface HyppoApi {
  openUrl: (url: string) => Promise<unknown>;
  activateTab: (id: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  listTabs: () => Promise<TabSummary[]>;
  onTabsChanged: (cb: (tabs: TabSummary[]) => void) => void;
  onActivity: (cb: (a: { tabId: string; description: string }) => void) => void;
  onBlockedAction: (cb: (a: { kind: string; detail: string }) => void) => void;
}

declare global {
  interface Window {
    hyppo: HyppoApi;
  }
}

export {};

const hyppo = window.hyppo;
const $ = (id: string) => document.getElementById(id)!;
const address = $("address") as HTMLInputElement;
const tabselect = $("tabselect") as HTMLSelectElement;
const noticeEl = $("notice");
const noticeText = $("notice-text");
let activeId: string | null = null;
let noticeTimer: number | undefined;

// ── notice line ─────────────────────────────────────────────────────────────
function showNotice(msg: string, kind: "info" | "warn" | "error"): void {
  noticeText.textContent = msg;
  noticeEl.className = kind;
  noticeEl.hidden = false;
  window.clearTimeout(noticeTimer);
  if (kind === "info") noticeTimer = window.setTimeout(hideNotice, 4000);
}
function hideNotice(): void {
  window.clearTimeout(noticeTimer);
  noticeEl.hidden = true;
  noticeText.textContent = "";
}
$("notice-x").addEventListener("click", hideNotice);

// ── tabs ────────────────────────────────────────────────────────────────────
function labelFor(t: TabSummary): string {
  return t.title || t.url || "(loading)";
}

function render(tabs: TabSummary[]): void {
  // Quick-switch dropdown (shown only when there is more than one tab).
  tabselect.hidden = tabs.length < 2;
  tabselect.innerHTML = "";
  for (const t of tabs) {
    const opt = document.createElement("option");
    opt.value = t.tabId;
    opt.textContent = labelFor(t);
    if (t.tabId === activeId) opt.selected = true;
    tabselect.appendChild(opt);
  }

  const box = $("tabs");
  box.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.tabId === activeId ? " active" : "");
    el.title = t.url;
    const label = document.createElement("span");
    label.textContent = `${labelFor(t)} · ${t.loadState}`;
    label.onclick = () => {
      activeId = t.tabId;
      hyppo.activateTab(t.tabId);
    };
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "✕";
    x.onclick = (e) => {
      e.stopPropagation();
      hyppo.closeTab(t.tabId);
    };
    el.append(label, x);
    box.appendChild(el);
  }
}

tabselect.addEventListener("change", () => {
  activeId = tabselect.value;
  hyppo.activateTab(activeId);
});

// ── address bar ─────────────────────────────────────────────────────────────
async function open(): Promise<void> {
  const url = address.value.trim();
  if (!url) return;
  showNotice(`opening ${url}…`, "info");
  try {
    await hyppo.openUrl(url);
    hideNotice();
    address.value = "";
  } catch (e) {
    showNotice(`error: ${(e as Error).message}`, "error");
  }
}

$("go").addEventListener("click", open);
address.addEventListener("keydown", (e) => {
  if (e.key === "Enter") open();
});

// ── live updates ────────────────────────────────────────────────────────────
hyppo.onTabsChanged((tabs) => {
  if ((!activeId || !tabs.some((t) => t.tabId === activeId)) && tabs.length) {
    activeId = tabs[tabs.length - 1].tabId;
  }
  render(tabs);
});
hyppo.onActivity((a) => {
  showNotice(`${a.tabId}: ${a.description}`, "info");
});
hyppo.onBlockedAction((a) => {
  showNotice(`blocked ${a.kind}: ${a.detail}`, "warn");
});

mountConnectionPanel();

hyppo.listTabs().then(render);
