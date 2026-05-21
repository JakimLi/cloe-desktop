/**
 * TerminalMode — xterm.js terminal rendered inside the React overlay.
 *
 * Spawns PTY via Electron preload (window.electronAPI), manages fit on resize.
 * Only mounts once; subsequent show/hide toggles are handled by parent App.
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

      // Spawn PTY after DOM renders
      setTimeout(() => {
        if (destroyed) return;
        fit.fit();
        window.electronAPI.ptySpawn(xterm.cols, xterm.rows);
        xterm.focus();
      }, 150);

      // PTY output → xterm
      window.electronAPI.onPtyData((data) => {
        if (!destroyed) xterm.write(data);
      });

      // xterm input → PTY
      xterm.onData((data) => {
        if (!destroyed) window.electronAPI.ptyWrite(data);
      });

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
