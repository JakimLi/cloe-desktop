/**
 * TerminalMode — xterm.js terminal rendered inside the React overlay.
 *
 * Spawns PTY via Electron preload (window.electronAPI), manages fit on resize.
 * Includes Code Walk mode for interactive code walkthroughs.
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

        start(renderedSteps) {
          codeWalk.active = true;
          codeWalk.steps = renderedSteps;
          codeWalk.current = 0;
          xterm.write('\x1b[2J\x1b[H\x1b[?25l'); // clear screen + hide cursor
          codeWalk.render(0);
        },

        stop() {
          codeWalk.active = false;
          codeWalk.steps = [];
          codeWalk.current = 0;
          xterm.write('\x1b[2J\x1b[H\x1b[?25h'); // clear screen + show cursor
          // Ctrl+L to redraw shell prompt
          window.electronAPI.ptyWrite('\x0c');
        },

        render(index) {
          const step = codeWalk.steps[index];
          if (!step) return;
          const total = codeWalk.steps.length;
          xterm.write('\x1b[2J\x1b[H');

          // Header: step title with accent
          const header = step.title || ('Step ' + (index + 1));
          xterm.write('\x1b[1;36m╔═══ ' + header + ' ═══╗\x1b[0m\r\n');
          xterm.write('\x1b[90m  ' + (step.file || '') + ':' + (step.start || '') + '-' + (step.end || '') + '\x1b[0m\r\n');
          xterm.write('\r\n');

          // Code content (pre-rendered ANSI from bat)
          if (step.ansi) {
            xterm.write(step.ansi);
          }

          // Note
          if (step.note) {
            xterm.write('\r\n\x1b[33m💡 ' + step.note + '\x1b[0m\r\n');
          }

          // Footer: navigation hints + progress
          xterm.write('\r\n\x1b[90m── [n] next  [p] prev  [↑↓] scroll  [q/Esc] quit ── ' + (index + 1) + '/' + total + ' ──\x1b[0m');
          xterm.scrollToTop();
        },

        next() {
          if (codeWalk.current < codeWalk.steps.length - 1) {
            codeWalk.current++;
            codeWalk.render(codeWalk.current);
          } else {
            // Flash hint at last step
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
        }
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
          // Single Escape key
          if (data === '\x1b') { codeWalk.stop(); return; }
          // Next/Prev step
          if (data === 'n' || data === 'N') { codeWalk.next(); return; }
          if (data === 'p' || data === 'P') { codeWalk.prev(); return; }
          // Quit
          if (data === 'q' || data === 'Q') { codeWalk.stop(); return; }
          // Arrow Up / Down → scroll
          if (data === '\x1b[A') { xterm.scrollLines(-3); return; }
          if (data === '\x1b[B') { xterm.scrollLines(3); return; }
          // PageUp / PageDown
          if (data === '\x1b[5~') { xterm.scrollPages(-1); return; }
          if (data === '\x1b[6~') { xterm.scrollPages(1); return; }
          // Home / End
          if (data === '\x1b[H') { xterm.scrollToTop(); return; }
          if (data === '\x1b[F') { xterm.scrollToBottom(); return; }
          // Space → next step (convenient)
          if (data === ' ') { codeWalk.next(); return; }
          // Ignore all other input
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
