/**
 * React entry point — mounts the overlay app into #react-root.
 *
 * renderer.js (Vanilla JS) runs first and handles:
 *   - GIF animation loop, idle, crossfade
 *   - Audio playback (TTS, pre-recorded)
 *   - Action dispatch (WebSocket → GIF switch)
 *   - Window drag (character mode)
 *   - Context usage HUD
 *
 * This React app takes over the #terminal-overlay area:
 *   - Titlebar (traffic lights, mode switcher)
 *   - Terminal (xterm.js) or Canvas (Excalidraw)
 *
 * Bridge: renderer.js exposes enable/disable functions on window for React to call.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('react-root');
if (container) {
  const root = createRoot(container);
  root.render(React.createElement(App));
} else {
  console.error('[React] #react-root not found');
}
