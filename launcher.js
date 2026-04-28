#!/usr/bin/env node
/**
 * Cloe Desktop Launcher
 * 
 * 启动顺序：
 * 1. 内嵌启动 WebSocket+HTTP bridge（无需外部 node 进程）
 * 2. 等待 bridge 就绪
 * 3. 启动 Electron 窗口
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const http = require('http');

let win;

const WS_PORT = 19850;
const HTTP_PORT = 19851;

// ==================== Embedded WebSocket+HTTP Bridge ====================
const { WebSocketServer } = require('ws');
const bridgeClients = new Set();

function startEmbeddedBridge() {
  return new Promise((resolve) => {
    // Check if bridge is already running (e.g. dev mode)
    const check = http.get(`http://127.0.0.1:${HTTP_PORT}/status`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('[Bridge] Already running, skipping');
        resolve();
      });
    });
    check.on('error', () => {
      // Not running, start our own
      startBridgeServers();
      resolve();
    });
  });
}

function startBridgeServers() {
  // WebSocket server
  const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });

  wss.on('connection', (ws) => {
    bridgeClients.add(ws);
    console.log(`[WS] Client connected (${bridgeClients.size} total)`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log(`[WS] Received: ${JSON.stringify(msg)}`);
      } catch (e) {
        console.error(`[WS] Parse error: ${e.message}`);
      }
    });

    ws.on('error', (err) => console.error(`[WS] Error: ${err.message}`));
    ws.on('close', () => {
      bridgeClients.delete(ws);
      console.log(`[WS] Client disconnected (${bridgeClients.size} total)`);
    });
  });

  console.log(`WebSocket server: ws://127.0.0.1:${WS_PORT}`);

  // HTTP server
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ws_port: WS_PORT, http_port: HTTP_PORT, clients: bridgeClients.size }));
      return;
    }

    if (req.method === 'POST' && req.url === '/action') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const msg = JSON.stringify(data);
          let sent = 0;
          const dead = [];
          for (const ws of bridgeClients) {
            if (ws.readyState === 1) { sent++; ws.send(msg); }
            else { dead.push(ws); }
          }
          dead.forEach(ws => bridgeClients.delete(ws));
          console.log(`[HTTP] action=${data.action} → ${sent} client(s)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ sent_to: sent, action: data }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`HTTP API: http://127.0.0.1:${HTTP_PORT}`);
    console.log(`Trigger: curl -s http://localhost:${HTTP_PORT}/action -d '{"action":"smile"}'`);
  });

  // Graceful shutdown
  function shutdown() {
    console.log('[Bridge] Shutting down...');
    for (const ws of bridgeClients) ws.close();
    wss.close(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 2000);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function waitForBridge(maxWait = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryConnect = () => {
      const req = http.get(`http://127.0.0.1:${HTTP_PORT}/status`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('[Launcher] Bridge ready');
          resolve(true);
        });
      });
      req.on('error', () => {
        if (Date.now() - start < maxWait) {
          setTimeout(tryConnect, 500);
        } else {
          console.warn('[Launcher] Bridge not responding, continuing anyway...');
          resolve(false);
        }
      });
    };
    tryConnect();
  });
}

// ==================== Electron Window ====================
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
      webSecurity: false, // allow file:// protocol modules
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
  await startEmbeddedBridge();
  await waitForBridge();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
