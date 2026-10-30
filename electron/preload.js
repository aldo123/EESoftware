const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },

  // External Software (embedded .exe) bridge
  pickExe: () => ipcRenderer.invoke('external:pick-exe'),
  // One-way, lightweight updates for native window geometry during motion.
  // Process launch/restart continues to use the acknowledged invoke channel.
  embedExternal: (opts) => ipcRenderer.invoke('external:embed', opts),
  updateExternalLayout: (layout) => ipcRenderer.send('external:layout', layout),
  closeExternal: () => ipcRenderer.send('external:close'),
  onExternalStopped: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('external:stopped', handler);
    return () => ipcRenderer.removeListener('external:stopped', handler);
  },
});