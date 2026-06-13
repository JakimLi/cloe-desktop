/**
 * TerminalMode — xterm.js terminal rendered inside the React overlay.
 *
 * Spawns PTY via Electron preload (window.electronAPI), manages fit on resize.
 * Includes Code Walk mode for interactive code walkthroughs with comments.
 */

import React, { useEffect, useRef } from 'react';

export default function TerminalMode() {
  const containerRef = useRef(null);
  const initialized = useRef(false);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    if (initialized.current || !containerRef.current) return;
    initialized.current = true;

    let destroyed = false;

    (async () => {
      // Dynamic import — xterm is heavy, load on demand
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

      xtermRef.current = xterm;
      fitRef.current = fit;

      // Expose to window for DevTools and effect engine
      window.xtermInstance = xterm;

      // ── Code Walk Mode ────────────────────────────────────────────
      const codeWalk = {
        active: false,
        steps: [],
        current: 0,
        comments: [],      // { stepIndex, stepTitle, file, lines, text, timestamp }
        inputMode: false,   // true when user is typing a comment
        commentBuffer: '',  // current input text
        summaryShown: false, // true when summary is displayed

        start(renderedSteps) {
          codeWalk.active = true;
          codeWalk.steps = renderedSteps;
          codeWalk.current = 0;
          codeWalk.comments = [];
          codeWalk.inputMode = false;
          codeWalk.commentBuffer = '';
          codeWalk.summaryShown = false;
          xterm.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25l'); // clear scrollback + screen + hide cursor
          codeWalk.render(0);
        },

        stop(forceQuit) {
          // If there are comments and user presses q/Esc, show summary first
          if (!forceQuit && codeWalk.comments.length > 0 && !codeWalk.summaryShown) {
            codeWalk.showSummary();
            return;
          }
          codeWalk.active = false;
          codeWalk.steps = [];
          codeWalk.current = 0;
          codeWalk.comments = [];
          codeWalk.inputMode = false;
          codeWalk.commentBuffer = '';
          codeWalk.summaryShown = false;
          xterm.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25h'); // clear scrollback + screen + show cursor
          // Ctrl+L to redraw shell prompt
          window.electronAPI.ptyWrite('\x0c');
        },

        render(index) {
          const step = codeWalk.steps[index];
          if (!step) return;
          const total = codeWalk.steps.length;
          xterm.write('\x1b[3J\x1b[2J\x1b[H');
          xterm.write('\x1b[?25l'); // hide cursor during display

          // Header: step title with accent
          const header = step.title || ('Step ' + (index + 1));
          xterm.write('\x1b[1;36m╔═══ ' + header + ' ═══╗\x1b[0m\r\n');
          xterm.write('\x1b[90m  ' + (step.file || '') + ':' + (step.start || '') + '-' + (step.end || '') + '\x1b[0m\r\n');
          xterm.write('\r\n');

          // Code content (pre-rendered ANSI from bat)
          if (step.ansi) {
            // bat outputs \n but xterm needs \r\n for proper carriage return
            xterm.write(step.ansi.replace(/\r?\n/g, '\r\n'));
          }

          // Note
          if (step.note) {
            xterm.write('\r\n\x1b[33m💡 ' + step.note + '\x1b[0m\r\n');
          }

          // Show existing comments for this step
          const stepComments = codeWalk.comments.filter(c => c.stepIndex === index);
          if (stepComments.length > 0) {
            xterm.write('\r\n\x1b[36m💬 Comments (' + stepComments.length + '):\x1b[0m\r\n');
            for (const c of stepComments) {
              xterm.write('\x1b[90m  • \x1b[0m' + c.text + '\r\n');
            }
          }

          // Footer: navigation hints + progress
          const commentCount = codeWalk.comments.length;
          const commentBadge = commentCount > 0 ? ' \x1b[33m[' + commentCount + ' comment' + (commentCount > 1 ? 's' : '') + ']\x1b[0m' : '';
          xterm.write('\r\n\x1b[90m── [n] next  [p] prev  [c] comment  [↑↓] scroll  [q/Esc] quit ── ' + (index + 1) + '/' + total + commentBadge + ' ──\x1b[0m');
          xterm.scrollToTop();
        },

        enterCommentMode() {
          codeWalk.inputMode = true;
          codeWalk.commentBuffer = '';
          // Show input prompt at bottom area
          xterm.write('\x1b[?25h'); // show cursor for typing
          xterm.write('\r\n\x1b[1;36m💬 Comment (Enter to submit, Esc to cancel):\x1b[0m\r\n');
          xterm.write('\x1b[36m> \x1b[0m');
        },

        submitComment() {
          const text = codeWalk.commentBuffer.trim();
          if (text) {
            const step = codeWalk.steps[codeWalk.current];
            codeWalk.comments.push({
              stepIndex: codeWalk.current,
              stepTitle: step?.title || '',
              file: step?.file || '',
              lines: (step?.start || '') + '-' + (step?.end || ''),
              text,
              timestamp: new Date().toISOString(),
            });
          }
          codeWalk.inputMode = false;
          codeWalk.commentBuffer = '';
          codeWalk.render(codeWalk.current); // re-render to show the new comment
        },

        cancelComment() {
          codeWalk.inputMode = false;
          codeWalk.commentBuffer = '';
          codeWalk.render(codeWalk.current);
        },

        handleCommentInput(data) {
          // Enter → submit comment (but not during IME composition)
          if (data === '\r' || data === '\n') {
            // If we just received IME text, this Enter might be the IME confirm
            // Skip submit — user can press Enter again to actually submit
            if (codeWalk._imeJustComposed) {
              codeWalk._imeJustComposed = false;
              return true;
            }
            codeWalk.submitComment();
            return true;
          }
          if (data === '\x1b') { // Escape
            codeWalk.cancelComment();
            return true;
          }
          if (data === '\x7f' || data === '\b') { // Backspace
            if (codeWalk.commentBuffer.length > 0) {
              const lastChar = codeWalk.commentBuffer.slice(-1);
              codeWalk.commentBuffer = codeWalk.commentBuffer.slice(0, -1);
              // Wide chars (CJK) take 2 columns, need to erase 2
              const w = lastChar.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u2e80-\u2eff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/) ? 2 : 1;
              xterm.write('\b \b'.repeat(w > 1 ? 2 : 1));
            }
            return true;
          }
          // Ctrl+C cancel
          if (data === '\x03') {
            codeWalk.cancelComment();
            return true;
          }
          // Printable text (single char or IME-composed string like 中文)
          // Filter out control sequences (ESC[...) but allow printable text
          if (!/^\x1b/.test(data)) {
            codeWalk.commentBuffer += data;
            xterm.write(data);
            // Mark that IME text just arrived — next Enter is likely IME confirm, not submit
            if (data.length > 1 || /[\u4e00-\u9fff]/.test(data)) {
              codeWalk._imeJustComposed = true;
            }
            return true;
          }
          return true; // consume all input during comment mode
        },

        showSummary() {
          codeWalk.summaryShown = true;
          xterm.write('\x1b[3J\x1b[2J\x1b[H');
          xterm.write('\x1b[?25l'); // hide cursor
          xterm.write('\x1b[1;36m╔══════════════════════════════════════╗\x1b[0m\r\n');
          xterm.write('\x1b[1;36m║      📋 Code Review Summary          ║\x1b[0m\r\n');
          xterm.write('\x1b[1;36m╚══════════════════════════════════════╝\x1b[0m\r\n\r\n');

          if (codeWalk.comments.length === 0) {
            xterm.write('\x1b[90m  No comments submitted.\x1b[0m\r\n');
          } else {
            let prevStep = -1;
            for (let i = 0; i < codeWalk.comments.length; i++) {
              const c = codeWalk.comments[i];
              if (c.stepIndex !== prevStep) {
                if (prevStep >= 0) xterm.write('\r\n');
                xterm.write('\x1b[33m  Step ' + (c.stepIndex + 1) + ': ' + c.stepTitle + '\x1b[0m\r\n');
                xterm.write('\x1b[90m  ' + c.file + ':' + c.lines + '\x1b[0m\r\n');
                prevStep = c.stepIndex;
              }
              xterm.write('\x1b[36m  💬 \x1b[0m' + c.text + '\r\n');
            }
            xterm.write('\r\n\x1b[90m  ── Total: ' + codeWalk.comments.length + ' comment' + (codeWalk.comments.length > 1 ? 's' : '') + ' ──\x1b[0m\r\n');
          }

          xterm.write('\r\n\x1b[90m── [Enter/q] close & submit  [p] go back to review ──\x1b[0m');
        },
      };

      window.cloeCodeWalk = codeWalk;

      // ── PTY output → xterm (filtered during codeWalk) ─────────────
      window.electronAPI.onPtyData((data) => {
        if (!destroyed && !codeWalk.active) xterm.write(data);
      });

      // ── xterm input → PTY or codeWalk handler ─────────────────────
      xterm.onData((data) => {
        if (destroyed) return;

        // Code Walk mode: intercept all keyboard input
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

          // Comment input mode — intercept everything
          if (codeWalk.inputMode) {
            codeWalk.handleCommentInput(data);
            return;
          }

          // Normal walkthrough navigation
          if (data === '\x1b') { codeWalk.stop(); return; }
          if (data === 'n' || data === 'N' || data === ' ') { codeWalk.next(); return; }
          if (data === 'p' || data === 'P') { codeWalk.prev(); return; }
          if (data === 'q' || data === 'Q') { codeWalk.stop(); return; }
          if (data === 'c' || data === 'C') { codeWalk.enterCommentMode(); return; }
          if (data === '\x1b[A') { xterm.scrollLines(-3); return; }
          if (data === '\x1b[B') { xterm.scrollLines(3); return; }
          if (data === '\x1b[5~') { xterm.scrollPages(-1); return; }
          if (data === '\x1b[6~') { xterm.scrollPages(1); return; }
          if (data === '\x1b[H') { xterm.scrollToTop(); return; }
          if (data === '\x1b[F') { xterm.scrollToBottom(); return; }
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

  return <div ref={containerRef} className="terminal-container" />;
}
