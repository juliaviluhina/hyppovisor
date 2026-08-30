// App chrome: tab strip + address bar (FR-023, FR-025), plus a live line
// showing what the orchestrator is doing to a tab (FR-024) and any blocked
// popup/download (FR-017).

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
  onMcpReady: (cb: (a: { url: string; requiresToken: boolean }) => void) => void;
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
const activity = $("activity");
let activeId: string | null = null;

function render(tabs: TabSummary[]): void {
  const box = $("tabs");
  box.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.tabId === activeId ? " active" : "");
    el.title = t.url;
    const label = document.createElement("span");
    label.textContent = `${t.title || t.url || "(loading)"} · ${t.loadState}`;
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

async function open(): Promise<void> {
  const url = address.value.trim();
  if (!url) return;
  activity.textContent = `opening ${url}…`;
  try {
    await hyppo.openUrl(url);
    activity.textContent = "";
    address.value = "";
  } catch (e) {
    activity.textContent = `error: ${(e as Error).message}`;
  }
}

$("go").addEventListener("click", open);
address.addEventListener("keydown", (e) => {
  if (e.key === "Enter") open();
});

hyppo.onTabsChanged((tabs) => {
  if (!activeId && tabs.length) activeId = tabs[tabs.length - 1].tabId;
  render(tabs);
});
hyppo.onActivity((a) => {
  activity.textContent = `${a.tabId}: ${a.description}`;
});
hyppo.onBlockedAction((a) => {
  activity.textContent = `blocked ${a.kind}: ${a.detail}`;
});
hyppo.onMcpReady((a) => {
  const el = $("mcp");
  el.textContent = `MCP: ${a.url}${a.requiresToken ? " (token required)" : ""}`;
  el.title = "Register in Claude Code:  claude mcp add --transport http hyppovisor " + a.url;
});

hyppo.listTabs().then(render);
