/**
 * TerminalMode — xterm.js terminal rendered inside the React overlay.
 *
 * Spawns PTY via Electron preload (window.electronAPI), manages fit on resize.
 * Includes Code Walk mode for interactive code walkthroughs with comments.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

export default function TerminalMode() {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const initialized = useRef(false);

  // Comment input overlay state
  const [showInput, setShowInput] = useState(false);
  const codeWalkRef = useRef(null);

  const handleCommentSubmit = useCallback((text) => {
    setShowInput(false);
    // Must refocus xterm after input overlay disappears
    setTimeout(() => {
      if (codeWalkRef.current) codeWalkRef.current.refocus();
    }, 0);
    if (codeWalkRef.current) {
      codeWalkRef.current.submitComment(text);
    }
  }, []);

  const handleCommentCancel = useCallback(() => {
    setShowInput(false);
    setTimeout(() => {
      if (codeWalkRef.current) codeWalkRef.current.refocus();
    }, 0);
  }, []);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  useEffect(() => {
    if (initialized.current || !containerRef.current) return;
    initialized.current = true;

    let destroyed = false;

    (async () => {
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('xterm/css/xterm.css');

      if (destroyed || !containerRef.current) return;

      const xterm = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 14,
        lineHeight: 1.3,
        fontFamily: "'SF Mono', 'Menlo', 'Consolas', 'Courier New', monospace",
        theme: {
          background: 'transparent',
          foreground: '#e0e0e0',
          cursor: '#80cbc4',
          cursorAccent: 'transparent',
          selectionBackground: 'rgba(100, 181, 246, 0.3)',
          selectionForeground: '#ffffff',
          black: '#1a1a2e',
          red: '#ef5350',
          green: '#66bb6a',
          yellow: '#ffca28',
          blue: '#42a5f5',
          magenta: '#ab47bc',
          cyan: '#26c6da',
          white: '#e0e0e0',
          brightBlack: '#666666',
          brightRed: '#ef9a9a',
          brightGreen: '#a5d6a7',
          brightYellow: '#ffe082',
          brightBlue: '#90caf9',
          brightMagenta: '#ce93d8',
          brightCyan: '#80deea',
          brightWhite: '#ffffff',
        },
        allowTransparency: true,
        scrollback: 5000,
        macOptionIsMeta: true,
      });

      const fit = new FitAddon();
      xterm.loadAddon(fit);
      xterm.open(containerRef.current);

      window.xtermInstance = xterm;

      // ── Code Walk Mode ────────────────────────────────────────────
      const codeWalk = {
        active: false,
        steps: [],
        current: 0,
        comments: [],       // { stepIndex, stepTitle, file, lines, text }
        summaryShown: false,
        diffMode: false,    // toggle git diff view
        _onCommentDone: null, // callback after comment submitted/cancelled

        start(renderedSteps) {
          codeWalk.active = true;
          codeWalk.steps = renderedSteps;
          codeWalk.current = 0;
          codeWalk.comments = [];
          codeWalk.summaryShown = false;
          codeWalk.diffMode = false;
          xterm.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25l');
          codeWalk.render(0);
        },

        stop(forceQuit) {
          // If comments exist and not yet shown summary, show it first
          if (!forceQuit && codeWalk.comments.length > 0 && !codeWalk.summaryShown) {
            codeWalk.showSummary();
            return;
          }
          codeWalk.active = false;
          codeWalk.steps = [];
          codeWalk.current = 0;
          codeWalk.comments = [];
          codeWalk.summaryShown = false;
          codeWalk.diffMode = false;
          xterm.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25h');
          window.electronAPI.ptyWrite('\x0c');
        },

        render(index) {
          const step = codeWalk.steps[index];
          if (!step) return;
          const total = codeWalk.steps.length;
          xterm.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25l');

          const header = step.title || ('Step ' + (index + 1));
          xterm.write('\x1b[1;36m╔═══ ' + header + ' ═══╗\x1b[0m\r\n');
          xterm.write('\x1b[90m  ' + (step.file || '') + ':' + (step.start || '') + '-' + (step.end || '') + '\x1b[0m\r\n');

          if (codeWalk.diffMode) {
            // ── Diff view ──
            xterm.write('\r\n\x1b[1;33m📊 Diff (HEAD → working tree)\x1b[0m\r\n');
            if (step.diffAnsi) {
              xterm.write('\r\n');
              xterm.write(step.diffAnsi.replace(/\r?\n/g, '\r\n'));
            } else {
              xterm.write('\r\n\x1b[90m  (no uncommitted changes for this file)\x1b[0m\r\n');
            }
          } else {
            // ── Normal code view ──
            xterm.write('\r\n');
            if (step.ansi) {
              xterm.write(step.ansi.replace(/\r?\n/g, '\r\n'));
            }

            if (step.note) {
              xterm.write('\r\n\x1b[33m💡 ' + step.note + '\x1b[0m\r\n');
            }
          }

          // Show existing comments for this step
          const stepComments = codeWalk.comments.filter(c => c.stepIndex === index);
          if (stepComments.length > 0) {
            xterm.write('\r\n\x1b[36m💬 Comments (' + stepComments.length + '):\x1b[0m\r\n');
            for (const c of stepComments) {
              xterm.write('\x1b[90m  • \x1b[0m' + c.text + '\r\n');
            }
          }

          const commentCount = codeWalk.comments.length;
          const badge = commentCount > 0
            ? ' \x1b[33m[' + commentCount + ' comment' + (commentCount > 1 ? 's' : '') + ']\x1b[0m'
            : '';
          const diffBadge = codeWalk.diffMode ? ' \x1b[1;32m[DIFF]\x1b[0m' : '';
          xterm.write('\r\n\x1b[90m── [n] next  [p] prev  [c] comment  [d] diff  [j/k] scroll  [↑↓] scroll  [q/Esc] quit ── '
            + (index + 1) + '/' + total + badge + diffBadge + ' ──\x1b[0m');
          xterm.scrollToTop();
        },

        next() {
          if (codeWalk.current < codeWalk.steps.length - 1) {
            codeWalk.current++;
            codeWalk.render(codeWalk.current);
          } else {
            xterm.write('\x1b[s\x1b[999;1H\r\n\x1b[90m── already at last step ──\x1b[0m\x1b[u');
          }
        },

        prev() {
          if (codeWalk.current > 0) {
            codeWalk.current--;
            codeWalk.render(codeWalk.current);
          } else {
            xterm.write('\x1b[s\x1b[999;1H\r\n\x1b[90m── already at first step ──\x1b[0m\x1b[u');
          }
        },

        submitComment(text) {
          const trimmed = (text || '').trim();
          if (trimmed) {
            const step = codeWalk.steps[codeWalk.current];
            codeWalk.comments.push({
              stepIndex: codeWalk.current,
              stepTitle: step?.title || '',
              file: step?.file || '',
              lines: (step?.start || '') + '-' + (step?.end || ''),
              text: trimmed,
              timestamp: new Date().toISOString(),
            });
          }
          codeWalk.render(codeWalk.current);
        },

        refocus() {
          xterm.focus();
        },

        toggleDiff() {
          codeWalk.diffMode = !codeWalk.diffMode;
          codeWalk.render(codeWalk.current);
        },

        showSummary() {
          codeWalk.summaryShown = true;
          xterm.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25l');
          xterm.write('\x1b[1;36m╔══════════════════════════════════════╗\x1b[0m\r\n');
          xterm.write('\x1b[1;36m║      📋 Code Review Summary          ║\x1b[0m\r\n');
          xterm.write('\x1b[1;36m╚══════════════════════════════════════╝\x1b[0m\r\n\r\n');

          if (codeWalk.comments.length === 0) {
            xterm.write('\x1b[90m  No comments submitted.\x1b[0m\r\n');
          } else {
            let prevStep = -1;
            for (const c of codeWalk.comments) {
              if (c.stepIndex !== prevStep) {
                if (prevStep >= 0) xterm.write('\r\n');
                xterm.write('\x1b[33m  Step ' + (c.stepIndex + 1) + ': ' + c.stepTitle + '\x1b[0m\r\n');
                xterm.write('\x1b[90m  ' + c.file + ':' + c.lines + '\x1b[0m\r\n');
                prevStep = c.stepIndex;
              }
              xterm.write('\x1b[36m  💬 \x1b[0m' + c.text + '\r\n');
            }
            xterm.write('\r\n\x1b[90m  ── Total: ' + codeWalk.comments.length + ' comment'
              + (codeWalk.comments.length > 1 ? 's' : '') + ' ──\x1b[0m\r\n');
          }

          xterm.write('\r\n\x1b[90m── [Enter/q] close & submit  [p] go back to review ──\x1b[0m');
        },
      };

      window.cloeCodeWalk = codeWalk;
      codeWalkRef.current = codeWalk;

      // ── PTY output → xterm (filtered during codeWalk) ─────────────
      window.electronAPI.onPtyData((data) => {
        if (!destroyed && !codeWalk.active) xterm.write(data);
      });

      // ── xterm input → PTY or codeWalk handler ─────────────────────
      xterm.onData((data) => {
        if (destroyed) return;

        // Code Walk mode
        if (codeWalk.active) {
          // Summary view
          if (codeWalk.summaryShown) {
            if (data === '\x1b' || data === 'q' || data === 'Q' || data === '\r') {
              codeWalk.stop(true);
              return;
            }
            if (data === 'p' || data === 'P') {
              codeWalk.summaryShown = false;
              codeWalk.render(codeWalk.current);
              return;
            }
            return;
          }

          // Normal walkthrough navigation (comment input handled by HTML overlay)
          // xterm.onData 收到的是终端协议字符串，不是键盘事件。
          // \x1b = ESC (ASCII 27)，后面跟 [ + 字母/数字组成 ANSI escape sequence。
          if (data === '\x1b') { codeWalk.stop(); return; }              // Esc → 退出
          if (data === 'n' || data === 'N' || data === ' ') { codeWalk.next(); return; }
          if (data === 'p' || data === 'P') { codeWalk.prev(); return; }
          if (data === 'q' || data === 'Q') { codeWalk.stop(); return; }
          if (data === 'c' || data === 'C') {
            // Trigger React state to show HTML input overlay
            setShowInput(true);
            return;
          }
          if (data === 'd' || data === 'D') { codeWalk.toggleDiff(); return; }
          if (data === 'j') { xterm.scrollLines(3); return; }           // vim: j — 向下滚动3行
          if (data === 'k') { xterm.scrollLines(-3); return; }          // vim: k — 向上滚动3行
          if (data === '\x1b[A') { xterm.scrollLines(-3); return; }      // ArrowUp 键 — 向上滚动3行
          if (data === '\x1b[B') { xterm.scrollLines(3); return; }       // ArrowDown 键 — 向下滚动3行
          if (data === '\x1b[5~') { xterm.scrollPages(-1); return; }     // PageUp 键 — 向上翻1页
          if (data === '\x1b[6~') { xterm.scrollPages(1); return; }      // PageDown 键 — 向下翻1页
          if (data === '\x1b[H') { xterm.scrollToTop(); return; }        // Home 键 — 滚动到顶部
          if (data === '\x1b[F') { xterm.scrollToBottom(); return; }     // End 键 — 滚动到底部
          return;
        }

        // Normal mode: forward to PTY
        window.electronAPI.ptyWrite(data);
      });

      // Spawn PTY after DOM renders
      setTimeout(() => {
        if (destroyed) return;
        fit.fit();
        window.electronAPI.ptySpawn(xterm.cols, xterm.rows);
        xterm.focus();
      }, 150);

      // Resize
      const doResize = () => {
        try { fit.fit(); } catch {}
        if (!destroyed) window.electronAPI.ptyResize(xterm.cols, xterm.rows);
      };
      window.addEventListener('resize', doResize);
    })();

    return () => {
      destroyed = true;
      window.removeEventListener('resize', () => {});
    };
  }, []);

  return (
    <div className="terminal-container" style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {showInput && (
        <div style={{
          position: 'absolute',
          bottom: '40px',
          left: '10px',
          right: '10px',
          zIndex: 100,
        }}>
          <div style={{
            background: 'rgba(26, 26, 46, 0.95)',
            border: '1px solid #26c6da',
            borderRadius: '6px',
            padding: '10px 14px',
          }}>
            <div style={{ color: '#26c6da', fontSize: '13px', marginBottom: '6px' }}>
              💬 Comment — Enter 提交 · Esc 取消
            </div>
            <input
              ref={inputRef}
              type="text"
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.4)',
                border: 'none',
                outline: 'none',
                color: '#e0e0e0',
                fontSize: '14px',
                fontFamily: "'SF Mono', 'Menlo', monospace",
                padding: '6px 10px',
                borderRadius: '4px',
                caretColor: '#26c6da',
              }}
              placeholder="输入评论..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCommentSubmit(e.target.value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCommentCancel();
                }
              }}
              onBlur={() => {
                // Small delay to allow Enter/Esc to fire first
                setTimeout(() => {
                  if (codeWalkRef.current && codeWalkRef.current.active) {
                    handleCommentCancel();
                  }
                }, 150);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
