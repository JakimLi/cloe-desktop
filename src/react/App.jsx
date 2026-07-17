/**
 * App — Root component for the React overlay.
 *
 * Manages overlay visibility (show/hide terminal) and active mode (terminal vs canvas).
 * Listens to localStorage for cross-window toggle signals from settings panel.
 * Delegates to OverlayTitlebar, TerminalMode, CanvasMode, and TabSwitcher.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Import sub-components ──
import OverlayTitlebar from './OverlayTitlebar';
import TerminalMode from './TerminalMode';
import CanvasMode from './CanvasMode';
import TabSwitcher from './TabSwitcher';
import { useTerminalTabs } from './useTerminalTabs';
import { matchesShortcut } from './utils/shortcut';

export default function App() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState('terminal'); // 'terminal' | 'canvas'
  const [chatOpen, setChatOpen] = useState(false);
  // 3-level transparency: 'semi' (0.15) → 'full' (transparent) → 'opaque' (1.0 black)
  const [overlayTransparency, setOverlayTransparency] = useState(
    () => {
      // Migrate old boolean key
      const old = localStorage.getItem('cloe-overlay-transparent');
      const val = localStorage.getItem('cloe-overlay-transparency');
      if (val && ['semi', 'full', 'opaque'].includes(val)) return val;
      if (old === 'true') { localStorage.setItem('cloe-overlay-transparency', 'full'); return 'full'; }
      return 'semi';
    }
  );

  // ── Terminal multi-tab state ──
  const {
    tabs, activeTabId, setActiveTabId,
    createTab, closeTab, updateTabTitle, nextTab, prevTab,
  } = useTerminalTabs();

  // ── Tab switcher overlay state ──
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [pendingTabId, setPendingTabId] = useState(activeTabId);

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
      if (!matchesShortcut(e, stored)) return;
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
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [visible, show, hide]);

  // ── Canvas keyboard shortcut ──
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-canvas-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
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
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [visible, mode, show, hide]);

  // ── Chat keyboard shortcut ──
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-chat-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
      e.preventDefault();
      e.stopPropagation();
      window.electronAPI?.toggleChatWindow?.();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // ── Terminal tab shortcuts (only when visible + terminal mode) ──
  useEffect(() => {
    const handler = (e) => {
      // All tab shortcuts require visible terminal overlay
      if (!visible || mode !== 'terminal') return;

      // Read configurable shortcuts from localStorage (with defaults)
      const newSc = localStorage.getItem('cloe-tab-new-shortcut') || 'Cmd+T';
      const closeSc = localStorage.getItem('cloe-tab-close-shortcut') || 'Cmd+W';
      const prevSc = localStorage.getItem('cloe-tab-prev-shortcut') || 'Cmd+Shift+[';
      const nextSc = localStorage.getItem('cloe-tab-next-shortcut') || 'Cmd+Shift+]';

      // Cmd+T: new tab
      if (matchesShortcut(e, newSc)) {
        e.preventDefault(); e.stopPropagation();
        createTab(); return;
      }
      // Cmd+W: close current tab
      if (matchesShortcut(e, closeSc)) {
        e.preventDefault(); e.stopPropagation();
        closeTab(activeTabId); return;
      }
      // Cmd+Shift+[: prev tab
      if (matchesShortcut(e, prevSc)) {
        e.preventDefault(); e.stopPropagation();
        prevTab(); return;
      }
      // Cmd+Shift+]: next tab
      if (matchesShortcut(e, nextSc)) {
        e.preventDefault(); e.stopPropagation();
        nextTab(); return;
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [visible, mode, activeTabId, createTab, closeTab, nextTab, prevTab]);

  // ── Tab switcher shortcut (Cmd+Tab hold → cycle, release → switch) ──
  useEffect(() => {
    const handler = (e) => {
      if (!visible || mode !== 'terminal') return;
      const stored = localStorage.getItem('cloe-tab-switch-shortcut') || 'Alt+Tab';
      if (!matchesShortcut(e, stored)) return;

      e.preventDefault();
      if (e.repeat) {
        // Cycle to next tab
        setPendingTabId(prev => {
          const idx = tabs.findIndex(t => t.id === prev);
          if (idx === -1 || tabs.length <= 1) return prev;
          return tabs[(idx + 1) % tabs.length].id;
        });
      } else {
        // First press: show switcher
        setPendingTabId(activeTabId);
        setSwitcherVisible(true);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [visible, mode, tabs, activeTabId]);

  useEffect(() => {
    const handler = (e) => {
      if (!switcherVisible) return;
      const stored = localStorage.getItem('cloe-tab-switch-shortcut') || 'Alt+Tab';
      if (!matchesShortcut(e, stored)) return;

      e.preventDefault();
      setActiveTabId(pendingTabId);
      setSwitcherVisible(false);
    };
    document.addEventListener('keyup', handler, true);
    return () => document.removeEventListener('keyup', handler, true);
  }, [switcherVisible, pendingTabId]);

  // Dismiss switcher if focus is lost (e.g. another shortcut fires)
  useEffect(() => {
    if (!switcherVisible) return;
    const timer = setTimeout(() => {
      setSwitcherVisible(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [switcherVisible]);

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
    const fn = window.electronAPI?.onChatWindowState?.((isOpen) => setChatOpen(isOpen));
    return () => fn?.();
  }, []);

  const toggleChat = useCallback(() => {
    window.electronAPI?.toggleChatWindow?.();
  }, []);

  // ── Overlay transparency toggle: cycle semi → full → opaque ──
  const toggleOverlayTransparent = useCallback(() => {
    setOverlayTransparency(prev => {
      const cycle = { semi: 'full', full: 'opaque', opaque: 'semi' };
      const next = cycle[prev] || 'semi';
      localStorage.setItem('cloe-overlay-transparency', next);
      return next;
    });
  }, []);

  // ── Overlay transparency shortcut ──
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-transparency-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleOverlayTransparent();
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

  const charMoveKeys = [
    { key: 'cloe-char-move-up-shortcut', dir: 'up' },
    { key: 'cloe-char-move-down-shortcut', dir: 'down' },
    { key: 'cloe-char-move-left-shortcut', dir: 'left' },
    { key: 'cloe-char-move-right-shortcut', dir: 'right' },
  ];

  charMoveKeys.forEach(({ key, dir }) => {
    useEffect(() => {
      const handler = (e) => {
        const ae = document.activeElement;
        if ((ae?.tagName === 'TEXTAREA' || ae?.tagName === 'INPUT') && !ae?.classList.contains('xterm-helper-textarea')) return;
        const stored = localStorage.getItem(key) || '';
        if (!stored) return;
        if (!matchesShortcut(e, stored)) return;
        e.preventDefault();
        e.stopPropagation();
        moveCharacter(dir);
      };
      document.addEventListener('keydown', handler, true);
      return () => document.removeEventListener('keydown', handler, true);
    }, [dir]);
  });

  // ── Character scale shortcuts ──
  const CHAR_SCALE_STEP = 0.1;
  const CHAR_SCALE_MIN = 0.3;
  const CHAR_SCALE_MAX = 3.0;

  function scaleCharacter(direction) {
    fetch('http://127.0.0.1:19851/character-layout')
      .then(r => r.json())
      .then(layout => {
        const scale = direction === 'up'
          ? Math.min(CHAR_SCALE_MAX, (layout.size?.scale ?? 1) + CHAR_SCALE_STEP)
          : Math.max(CHAR_SCALE_MIN, (layout.size?.scale ?? 1) - CHAR_SCALE_STEP);
        return fetch('http://127.0.0.1:19851/character-layout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ size: { scale } }),
        });
      })
      .catch(() => {});
  }

  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-char-scale-up-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
      e.preventDefault();
      e.stopPropagation();
      scaleCharacter('up');
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-char-scale-down-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
      e.preventDefault();
      e.stopPropagation();
      scaleCharacter('down');
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // ── Reminder shortcuts ──
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-reminder-dismiss-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
      e.preventDefault();
      e.stopPropagation();
      if (window.ReminderOverlay && ReminderOverlay.hasActive()) {
        ReminderOverlay.dismissActive();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-reminder-stop-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
      e.preventDefault();
      e.stopPropagation();
      if (window.ReminderOverlay && ReminderOverlay.hasActive()) {
        ReminderOverlay.stopActive();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className={`terminal-overlay${overlayTransparency === 'full' ? ' overlay-transparent' : overlayTransparency === 'opaque' ? ' overlay-opaque' : ' overlay-semi'}`}>
      <OverlayTitlebar
        onClose={() => { hide(); localStorage.setItem('cloe-terminal-visible', 'false'); }}
        mode={mode}
        onModeChange={setMode}
        onChatToggle={toggleChat}
        chatVisible={chatOpen}
        overlayTransparency={overlayTransparency}
        onToggleTransparent={toggleOverlayTransparent}
      />
      <div style={{ position: 'absolute', top: 32, left: 0, right: 0, bottom: 0 }}>
        <div style={{ display: mode === 'terminal' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
          <TerminalMode tabs={tabs} activeTabId={activeTabId} updateTabTitle={updateTabTitle} />
          {switcherVisible && (
            <TabSwitcher tabs={tabs} pendingTabId={pendingTabId} />
          )}
        </div>
        <div style={{ display: mode === 'canvas' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
          <CanvasMode />
        </div>
      </div>
    </div>
  );
}
