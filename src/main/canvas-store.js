'use strict';

/**
 * Canvas Store — in-memory canvas elements + current mode, and the
 * broadcasts that push canvas state to the main renderer window.
 *
 * Extracted from launcher.js. canvasElements and currentCanvasMode were
 * module-level lets in launcher.js touched by the canvas HTTP routes and
 * the two broadcast functions. Centralising them here lets the (future)
 * canvas route module own its state without launcher.js wiring.
 *
 * The broadcasts reach the main window through window-registry so this
 * module needs no launcher.js coupling.
 */

const windowRegistry = require('./window-registry');

const canvasElements = [];

let currentCanvasMode = null;

/** Canvas mode broadcast (sends to main renderer window) */
function broadcastCanvasUpdate() {
  const win = windowRegistry.getMainWindow();
  if (win) {
    win.webContents.send('canvas-update', [...canvasElements]);
  }
}

/** Broadcast mode change to main renderer window */
function broadcastCanvasModeChange(mode) {
  const win = windowRegistry.getMainWindow();
  if (win) {
    win.webContents.send('canvas-mode-change', { mode });
  }
}

module.exports = {
  canvasElements,
  getCurrentCanvasMode: () => currentCanvasMode,
  setCurrentCanvasMode: (mode) => { currentCanvasMode = mode; },
  broadcastCanvasUpdate,
  broadcastCanvasModeChange,
};
