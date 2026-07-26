/**
 * TerminalMode — Multi-tab xterm.js terminal renderer.
 *
 * Manages a pool of xterm.js instances (one per tab). Only the active
 * tab's xterm is visible; others are hidden via display:none and lazily
 * initialized on first activation.
 *
 * PTY I/O is routed through window.electronAPI with ptyId to distinguish
 * multiple PTY sessions. Tab titles are auto-updated from OSC escape sequences.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getThemeById, DEFAULT_THEME_ID } from './terminalThemes';

const OSC_TITLE_RE = /\x1b\][012];([^\x07]*)\x07/;

/** Lazily create a single xterm instance attached to the given container. */
async function createXtermInstance(container, themeId) {
  const { Terminal } = await import('xterm');
  const { FitAddon } = await import('@xterm/addon-fit');
  await import('xterm/css/xterm.css');

  const xterm = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 14,
    lineHeight: 1.3,
    fontFamily: "'SF Mono', 'Menlo', 'Consolas', 'Courier New', monospace",
    theme: getThemeById(themeId).theme,
    allowTransparency: true,
    scrollback: 5000,
    macOptionIsMeta: true,
    bellStyle: 'none',
  });

  const fit = new FitAddon();
  xterm.loadAddon(fit);
  xterm.open(container);

  return { xterm, fit };
}

export default function TerminalMode({ tabs, activeTabId, updateTabTitle }) {
  // One container ref per tab — always mounted, display toggled
  const containerRefs = useRef({});
  const rootRef = useRef(null);
  const xtermPool = useRef(new Map()); // tabId → { xterm, fit }
  const initialized = useRef(false);

  const [xtermReady, setXtermReady] = useState(false);

  // Theme state
  const [themeId, setThemeId] = useState(
    () => localStorage.getItem('cloe-terminal-theme') || DEFAULT_THEME_ID
  );

  const applyTheme = useCallback((id) => {
    const themeData = getThemeById(id);
    xtermPool.current.forEach(({ xterm }) => {
      xterm.options.theme = themeData.theme;
    });
    document.documentElement.style.setProperty('--terminal-bg', themeData.bg);
  }, []);

  useEffect(() => { applyTheme(themeId); }, [themeId, applyTheme]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'cloe-terminal-theme' && e.newValue) setThemeId(e.newValue);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  useEffect(() => {
    window.cloeSetTerminalTheme = (id) => {
      localStorage.setItem('cloe-terminal-theme', id);
      setThemeId(id);
    };
    return () => { delete window.cloeSetTerminalTheme; };
  }, []);

  // ── Initialize PTY listener and xterm pool ──────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    let destroyed = false;

    // PTY output → route to the correct xterm instance
    window.electronAPI.onPtyData((ptyId, data) => {
      if (destroyed) return;

      // Extract OSC title and notify parent
      const oscMatch = data.match(OSC_TITLE_RE);
      if (oscMatch) {
        updateTabTitle(ptyId, oscMatch[1]);
      }

      let entry = xtermPool.current.get(ptyId);
      if (!entry) return; // tab not yet visible — data is lost (acceptable)
      entry.xterm.write(data);
    });

    // Spawn the default PTY on first load
    const firstTab = tabs[0];
    if (firstTab) {
      window.electronAPI.ptySpawn(firstTab.id, 80, 24);
    }

    return () => { destroyed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Ensure every tab has a container ref (sync, not in useEffect!) ─
  // Must happen during render so the ref exists when JSX binds it.
  for (const tab of tabs) {
    if (!containerRefs.current[tab.id]) {
      containerRefs.current[tab.id] = React.createRef();
    }
  }

  // ── Activate a tab: lazy-create xterm, fit, focus ─────────────
  const ensureXtermForTab = useCallback(async (tabId) => {
    let entry = xtermPool.current.get(tabId);
    if (entry) return entry;

    const containerEl = containerRefs.current[tabId]?.current;
    if (!containerEl) return null;

    const { xterm, fit } = await createXtermInstance(containerEl, themeId);
    entry = { xterm, fit };


    // Keyboard input → PTY
    xterm.onData((data) => {
      // Block control chars that sneak through shortcut handlers
      if (data === '\x1f' || data === '\x07') return;
      window.electronAPI.ptyWrite(tabId, data);
    });


    xtermPool.current.set(tabId, entry);

    // Spawn PTY for this tab if not already done
    window.electronAPI.ptySpawn(tabId, 80, 24);

    return entry;
  }, [themeId, updateTabTitle]);

  // ── Activate tab: ensure xterm, fit, focus ─────────────────────
  useEffect(() => {
    // Deactivate previous
    xtermPool.current.forEach((entry, tabId) => {
      if (tabId !== activeTabId && entry.xterm.element) {
        entry.xterm.element.style.display = 'none';
      }
    });

    // Activate current (async because xterm import is dynamic)
    ensureXtermForTab(activeTabId).then((entry) => {
      if (entry) {
        entry.xterm.element.style.display = '';
        // Delay fit: the window may still be animating to its new size
        // (IPC setWindowMode('terminal') triggers win.setSize which is async)
        setTimeout(() => {
          try { entry.fit.fit(); } catch {}
          entry.xterm.focus();
          setXtermReady(true);
        }, 150);
        // Safety net: re-fit after window resize settles
        setTimeout(() => {
          try { entry.fit.fit(); } catch {}
          window.electronAPI?.ptyResize?.(activeTabId, entry.xterm.cols, entry.xterm.rows);
        }, 400);
      }

      // Update global ref for backward compatibility
      const activeEntry = xtermPool.current.get(activeTabId);
      window.xtermInstance = activeEntry?.xterm || null;
    });
  }, [activeTabId, ensureXtermForTab]);

  // ── Resize handler ──────────────────────────────────────────────
  // Uses ResizeObserver on the container to catch ALL size changes:
  // window resize, overlay show/hide, mode switch, maximize/restore.
  // Re-subscribes when activeTabId changes or when xterm first becomes ready.
  useEffect(() => {
    const container = rootRef.current;
    if (!container) return;

    let resizeTimer = null;
    const doFit = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const entry = xtermPool.current.get(activeTabId);
        if (!entry) return;
        try { entry.fit.fit(); } catch {}
        window.electronAPI.ptyResize(activeTabId, entry.xterm.cols, entry.xterm.rows);
      }, 30);
    };

    const ro = new ResizeObserver(() => doFit());
    ro.observe(container);
    // Also fit immediately when this effect re-runs (e.g. xterm just became ready)
    doFit();

    return () => {
      ro.disconnect();
      clearTimeout(resizeTimer);
    };
  }, [activeTabId, xtermReady]);

  // ── Tab creation: spawn PTY when new tab added ────────────────────
  useEffect(() => {
    for (const tab of tabs) {
      if (!xtermPool.current.has(tab.id)) {
        // PTY will be spawned in ensureXtermForTab when tab is first activated
      }
    }
  }, [tabs]);


  // ── Render ──────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="terminal-container" style={{ position: 'absolute', inset: 0, padding: '8px 16px 8px 16px' }}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          ref={containerRefs.current[tab.id]}
          style={{
            display: tab.id === activeTabId ? 'block' : 'none',
            position: 'absolute',
            top: '8px', left: '16px', right: '16px', bottom: '8px',
          }}
        />
      ))}
    </div>
  );
}
