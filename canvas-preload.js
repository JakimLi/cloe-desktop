const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('canvasAPI', {
  /**
   * Move the canvas window by a delta (for custom titlebar drag support).
   */
  moveWindow: (dx, dy) => ipcRenderer.send('canvas-window-move', { dx, dy }),

  /**
   * Get canvas window position.
   */
  getWindowPosition: () => ipcRenderer.invoke('canvas-get-position'),

  // ==================== Clipboard API ====================

  /**
   * Read image from clipboard.
   * @returns {string|null} Base64 data URL (data:image/png;base64,...) or null.
   */
  readClipboardImage: () => {
    try {
      const img = clipboard.readImage();
      if (img && !img.isEmpty()) {
        return img.toDataURL();
      }
      return null;
    } catch (e) {
      console.error('[Canvas] clipboard.readImage failed:', e);
      return null;
    }
  },

  /**
   * Read text from clipboard.
   * @returns {string} Clipboard text content (empty string if none).
   */
  readClipboardText: () => {
    try {
      return clipboard.readText() || '';
    } catch (e) {
      console.error('[Canvas] clipboard.readText failed:', e);
      return '';
    }
  },

  /**
   * Check if clipboard has an image available.
   * @returns {boolean}
   */
  hasClipboardImage: () => {
    try {
      const img = clipboard.readImage();
      return img && !img.isEmpty();
    } catch {
      return false;
    }
  },

  // ==================== IPC Events ====================

  /**
   * Listen for canvas-update events from the main process.
   * @param {function} callback - receives elements array
   */
  onCanvasUpdate: (callback) => {
    ipcRenderer.on('canvas-update', (_event, elements) => {
      callback(elements);
    });
  },
});
