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
  navigateActive: (url: string) => Promise<unknown>;
  activateTab: (id: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  listTabs: () => Promise<TabSummary[]>;
  onTabsChanged: (
    cb: (p: { tabs: TabSummary[]; activeTabId: string | null }) => void,
  ) => void;
  closeAllTabs: () => Promise<{ closed: number }>;
  reloadTab: () => Promise<void>;
  onActivity: (cb: (a: { tabId: string; description: string }) => void) => void;
  onBlockedAction: (cb: (a: { kind: string; detail: string }) => void) => void;
  onConnectionChanged: (cb: (c: { lifecycle: { state: string; failure: { message: string } | null } }) => void) => void;
  recentUrls: () => Promise<string[]>;
  clearRecentUrls: () => Promise<void>;
  onRecentUrlsChanged: (cb: (list: string[]) => void) => void;
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
const refreshTabBtn = $("refresh-tab") as HTMLButtonElement;
const closeAllTabsBtn = $("close-all-tabs") as HTMLButtonElement;
const noticeEl = $("notice");
const noticeText = $("notice-text");
let activeId: string | null = null;
/** True after the person clicks + with an empty address field, so the next Go
 * opens the entered URL in a new tab instead of navigating the current tab. */
let newTabPending = false;
/** The last URL written by syncAddress(), used to distinguish an untouched
 * synced value from a URL the person entered for a new tab. */
let lastSyncedUrl = "";
/** The tabs from the most recent tabs:changed — read by syncAddress() (feature 015). */
let latestTabs: TabSummary[] = [];
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

function activateTab(id: string): void {
  newTabPending = false;
  activeId = id;
  void hyppo.activateTab(id);
}

function render(tabs: TabSummary[]): void {
  // feature 014 — top-bar tab actions are live only while a tab is open.
  const noTabs = tabs.length === 0;
  refreshTabBtn.disabled = noTabs;
  closeAllTabsBtn.disabled = noTabs;

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
    el.onmousedown = () => {
      newTabPending = false;
    };
    el.onclick = () => activateTab(t.tabId);
    const label = document.createElement("span");
    label.textContent = `${labelFor(t)} · ${t.loadState}`;
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

tabselect.addEventListener("mousedown", () => {
  newTabPending = false;
});
tabselect.addEventListener("change", () => {
  activateTab(tabselect.value);
});

// ── address bar ─────────────────────────────────────────────────────────────

/**
 * Reflect the active tab's current (post-redirect) URL in #address — unless the
 * person is mid-edit (input focused), in which case their text is left intact
 * (FR-003 / US1 scenario 4). Empty when no tab is open (FR-002). Setting the
 * same string is a no-op, so a title-only change does not flicker the field.
 * Runs on every tabs:changed and on #address blur.
 */
function syncAddress(): void {
  if (document.activeElement === address) return;
  const active = activeId ? latestTabs.find((t) => t.tabId === activeId) : undefined;
  const next = active ? active.url : "";
  if (address.value !== next) address.value = next;
  lastSyncedUrl = next;
}

/** Open `url` in a new tab (the pre-015 address-bar behaviour). */
async function doOpen(url: string): Promise<void> {
  showNotice(`opening ${url}…`, "info");
  try {
    await hyppo.openUrl(url);
    hideNotice();
    address.value = "";
    lastSyncedUrl = "";
  } catch (e) {
    showNotice(`error: ${(e as Error).message}`, "error");
  }
}

/**
 * Enter / → : navigate the active tab in place (FR-005); with no tab active,
 * open a new tab (FR-007). A failed navigation surfaces as a notice with no
 * silent new-tab fallback (FR-009).
 */
async function submit(): Promise<void> {
  const url = address.value.trim();
  if (!url) return;
  if (newTabPending) {
    newTabPending = false;
    await doOpen(url);
    return;
  }
  if (!activeId) {
    await doOpen(url);
    return;
  }
  showNotice(`navigating to ${url}…`, "info");
  try {
    await hyppo.navigateActive(url);
    hideNotice();
    // The edit is submitted — drop focus so syncAddress() can reflect the tab's
    // resolved (post-redirect) URL, the way a browser omnibox hands focus to the
    // page after you hit Enter. (The blur listener also runs syncAddress now.)
    address.blur();
  } catch (e) {
    showNotice(`error: ${(e as Error).message}`, "error");
  }
}

/** The dedicated "+" control: always opens a new tab, leaving the active tab
 *  untouched (FR-006); with no tab active it is just an open (US3 scenario 2). */
async function openNewTab(): Promise<void> {
  const url = address.value.trim();
  if (!url || url === lastSyncedUrl) {
    newTabPending = true;
    address.focus();
    return;
  }
  newTabPending = false;
  await doOpen(url);
}

$("go").addEventListener("click", submit);
$("newtab").addEventListener("click", openNewTab);
// Pressing either button must not blur #address before its click handler reads
// the value — otherwise the blur-driven syncAddress() wipes an unsubmitted edit.
// (Standard toolbar-button behaviour; focus stays in the field.)
for (const id of ["go", "newtab"]) {
  $(id).addEventListener("mousedown", (e) => e.preventDefault());
}
address.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submit();
});
address.addEventListener("blur", () => {
  newTabPending = false;
  syncAddress();
});

// ── top-bar tab actions (feature 014) ───────────────────────────────────────
refreshTabBtn.addEventListener("click", () => void hyppo.reloadTab());
closeAllTabsBtn.addEventListener("click", async () => {
  const { closed } = await hyppo.closeAllTabs();
  if (closed > 0) showNotice(`closed ${closed} tab${closed === 1 ? "" : "s"}`, "info");
});

// ── recent-URLs dropdown (feature 009) ──────────────────────────────────────
const recentDatalist = $("recent-urls") as HTMLDataListElement;
function fillDatalist(list: string[]): void {
  recentDatalist.innerHTML = "";
  for (const url of list) {
    const opt = document.createElement("option");
    opt.value = url;
    recentDatalist.appendChild(opt);
  }
}
hyppo.recentUrls().then(fillDatalist);
hyppo.onRecentUrlsChanged(fillDatalist);

// ── live updates ────────────────────────────────────────────────────────────
hyppo.onTabsChanged(({ tabs, activeTabId }) => {
  if (activeId !== activeTabId) newTabPending = false;
  latestTabs = tabs;
  activeId = activeTabId;
  render(tabs);
  syncAddress();
});
hyppo.onActivity((a) => {
  showNotice(`${a.tabId}: ${a.description}`, "info");
});
hyppo.onBlockedAction((a) => {
  showNotice(`blocked ${a.kind}: ${a.detail}`, "warn");
});
hyppo.onConnectionChanged((c) => {
  if (c.lifecycle.state === "degraded") {
    showNotice(`HyppoVisor degraded: ${c.lifecycle.failure?.message ?? "runtime failure"}`, "error");
  }
});

mountConnectionPanel();

hyppo.listTabs().then((tabs) => {
  latestTabs = tabs;
  render(tabs);
  syncAddress();
});
