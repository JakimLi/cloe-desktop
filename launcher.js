#!/usr/bin/env node
/**
 * Cloe Desktop Launcher
 * 
 * 启动顺序：
 * 1. 启动 ws_bridge_node.js (Node.js WebSocket+HTTP bridge)
 * 2. 等待 ws_bridge 就绪
 * 3. 启动 Electron 窗口
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

let win;
let bridgeProcess = null;

const WS_PORT = 19850;
const HTTP_PORT = 19851;

function startBridge() {
  return new Promise((resolve) => {
    // Check if bridge is already running
    const check = () => {
      const req = http.get(`http://127.0.0.1:${HTTP_PORT}/status`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('[Launcher] ws_bridge already running');
          resolve(true);
        });
      });
      req.on('error', () => resolve(false));
    };

    check();
  }).then(running => {
    if (running) return;

    // Start Node.js bridge
    const isDev = !app.isPackaged;
    let bridgeScript;

    if (isDev) {
      bridgeScript = path.join(__dirname, 'ws_bridge_node.js');
    } else {
      bridgeScript = path.join(process.resourcesPath, 'ws_bridge_node.js');
    }

    console.log(`[Launcher] Starting ws_bridge: ${bridgeScript}`);

    bridgeProcess = fork(bridgeScript, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env },
    });

    bridgeProcess.stdout.on('data', (data) => {
      console.log(`[ws_bridge] ${data.toString().trim()}`);
    });

    bridgeProcess.stderr.on('data', (data) => {
      console.error(`[ws_bridge] ${data.toString().trim()}`);
    });

    bridgeProcess.on('error', (err) => {
      console.error(`[Launcher] Failed to start ws_bridge: ${err.message}`);
    });

    bridgeProcess.on('close', (code) => {
      console.log(`[ws_bridge] exited with code ${code}`);
      bridgeProcess = null;
    });
  });
}

function waitForBridge(maxWait = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryConnect = () => {
      const req = http.get(`http://127.0.0.1:${HTTP_PORT}/status`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('[Launcher] ws_bridge ready');
          resolve(true);
        });
      });
      req.on('error', () => {
        if (Date.now() - start < maxWait) {
          setTimeout(tryConnect, 500);
        } else {
          console.warn('[Launcher] ws_bridge not responding, continuing anyway...');
          resolve(false);
        }
      });
    };
    tryConnect();
  });
}

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 380,
    height: 520,
    x: sw - 400,
    y: sh - 540,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

// Window drag via IPC
ipcMain.on('window-move', (_e, { dx, dy }) => {
  if (win) {
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }
});

app.whenReady().then(async () => {
  await startBridge();
  await waitForBridge();
  createWindow();
});

app.on('window-all-closed', () => {
  if (bridgeProcess) {
    bridgeProcess.kill();
    bridgeProcess = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (bridgeProcess) {
    bridgeProcess.kill();
    bridgeProcess = null;
  }
});
