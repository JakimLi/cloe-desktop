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
import TabBar, { TabCloseConfirm } from './TabBar';
import { useTerminalTabs } from './useTerminalTabs';
import { matchesShortcut, parseShortcutParts, isModifierKeyUp } from './utils/shortcut';
import AgentSessionModal from './AgentSessionModal';

const API_BASE = 'http://127.0.0.1:19851';

function MuteToast({ toast }) {
  if (!toast) return null;
  const text = toast.muted ? '已静音' : '已恢复语音';
  return (
    <div style={toastStyle}>
      {toast.muted ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
      <span style={toastTextStyle}>{text}</span>
    </div>
  );
}

function PauseToast({ toast }) {
  if (!toast) return null;
  const text = toast.paused
    ? `已暂停 ${toast.count} 个提醒`
    : `已恢复 ${toast.count} 个提醒`;
  return (
    <div style={toastStyle}>
      {toast.paused ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      )}
      <span style={toastTextStyle}>{text}</span>
    </div>
  );
}

const toastStyle = {
  position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
  zIndex: 200, display: 'flex', alignItems: 'center', gap: 10,
  background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(40px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
  border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10,
  padding: '10px 18px', boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
  animation: 'mute-toast-in 0.2s ease-out',
};
const toastTextStyle = { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: 500 };

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

  // ── Tab close confirmation (shared by shortcut + TabBar) ──
  const [pendingCloseTab, setPendingCloseTab] = useState(null);
  const requestCloseTab = useCallback((tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) setPendingCloseTab(tab);
  }, [tabs]);

  // Dismiss close-confirm on Escape
  useEffect(() => {
    if (!pendingCloseTab) return;
    const handler = (e) => { if (e.key === 'Escape') setPendingCloseTab(null); };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [pendingCloseTab]);

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

      // Cmd+1..9: jump to tab by index (1-based, like browsers/iTerm2)
      if (e.metaKey && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(e.key, 10) - 1;
        if (idx < tabs.length) setActiveTabId(tabs[idx].id);
        return;
      }

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
      // Cmd+W: close current tab (with confirmation)
      if (matchesShortcut(e, closeSc)) {
        e.preventDefault(); e.stopPropagation();
        requestCloseTab(activeTabId); return;
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
  }, [visible, mode, activeTabId, tabs, createTab, closeTab, nextTab, prevTab]);

  // ── Tab switcher: hold modifier + tap trigger key to cycle, release modifier to confirm ──
  // Behavior (like macOS Cmd+Tab or browser Ctrl+Tab):
  //   1. Press modifier+trigger → show switcher, highlight current tab
  //   2. Keep holding modifier, press trigger again → cycle to next tab
  //   3. Release modifier → confirm switch, close switcher
  //   4. Release trigger without releasing modifier → keep switcher open (do nothing)
  useEffect(() => {
    if (!visible || mode !== 'terminal') return;

    const stored = localStorage.getItem('cloe-tab-switch-shortcut') || 'Alt+Tab';
    const parts = parseShortcutParts(stored);
    if (!parts) return;

    const onKeyDown = (e) => {
      // Trigger key pressed while modifier held (first or repeat)
      if (e.key === parts.key && (
        (!parts.hasMeta || e.metaKey) &&
        (!parts.hasCtrl || e.ctrlKey) &&
        (!parts.hasAlt || e.altKey) &&
        (!parts.hasShift || e.shiftKey)
      )) {
        e.preventDefault();
        e.stopPropagation();
        if (!switcherVisible) {
          // First press: open switcher at current tab
          setPendingTabId(activeTabId);
          setSwitcherVisible(true);
        } else {
          // Subsequent taps: cycle to next
          setPendingTabId(prev => {
            const idx = tabs.findIndex(t => t.id === prev);
            if (idx === -1 || tabs.length <= 1) return prev;
            return tabs[(idx + 1) % tabs.length].id;
          });
        }
      }
    };

    const onKeyUp = (e) => {
      // Modifier released → confirm and close
      if (switcherVisible && isModifierKeyUp(e, parts)) {
        e.preventDefault();
        e.stopPropagation();
        setActiveTabId(pendingTabId);
        setSwitcherVisible(false);
      }
      // Trigger key released alone → do nothing (keep open, wait for modifier release)
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  }, [visible, mode, tabs, activeTabId, switcherVisible, pendingTabId]);

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

  // ── Agent Session Tracker ──
  const [agentSessions, setAgentSessions] = useState([]);
  const [agentModalVisible, setAgentModalVisible] = useState(false);

  // Sync sessions from WS events
  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (!msg || !msg.type) return;
      if (msg.type === 'agent-session-registered' || msg.type === 'agent-session-updated' || msg.type === 'agent-session-title-set') {
        if (msg.session) {
          setAgentSessions(prev => {
            const idx = prev.findIndex(s => s.id === msg.session.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg.session;
              return next;
            }
            return [...prev, msg.session];
          });
        }
      } else if (msg.type === 'agent-session-ended' || msg.type === 'agent-session-cancelled') {
        if (msg.session_id) {
          setAgentSessions(prev => prev.filter(s => s.id !== msg.session_id));
        }
      }
    };
    window.addEventListener('cloe-agent-session', handler);
    return () => window.removeEventListener('cloe-agent-session', handler);
  }, []);

  // Initial fetch on first open
  useEffect(() => {
    if (!visible) return;
    fetch(`${API_BASE}/agent-sessions`)
      .then(r => r.json())
      .then(data => { if (data.sessions) setAgentSessions(data.sessions); })
      .catch(() => {});
  }, [visible]);

  // Agent modal shortcut
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-agent-tracker-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
      e.preventDefault();
      e.stopPropagation();
      setAgentModalVisible(prev => !prev);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // ESC to close agent modal
  useEffect(() => {
    if (!agentModalVisible) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setAgentModalVisible(false);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [agentModalVisible]);

  const handleAgentSetTitle = useCallback((id, title) => {
    fetch(`${API_BASE}/agent-sessions/${encodeURIComponent(id)}/title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }, []);

  const handleAgentCancel = useCallback((id) => {
    fetch(`${API_BASE}/agent-sessions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }).catch(() => {});
  }, []);

  // ── Global Mute Toggle ──
  const [muted, setMuted] = useState(false);
  const [muteToast, setMuteToast] = useState(null); // { muted: boolean, ts: number }

  // Sync mute state from WS events (e.g. toggled from another window)
  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (msg.type === 'mute-state-changed') {
        setMuted(msg.muted);
        setMuteToast({ muted: msg.muted, ts: Date.now() });
      }
    };
    window.addEventListener('cloe-mute-state', handler);
    return () => window.removeEventListener('cloe-mute-state', handler);
  }, []);

  // Auto-hide toast after 2s
  useEffect(() => {
    if (!muteToast) return;
    const timer = setTimeout(() => setMuteToast(null), 2000);
    return () => clearTimeout(timer);
  }, [muteToast]);

  // Mute toggle shortcut
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-mute-toggle-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
      e.preventDefault();
      e.stopPropagation();
      // POST toggle-mute, server will broadcast back
      fetch(`${API_BASE}/toggle-mute`, { method: 'POST' }).catch(() => {});
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // ── Global Pause Toggle ──
  const [globalPaused, setGlobalPaused] = useState(false);
  const [pauseToast, setPauseToast] = useState(null); // { paused: boolean, count: number, ts: number }

  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (msg.type === 'global-pause-changed') {
        setGlobalPaused(msg.paused);
        setPauseToast({ paused: msg.paused, count: msg.count || 0, ts: Date.now() });
      }
    };
    window.addEventListener('cloe-global-pause', handler);
    return () => window.removeEventListener('cloe-global-pause', handler);
  }, []);

  useEffect(() => {
    if (!pauseToast) return;
    const timer = setTimeout(() => setPauseToast(null), 2500);
    return () => clearTimeout(timer);
  }, [pauseToast]);

  // Global pause toggle shortcut
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-global-pause-toggle-shortcut') || '';
      if (!stored) return;
      if (!matchesShortcut(e, stored)) return;
      e.preventDefault();
      e.stopPropagation();
      fetch(`${API_BASE}/toggle-global-pause`, { method: 'POST' }).catch(() => {});
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  if (!visible) {
    return (
      <>
        <AgentSessionModal
          visible={agentModalVisible}
          sessions={agentSessions}
          onSetTitle={handleAgentSetTitle}
          onCancel={handleAgentCancel}
          onClose={() => setAgentModalVisible(false)}
        />
        <MuteToast toast={muteToast} />
        <PauseToast toast={pauseToast} />
      </>
    );
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
      >
        {mode === 'terminal' && (
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={setActiveTabId}
            onCreate={createTab}
            onClose={requestCloseTab}
            onRename={updateTabTitle}
          />
        )}
      </OverlayTitlebar>
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
      <TabCloseConfirm
        tab={pendingCloseTab}
        onConfirm={() => {
          if (pendingCloseTab) closeTab(pendingCloseTab.id);
          setPendingCloseTab(null);
        }}
        onCancel={() => setPendingCloseTab(null)}
      />
      <AgentSessionModal
        visible={agentModalVisible}
        sessions={agentSessions}
        onSetTitle={handleAgentSetTitle}
        onCancel={handleAgentCancel}
        onClose={() => setAgentModalVisible(false)}
      />
      <MuteToast toast={muteToast} />
      <PauseToast toast={pauseToast} />
    </div>
  );
}
