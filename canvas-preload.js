const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('canvasAPI', {
  /**
   * Move the canvas window by a delta (for custom titlebar drag support).
   * The canvas window has a native title bar, so this is available
   * for future frameless mode or custom drag regions.
   */
  moveWindow: (dx, dy) => ipcRenderer.send('canvas-window-move', { dx, dy }),

  /**
   * Get canvas window position.
   */
  getWindowPosition: () => ipcRenderer.invoke('canvas-get-position'),
});
