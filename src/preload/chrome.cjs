// Preload for the app chrome (tab strip + address bar). CommonJS by design:
// Electron loads preload scripts as CJS. Exposes a minimal typed-ish IPC
// surface; no Node access leaks to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hyppo", {
  openUrl: (url) => ipcRenderer.invoke("chrome:open-url", url),
  activateTab: (tabId) => ipcRenderer.invoke("chrome:activate-tab", tabId),
  closeTab: (tabId) => ipcRenderer.invoke("chrome:close-tab", tabId),
  listTabs: () => ipcRenderer.invoke("chrome:list-tabs"),
  onTabsChanged: (cb) => ipcRenderer.on("tabs:changed", (_e, tabs) => cb(tabs)),
  onActivity: (cb) => ipcRenderer.on("tabs:activity", (_e, a) => cb(a)),
  onBlockedAction: (cb) => ipcRenderer.on("tabs:blocked-action", (_e, a) => cb(a)),
  onMcpReady: (cb) => ipcRenderer.on("mcp:ready", (_e, a) => cb(a)),
});
