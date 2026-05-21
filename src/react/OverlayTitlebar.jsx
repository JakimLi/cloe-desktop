/**
 * OverlayTitlebar — macOS-style titlebar for the terminal/canvas overlay.
 * Traffic lights (hover reveal), mode switcher, drag region.
 */

import React from 'react';

export default function OverlayTitlebar({ onClose, mode, onModeChange }) {
  return (
    <div className="terminal-titlebar">
      {/* Traffic lights (hover reveal) */}
      <div className="terminal-traffic-lights">
        <button className="traffic-light traffic-close" title="Exit Terminal" onClick={onClose} />
        <button className="traffic-light traffic-minimize" title="Minimize" onClick={() => window.electronAPI?.minimizeWindow?.()} />
        <button className="traffic-light traffic-fullscreen" title="Fullscreen" onClick={() => window.electronAPI?.toggleFullscreen?.()} />
      </div>

      {/* Mode switcher: ⌨ Terminal / 🎨 Canvas */}
      <div className="titlebar-mode-switcher">
        <button
          className={`mode-btn ${mode === 'terminal' ? 'active' : ''}`}
          title="Terminal"
          onClick={() => onModeChange('terminal')}
        >⌨</button>
        <button
          className={`mode-btn ${mode === 'canvas' ? 'active' : ''}`}
          title="Canvas"
          onClick={() => onModeChange('canvas')}
        >🎨</button>
      </div>

      {/* Drag region */}
      <div className="terminal-drag-region" />
    </div>
  );
}
