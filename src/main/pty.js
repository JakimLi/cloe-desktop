'use strict';

/**
 * PTY — pseudo-terminal multiplexing for the embedded terminal tabs.
 *
 * Extracted verbatim from launcher.js. Each terminal tab owns a PTY keyed by
 * ptyId; output is streamed back to the main renderer window via
 * 'pty-data' IPC.
 *
 * Hard constraint preserved: `node-pty` is required lazily inside spawnPty(),
 * NOT at module top. The packaged app's PATH is repaired by fixPath() at
 * startup; requiring node-pty eagerly would fail before that runs.
 *
 * The only external touchpoint is the main window handle, read through
 * window-registry so this module needs no launcher.js wiring.
 */

const { ipcMain } = require('electron');
const windowRegistry = require('./window-registry');

const ptyMap = new Map();

function spawnPty(ptyId, cols, rows) {
  if (ptyMap.has(ptyId)) return;
  try {
    const pty = require('node-pty');
    const shell = '/bin/zsh';
    const ptyProc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: process.env.HOME || '/Users/lijian',
      env: {
        ...process.env,
        HOME: process.env.HOME || '/Users/lijian',
        SHELL: shell,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });
    ptyProc.onData((data) => {
      const win = windowRegistry.getMainWindow();
      if (win) {
        win.webContents.send('pty-data', { ptyId, data });
      }
    });
    ptyProc.onExit(({ exitCode }) => {
      console.log(`[PTY:${ptyId}] Shell exited with code ${exitCode}`);
      ptyMap.delete(ptyId);
    });
    ptyMap.set(ptyId, ptyProc);
    console.log(`[PTY:${ptyId}] Shell ready`);
  } catch (e) {
    console.error(`[PTY:${ptyId}] Failed to spawn:`, e.message);
  }
}

ipcMain.on('pty-spawn', (_e, { ptyId, cols, rows }) => {
  spawnPty(ptyId, cols, rows);
});

ipcMain.on('pty-write', (_e, { ptyId, data }) => {
  const p = ptyMap.get(ptyId);
  if (p) p.write(data || '');
});

ipcMain.on('pty-resize', (_e, { ptyId, cols, rows }) => {
  const p = ptyMap.get(ptyId);
  if (p) p.resize(cols || 80, rows || 24);
});

ipcMain.on('pty-kill', (_e, { ptyId }) => {
  const p = ptyMap.get(ptyId);
  if (p) {
    p.kill();
    ptyMap.delete(ptyId);
    console.log(`[PTY:${ptyId}] Killed`);
  }
});

module.exports = { spawnPty };
