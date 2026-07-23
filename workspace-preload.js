const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeWindow: () => ipcRenderer.send('workspace-window-close'),
  moveWindow: (dx, dy) => ipcRenderer.send('workspace-window-move', { dx, dy }),
});
