// Preload for the app chrome (tab strip + address bar). CommonJS by design:
// Electron loads preload scripts as CJS. Exposes a minimal typed-ish IPC
// surface; no Node access leaks to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hyppo", {
  openUrl: (url) => ipcRenderer.invoke("chrome:open-url", url),
  activateTab: (tabId) => ipcRenderer.invoke("chrome:activate-tab", tabId),
  closeTab: (tabId) => ipcRenderer.invoke("chrome:close-tab", tabId),
  reloadTab: () => ipcRenderer.invoke("chrome:reload-tab"),
  listTabs: () => ipcRenderer.invoke("chrome:list-tabs"),
  onTabsChanged: (cb) => ipcRenderer.on("tabs:changed", (_e, tabs) => cb(tabs)),

  // Recent-URLs dropdown (feature 009).
  recentUrls: () => ipcRenderer.invoke("chrome:recent-urls"),
  clearRecentUrls: () => ipcRenderer.invoke("chrome:clear-recent-urls"),
  onRecentUrlsChanged: (cb) =>
    ipcRenderer.on("recent-urls:changed", (_e, list) => cb(list)),

  onActivity: (cb) => ipcRenderer.on("tabs:activity", (_e, a) => cb(a)),
  onBlockedAction: (cb) => ipcRenderer.on("tabs:blocked-action", (_e, a) => cb(a)),

  // Connection panel (feature 007).
  getConnection: () => ipcRenderer.invoke("chrome:get-connection"),
  setPort: (p) => ipcRenderer.invoke("chrome:set-port", p),
  setTokenRequired: (b) => ipcRenderer.invoke("chrome:set-token-required", b),
  regenerateToken: () => ipcRenderer.invoke("chrome:regenerate-token"),
  setPanelOpen: (o) => ipcRenderer.invoke("chrome:set-panel-open", o),
  onConnectionChanged: (cb) => ipcRenderer.on("connection:changed", (_e, c) => cb(c)),

  // Local instance-management panel (feature 014).
  listInstances: () => ipcRenderer.invoke("chrome:list-instances"),
  closeInstance: (pid) => ipcRenderer.invoke("chrome:close-instance", pid),
  closeAllTabs: () => ipcRenderer.invoke("chrome:close-all-tabs"),
});
