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
  });

  const fit = new FitAddon();
  xterm.loadAddon(fit);
  xterm.open(container);

  return { xterm, fit };
}

export default function TerminalMode({ tabs, activeTabId, updateTabTitle }) {
  // One container ref per tab — always mounted, display toggled
  const containerRefs = useRef({});
  const xtermPool = useRef(new Map()); // tabId → { xterm, fit }
  const initialized = useRef(false);

  // Comment input overlay state (Code Walk)
  const [showInput, setShowInput] = useState(false);
  const inputRef = useRef(null);
  const codeWalkRef = useRef(null);

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
      if (!entry._codeWalk?.active) {
        entry.xterm.write(data);
      }
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

    // ── Code Walk setup (per-instance) ──
    entry._codeWalk = {
      active: false, steps: [], current: 0,
      comments: [], summaryShown: false, diffMode: false,

      start(renderedSteps) {
        const cw = entry._codeWalk;
        cw.active = true; cw.steps = renderedSteps; cw.current = 0;
        cw.comments = []; cw.summaryShown = false; cw.diffMode = false;
        xterm.write('\x1b[?1l\x1b[3J\x1b[2J\x1b[H\x1b[?25l');
        try { fit.fit(); } catch {}
        cw.render(0);
      },

      stop(forceQuit) {
        const cw = entry._codeWalk;
        if (!forceQuit && cw.comments.length > 0 && !cw.summaryShown) {
          cw.showSummary(); return;
        }
        cw.active = false; cw.steps = []; cw.current = 0;
        cw.comments = []; cw.summaryShown = false; cw.diffMode = false;
        xterm.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25h');
        window.electronAPI.ptyWrite(tabId, '\x0c');
      },

      render(index) {
        const cw = entry._codeWalk;
        const step = cw.steps[index]; if (!step) return;
        const total = cw.steps.length;
        xterm.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25l');
        xterm.write('\x1b[1;36m╔═══ ' + (step.title || 'Step ' + (index + 1)) + ' ═══╗\x1b[0m\r\n');
        xterm.write('\x1b[90m  ' + (step.file || '') + ':' + (step.start || '') + '-' + (step.end || '') + '\x1b[0m\r\n');
        if (cw.diffMode) {
          xterm.write('\r\n\x1b[1;33m📊 Diff (HEAD → working tree)\x1b[0m\r\n');
          if (step.diffAnsi) { xterm.write('\r\n'); xterm.write(step.diffAnsi.replace(/\r?\n/g, '\r\n')); }
          else { xterm.write('\r\n\x1b[90m  (no uncommitted changes)\x1b[0m\r\n'); }
        } else {
          xterm.write('\r\n');
          if (step.ansi) xterm.write(step.ansi.replace(/\r?\n/g, '\r\n'));
          if (step.note) xterm.write('\r\n\x1b[33m💡 ' + step.note + '\x1b[0m\r\n');
        }
        const sc = cw.comments.filter(c => c.stepIndex === index);
        if (sc.length > 0) {
          xterm.write('\r\n\x1b[36m💬 Comments (' + sc.length + '):\x1b[0m\r\n');
          for (const c of sc) xterm.write('\x1b[90m  • \x1b[0m' + c.text + '\r\n');
        }
        const cc = cw.comments.length;
        const badge = cc > 0 ? ' \x1b[33m[' + cc + ' comment' + (cc > 1 ? 's' : '') + ']\x1b[0m' : '';
        const db = cw.diffMode ? ' \x1b[1;32m[DIFF]\x1b[0m' : '';
        xterm.write('\r\n\x1b[90m── [n] next  [p] prev  [c] comment  [d] diff  [j/k] scroll  [↑↓] scroll  [q/Esc] quit ── ' + (index + 1) + '/' + total + badge + db + ' ──\x1b[0m');
        xterm.scrollToTop();
      },

      next() { const cw = entry._codeWalk; if (cw.current < cw.steps.length - 1) { cw.current++; cw.render(cw.current); } else { xterm.write('\x1b[s\x1b[999;1H\r\n\x1b[90m── already at last step ──\x1b[0m\x1b[u'); } },
      prev() { const cw = entry._codeWalk; if (cw.current > 0) { cw.current--; cw.render(cw.current); } else { xterm.write('\x1b[s\x1b[999;1H\r\n\x1b[90m── already at first step ──\x1b[0m\x1b[u'); } },
      submitComment(text) { const cw = entry._codeWalk; const t = (text || '').trim(); if (t) { const s = cw.steps[cw.current]; cw.comments.push({ stepIndex: cw.current, stepTitle: s?.title || '', file: s?.file || '', lines: (s?.start || '') + '-' + (s?.end || ''), text: t, timestamp: new Date().toISOString() }); } cw.render(cw.current); },
      refocus() { xterm.focus(); },
      toggleDiff() { const cw = entry._codeWalk; cw.diffMode = !cw.diffMode; cw.render(cw.current); },
      showSummary() { const cw = entry._codeWalk; cw.summaryShown = true; xterm.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25l'); xterm.write('\x1b[1;36m╔══════════════════════════════════════╗\x1b[0m\r\n'); xterm.write('\x1b[1;36m║      📋 Code Review Summary          ║\x1b[0m\r\n'); xterm.write('\x1b[1;36m╚══════════════════════════════════════╝\x1b[0m\r\n\r\n'); if (cw.comments.length === 0) { xterm.write('\x1b[90m  No comments submitted.\x1b[0m\r\n'); } else { let p = -1; for (const c of cw.comments) { if (c.stepIndex !== p) { if (p >= 0) xterm.write('\r\n'); xterm.write('\x1b[33m  Step ' + (c.stepIndex + 1) + ': ' + c.stepTitle + '\x1b[0m\r\n'); xterm.write('\x1b[90m  ' + c.file + ':' + c.lines + '\x1b[0m\r\n'); p = c.stepIndex; } xterm.write('\x1b[36m  💬 \x1b[0m' + c.text + '\r\n'); } xterm.write('\r\n\x1b[90m  ── Total: ' + cw.comments.length + ' comment' + (cw.comments.length > 1 ? 's' : '') + ' ──\x1b[0m\r\n'); } xterm.write('\r\n\x1b[90m── [Enter/q] close & submit  [p] go back to review ──\x1b[0m'); },
    };

    // Keyboard input → PTY or code walk
    xterm.onData((data) => {
      const cw = entry._codeWalk;
      if (cw.active) {
        if (cw.summaryShown) {
          if (data === '\x1b' || data === 'q' || data === 'Q' || data === '\r') { cw.stop(true); return; }
          if (data === 'p' || data === 'P') { cw.summaryShown = false; cw.render(cw.current); return; }
          return;
        }
        if (data === '\x1b') { cw.stop(); return; }
        if (data === 'n' || data === 'N' || data === ' ') { cw.next(); return; }
        if (data === 'p' || data === 'P') { cw.prev(); return; }
        if (data === 'q' || data === 'Q') { cw.stop(); return; }
        if (data === 'c' || data === 'C') { setShowInput(true); codeWalkRef.current = cw; return; }
        if (data === 'd' || data === 'D') { cw.toggleDiff(); return; }
        if (data === 'j') { xterm.scrollLines(3); return; }
        if (data === 'k') { xterm.scrollLines(-3); return; }
        if (data === '\x1b[A' || data === '\x1bOA') { xterm.scrollLines(-3); return; }
        if (data === '\x1b[B' || data === '\x1bOB') { xterm.scrollLines(3); return; }
        if (data === '\x1b[5~') { xterm.scrollPages(-1); return; }
        if (data === '\x1b[6~') { xterm.scrollPages(1); return; }
        if (data === '\x1b[H' || data === '\x1bOH') { xterm.scrollToTop(); return; }
        if (data === '\x1b[F' || data === '\x1bOF') { xterm.scrollToBottom(); return; }
        return;
      }
      window.electronAPI.ptyWrite(tabId, data);
    });

    // Expose for code walk triggers
    if (!window.cloeCodeWalk) window.cloeCodeWalk = entry._codeWalk;

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
        setTimeout(() => {
          try { entry.fit.fit(); } catch {}
          entry.xterm.focus();
        }, 50);
      }

      // Update global ref for backward compatibility
      const activeEntry = xtermPool.current.get(activeTabId);
      window.xtermInstance = activeEntry?.xterm || null;
    });
  }, [activeTabId, ensureXtermForTab]);

  // ── Resize handler ──────────────────────────────────────────────
  useEffect(() => {
    const doResize = () => {
      const entry = xtermPool.current.get(activeTabId);
      if (!entry) return;
      try { entry.fit.fit(); } catch {}
      window.electronAPI.ptyResize(activeTabId, entry.xterm.cols, entry.xterm.rows);
    };
    window.addEventListener('resize', doResize);
    return () => window.removeEventListener('resize', doResize);
  }, [activeTabId]);

  // ── Tab creation: spawn PTY when new tab added ────────────────────
  useEffect(() => {
    for (const tab of tabs) {
      if (!xtermPool.current.has(tab.id)) {
        // PTY will be spawned in ensureXtermForTab when tab is first activated
      }
    }
  }, [tabs]);

  // ── Comment input handlers ──────────────────────────────────────
  const handleCommentSubmit = useCallback((text) => {
    setShowInput(false);
    setTimeout(() => { if (codeWalkRef.current) codeWalkRef.current.refocus(); }, 0);
    if (codeWalkRef.current) codeWalkRef.current.submitComment(text);
  }, []);

  const handleCommentCancel = useCallback(() => {
    setShowInput(false);
    setTimeout(() => { if (codeWalkRef.current) codeWalkRef.current.refocus(); }, 0);
  }, []);

  useEffect(() => {
    if (showInput && inputRef.current) inputRef.current.focus();
  }, [showInput]);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="terminal-container" style={{ position: 'absolute', inset: 0 }}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          ref={containerRefs.current[tab.id]}
          style={{
            display: tab.id === activeTabId ? 'block' : 'none',
            position: 'absolute',
            inset: 0,
          }}
        />
      ))}
      {showInput && (
        <div style={{
          position: 'absolute', bottom: '40px', left: '10px', right: '10px', zIndex: 100,
        }}>
          <div style={{
            background: 'rgba(26, 26, 46, 0.95)', border: '1px solid #26c6da',
            borderRadius: '6px', padding: '10px 14px',
          }}>
            <div style={{ color: '#26c6da', fontSize: '13px', marginBottom: '6px' }}>
              💬 Comment — Enter 提交 · Esc 取消
            </div>
            <input
              ref={inputRef}
              type="text"
              style={{
                width: '100%', background: 'rgba(0,0,0,0.4)', border: 'none',
                outline: 'none', color: '#e0e0e0', fontSize: '14px',
                fontFamily: "'SF Mono', 'Menlo', monospace",
                padding: '6px 10px', borderRadius: '4px', caretColor: '#26c6da',
              }}
              placeholder="输入评论..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleCommentSubmit(e.target.value); }
                else if (e.key === 'Escape') { e.preventDefault(); handleCommentCancel(); }
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (codeWalkRef.current && codeWalkRef.current.active) handleCommentCancel();
                }, 150);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
