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
  const [chatOpen, setChatOpen] = useState(false);
  const [overlayTransparent, setOverlayTransparent] = useState(
    () => localStorage.getItem('cloe-overlay-transparent') === 'true'
  );

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

  // ── Canvas keyboard shortcut ──
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-canvas-shortcut') || '';
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
        e.preventDefault();
        e.stopPropagation();
        if (visible && mode === 'canvas') {
          hide();
          localStorage.setItem('cloe-terminal-visible', 'false');
        } else {
          show('canvas');
          localStorage.setItem('cloe-terminal-visible', 'true');
          localStorage.setItem('cloe-overlay-mode', 'canvas');
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [visible, mode, show, hide]);

  // ── Chat keyboard shortcut ──
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-chat-shortcut') || '';
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
        e.preventDefault();
        e.stopPropagation();
        window.electronAPI?.toggleChatWindow?.();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

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

  // ── Chat window toggle (separate BrowserWindow) ──
  useEffect(() => {
    // Listen for state updates from main process (when chat window is closed externally)
    const fn = window.electronAPI?.onChatWindowState?.((isOpen) => setChatOpen(isOpen));
    return () => fn?.();
  }, []);

  const toggleChat = useCallback(() => {
    window.electronAPI?.toggleChatWindow?.();
  }, []);

  // ── Overlay transparency toggle (mouse + shortcut) ──
  const toggleOverlayTransparent = useCallback(() => {
    setOverlayTransparent(prev => {
      const next = !prev;
      localStorage.setItem('cloe-overlay-transparent', String(next));
      return next;
    });
  }, []);

  // ── Overlay transparency shortcut ──
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-transparency-shortcut') || '';
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
        e.preventDefault();
        e.stopPropagation();
        toggleOverlayTransparent();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [toggleOverlayTransparent]);

  // ── Settings button click ──
  useEffect(() => {
    const btn = document.getElementById('settings-btn');
    const handler = () => window.electronAPI?.openSettings?.();
    btn?.addEventListener('click', handler);
    return () => btn?.removeEventListener('click', handler);
  }, []);

  // ── Character move shortcuts ──
  const CHAR_MOVE_STEP = 0.05;

  function moveCharacter(direction) {
    fetch('http://127.0.0.1:19851/character-layout')
      .then(r => r.json())
      .then(layout => {
        const pos = { ...layout.position };
        if (direction === 'up') pos.y = Math.max(0, pos.y - CHAR_MOVE_STEP);
        else if (direction === 'down') pos.y = Math.min(1, pos.y + CHAR_MOVE_STEP);
        else if (direction === 'left') pos.x = Math.max(0, pos.x - CHAR_MOVE_STEP);
        else if (direction === 'right') pos.x = Math.min(1, pos.x + CHAR_MOVE_STEP);
        return fetch('http://127.0.0.1:19851/character-layout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: pos }),
        });
      })
      .catch(() => {});
  }

  // Character move up
  useEffect(() => {
    const handler = (e) => {
      // Skip if user is typing in chat input
      if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return;
      const stored = localStorage.getItem('cloe-char-move-up-shortcut') || '';
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
        e.preventDefault();
        e.stopPropagation();
        moveCharacter('up');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // Character move down
  useEffect(() => {
    const handler = (e) => {
      if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return;
      const stored = localStorage.getItem('cloe-char-move-down-shortcut') || '';
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
        e.preventDefault();
        e.stopPropagation();
        moveCharacter('down');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // Character move left
  useEffect(() => {
    const handler = (e) => {
      if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return;
      const stored = localStorage.getItem('cloe-char-move-left-shortcut') || '';
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
        e.preventDefault();
        e.stopPropagation();
        moveCharacter('left');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // Character move right
  useEffect(() => {
    const handler = (e) => {
      if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return;
      const stored = localStorage.getItem('cloe-char-move-right-shortcut') || '';
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
        e.preventDefault();
        e.stopPropagation();
        moveCharacter('right');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className={`terminal-overlay${overlayTransparent ? ' overlay-transparent' : ''}`}>
      <OverlayTitlebar
        onClose={() => { hide(); localStorage.setItem('cloe-terminal-visible', 'false'); }}
        mode={mode}
        onModeChange={setMode}
        onChatToggle={toggleChat}
        chatVisible={chatOpen}
        overlayTransparent={overlayTransparent}
        onToggleTransparent={toggleOverlayTransparent}
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
