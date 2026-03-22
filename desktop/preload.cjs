// ─── OWL Preload Script ───
// Secure IPC bridge between renderer and main process.
// Exposes window controls and OWL-specific APIs via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('owl', {
  // Window controls (for frameless titlebar)
  minimize: () => ipcRenderer.invoke('owl:minimize'),
  maximize: () => ipcRenderer.invoke('owl:maximize'),
  close: () => ipcRenderer.invoke('owl:close'),
  isMaximized: () => ipcRenderer.invoke('owl:isMaximized'),

  // App info
  getVersion: () => ipcRenderer.invoke('owl:getVersion'),
  getPlatform: () => ipcRenderer.invoke('owl:getPlatform'),

  // OWL controls
  getScore: () => ipcRenderer.invoke('owl:getScore'),
  isDaemonRunning: () => ipcRenderer.invoke('owl:isDaemonRunning'),
  toggleDaemon: () => ipcRenderer.invoke('owl:toggleDaemon'),
  openSetup: () => ipcRenderer.invoke('owl:openSetup')
});
