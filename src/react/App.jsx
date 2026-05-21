/**
 * App — Root component for the React overlay.
 *
 * Manages overlay visibility (show/hide terminal) and active mode (terminal vs canvas).
 * Listens to localStorage for cross-window toggle signals from settings panel.
 * Delegates to OverlayTitlebar, TerminalMode, and CanvasMode.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Import sub-components ──
import OverlayTitlebar from './OverlayTitlebar';
import TerminalMode from './TerminalMode';
import CanvasMode from './CanvasMode';

export default function App() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState('terminal'); // 'terminal' | 'canvas'

  // ── Show/hide overlay ──
  const show = useCallback((mode) => {
    setVisible(true);
    document.body.classList.add('terminal-mode');
    if (mode === 'canvas') {
      document.body.classList.add('canvas-mode');
      setMode('canvas');
      window.electronAPI?.setWindowMode?.('canvas');
    } else {
      document.body.classList.remove('canvas-mode');
      setMode('terminal');
      window.electronAPI?.setWindowMode?.('terminal');
    }
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    document.body.classList.remove('terminal-mode');
    window.electronAPI?.setWindowMode?.('character');
  }, []);

  // ── Initial state from localStorage ──
  useEffect(() => {
    if (localStorage.getItem('cloe-terminal-visible') === 'true') {
      show();
    }
  }, [show]);

  // ── Cross-window localStorage events (settings panel) ──
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'cloe-terminal-visible') {
        if (e.newValue === 'true') {
          const canvasMode = localStorage.getItem('cloe-overlay-mode') === 'canvas';
          show(canvasMode ? 'canvas' : 'terminal');
        } else {
          hide();
        }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [show, hide]);

  // ── HTTP bridge commands (from launcher.js /canvas/show|hide) ──
  useEffect(() => {
    const handler = (e) => {
      const cmd = e.detail;
      if (!cmd || !cmd.action) return;
      if (cmd.action === 'show') {
        const m = (cmd.mode === 'canvas') ? 'canvas' : 'terminal';
        show(m);
      } else if (cmd.action === 'hide') {
        hide();
      }
    };
    window.addEventListener('cloe-bridge', handler);
    return () => window.removeEventListener('cloe-bridge', handler);
  }, [show, hide]);

  // ── Keyboard shortcut (capture phase, before xterm) ──
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-terminal-shortcut') || '';
      if (!stored) return;
      const parts = stored.toLowerCase().split('+');
      const key = parts[parts.length - 1];
      const wantCmd = parts.some(p => ['cmd', 'commandorcontrol', 'command'].includes(p));
      const wantCtrl = parts.some(p => ['control', 'ctrl'].includes(p));
      const wantAlt = parts.includes('alt');
      const wantShift = parts.includes('shift');

      if (e.metaKey === wantCmd && e.ctrlKey === wantCtrl &&
          e.altKey === wantAlt && e.shiftKey === wantShift &&
          e.key.toUpperCase() === key.toUpperCase()) {
        // In normal mode: skip if xterm has focus
        if (!visible && document.activeElement?.classList?.contains('xterm-helper-textarea')) return;
        e.preventDefault();
        e.stopPropagation();
        if (visible) {
          hide();
          localStorage.setItem('cloe-terminal-visible', 'false');
        } else {
          show();
          localStorage.setItem('cloe-terminal-visible', 'true');
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [visible, show, hide]);

  // ── Fullscreen change re-fit ──
  useEffect(() => {
    let unsub = null;
    try {
      const fn = window.electronAPI && window.electronAPI.onFullscreenChanged;
      if (typeof fn === 'function') {
        unsub = fn(() => window.dispatchEvent(new Event('resize')));
      }
    } catch (_) { /* preload not available in dev */ }
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // ── Settings button shortcut sync ──
  useEffect(() => {
    let last = '';
    const iv = setInterval(() => {
      const accel = localStorage.getItem('cloe-terminal-shortcut') || '';
      if (accel !== last) {
        last = accel;
        window.electronAPI?.setTerminalShortcut?.(accel);
      }
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  // ── Settings button click ──
  useEffect(() => {
    const btn = document.getElementById('settings-btn');
    const handler = () => window.electronAPI?.openSettings?.();
    btn?.addEventListener('click', handler);
    return () => btn?.removeEventListener('click', handler);
  }, []);

  if (!visible) return null;

  return (
    <div className="terminal-overlay">
      <OverlayTitlebar
        onClose={() => { hide(); localStorage.setItem('cloe-terminal-visible', 'false'); }}
        mode={mode}
        onModeChange={setMode}
      />
      <div style={{ position: 'absolute', top: 32, left: 0, right: 0, bottom: 0 }}>
        <div style={{ display: mode === 'terminal' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
          <TerminalMode />
        </div>
        <div style={{ display: mode === 'canvas' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
          <CanvasMode />
        </div>
      </div>
    </div>
  );
}
