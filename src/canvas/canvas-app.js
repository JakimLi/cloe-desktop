/**
 * Canvas App — Initialization adapter for embedded mode.
 *
 * Wraps the canvas-renderer init logic for use inside the terminal overlay
 * (instead of a standalone BrowserWindow). Called on first canvas activation.
 */

import { initCanvasApp } from './canvas-renderer.js';

export { initCanvasApp };
