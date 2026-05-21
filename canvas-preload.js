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

  /**
   * Listen for canvas-update events from the main process.
   * The main process sends the full elements array whenever elements change.
   * @param {function} callback - receives (elements: object[])
   * @returns {function} unsubscribe function
   */
  onCanvasUpdate: (callback) => {
    const handler = (_event, elements) => callback(elements);
    ipcRenderer.on('canvas-update', handler);
    return () => ipcRenderer.removeListener('canvas-update', handler);
  },

  /**
   * Listen for canvas mode change events from the main process.
   * Fired when POST /canvas/mode is called or mode is reset.
   * @param {function} callback - receives ({ mode: string })
   * @returns {function} unsubscribe function
   */
  onModeChange: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('canvas-mode-change', handler);
    return () => ipcRenderer.removeListener('canvas-mode-change', handler);
  },
});
