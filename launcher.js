#!/usr/bin/env node
/**
 * Cloe Desktop — Electron Main Process
 *
 * Responsibilities:
 * 1. Embed WebSocket+HTTP bridge (no external subprocess needed)
 * 2. Create transparent always-on-top window
 * 3. Handle window drag via IPC
 */

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');

// ==================== Config ====================
const WS_PORT = 19850;
const HTTP_PORT = 19851;
// Bind to 0.0.0.0 so external clients (Android via Tailscale) can connect
const BRIDGE_HOST = '0.0.0.0';

let win;
let managerWin = null;
let tray = null;
const bridgeClients = new Set();

// ==================== Actions Data (mirrors renderer.js GIF_ANIMATIONS) ====================
// This is read once at startup to serve via the /actions API.
// In a future version this could be loaded from manifest.json.
const GIF_ANIMATIONS = {
  blink:       'gifs/blink.gif',
  smile:       'gifs/smile.gif',
  kiss:        'gifs/kiss.gif',
  nod:         'gifs/nod.gif',
  wave:        'gifs/wave.gif',
  think:       'gifs/think.gif',
  tease:       'gifs/tease.gif',
  speak:       'gifs/speak.gif',
  shake_head:  'gifs/shake_head.gif',
  working:     'gifs/working.gif',
};

const IDLE_PLAYLIST = ['blink', 'blink', 'smile', 'smile', 'kiss', 'think', 'nod', 'shake_head'];

const ACTION_MAP = {
  smile: 'smile', approve: 'smile', happy: 'smile',
  nod: 'nod', wave: 'wave', think: 'think', tease: 'tease',
  kiss: 'kiss', shake_head: 'shake_head', speak: 'speak',
};

/**
 * Build the actions list for the management API.
 * Classifies each animation by trigger type and idle weight.
 */
function buildActionsList() {
  const idleCounts = {};
  for (const name of IDLE_PLAYLIST) {
    idleCounts[name] = (idleCounts[name] || 0) + 1;
  }

  // Build reverse map: gifName -> action triggers that map to it
  const hookTriggers = {};
  for (const [trigger, gifName] of Object.entries(ACTION_MAP)) {
    if (!hookTriggers[gifName]) hookTriggers[gifName] = [];
    hookTriggers[gifName].push(trigger);
  }

  const actions = [];
  for (const [name, gifPath] of Object.entries(GIF_ANIMATIONS)) {
    const gifFile = gifPath.split('/').pop();
    let trigger = 'manual'; // default
    let idleWeight = 0;
    let hookNames = [];
    let special = null;

    if (name in idleCounts) {
      trigger = 'idle';
      idleWeight = idleCounts[name];
    }

    // Check for special system actions
    if (name === 'blink' && trigger !== 'idle') {
      // blink is always idle
    }
    if (name === 'working') {
      special = '工作模式';
    }
    if (name === 'speak') {
      special = '语音';
    }

    // Collect hook names (action triggers mapped to this gif)
    const hooks = hookTriggers[name];
    if (hooks) {
      hookNames = hooks;
      // If it's also in idle, it's both; otherwise mark as hook
      if (trigger !== 'idle') {
        trigger = 'hook';
      }
    }

    actions.push({
      name,
      gifFile,
      gifPath,
      trigger,
      idleWeight,
      hookNames,
      special,
    });
  }

  return actions;
}

// ==================== Embedded Bridge ====================
function handleActionPost(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const msg = JSON.stringify(data);
      let sent = 0;
      const dead = [];
      for (const ws of bridgeClients) {
        if (ws.readyState === 1) { ws.send(msg); sent++; }
        else dead.push(ws);
      }
      dead.forEach((ws) => bridgeClients.delete(ws));
      console.log(`[HTTP] ${data.action} → ${sent} client(s)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sent_to: sent, action: data }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON' }));
    }
  });
}

function startBridge() {
  return new Promise((resolve) => {
    // If already running (e.g. dev mode with separate vite), reuse it
    const probe = http.get(`http://127.0.0.1:${HTTP_PORT}/status`, () => {
      console.log('[Bridge] Reusing existing instance');
      resolve();
    });
    probe.on('error', () => {
      // Not running — start our own
      createBridgeServers();
      resolve();
    });
  });
}

function createBridgeServers() {
  // --- WebSocket ---
  const wss = new WebSocketServer({ port: WS_PORT, host: BRIDGE_HOST });

  wss.on('connection', (ws) => {
    bridgeClients.add(ws);
    console.log(`[WS] Client connected (${bridgeClients.size})`);

    ws.on('message', (raw) => {
      try { console.log(`[WS] ${raw.toString()}`); } catch (_) {}
    });
    ws.on('error', (e) => console.error(`[WS] ${e.message}`));
    ws.on('close', () => {
      bridgeClients.delete(ws);
      console.log(`[WS] Client disconnected (${bridgeClients.size})`);
    });
  });

  // --- HTTP ---
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ws_port: WS_PORT, http_port: HTTP_PORT, clients: bridgeClients.size }));
      return;
    }

    if (req.method === 'POST' && req.url === '/action') {
      handleActionPost(req, res);
      return;
    }

    // --- Management API ---
    if (req.method === 'GET' && req.url === '/actions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actions: buildActionsList() }));
      return;
    }

    if (req.method === 'POST' && req.url === '/actions/preview') {
      handleActionPost(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(HTTP_PORT, BRIDGE_HOST, () => {
    console.log(`[Bridge] WS: ws://${BRIDGE_HOST}:${WS_PORT}  HTTP: http://${BRIDGE_HOST}:${HTTP_PORT}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    for (const ws of bridgeClients) ws.close();
    wss.close(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 2000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function waitForBridge(maxWait = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryConnect = () => {
      http.get(`http://127.0.0.1:${HTTP_PORT}/status`, (res) => {
        res.resume(); // drain
        console.log('[Bridge] Ready');
        resolve(true);
      }).on('error', () => {
        if (Date.now() - start < maxWait) setTimeout(tryConnect, 300);
        else { console.warn('[Bridge] Not responding, continuing...'); resolve(false); }
      });
    };
    tryConnect();
  });
}

// ==================== Window ====================
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
      webSecurity: false, // required for file:// ES modules
    },
  });

  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

ipcMain.on('window-move', (_e, { dx, dy }) => {
  if (win) {
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }
});

// ==================== Manager Window ====================
function createManagerWindow() {
  if (managerWin) {
    managerWin.show();
    managerWin.focus();
    return;
  }

  managerWin = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Cloe Settings',
    transparent: false,
    frame: true,
    alwaysOnTop: false,
    resizable: true,
    skipTaskbar: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  managerWin.setMenuBarVisibility(false);

  if (!app.isPackaged) {
    // Dev mode: serve manager via Vite dev server for best compatibility
    managerWin.loadURL('http://localhost:5173/manager/index.html');
  } else {
    managerWin.loadFile(path.join(__dirname, 'dist', 'manager', 'index.html'));
  }

  managerWin.on('closed', () => {
    managerWin = null;
  });
}

// ==================== System Tray ====================
function createTray() {
  // macOS tray icon: prefer 22x22 for @1x, resize from larger if needed
  // Template image adapts automatically to light/dark menu bar
  let trayIcon;

  const tryPaths = [
    path.join(__dirname, 'build', 'Cloe.iconset', 'icon_16x16.png'),
    path.join(__dirname, 'build', 'Cloe.iconset', 'icon_32x32.png'),
    path.join(__dirname, 'build', 'Cloe.iconset', 'icon_64x64.png'),
  ];

  for (const p of tryPaths) {
    if (fs.existsSync(p)) {
      trayIcon = nativeImage.createFromPath(p);
      break;
    }
  }

  // If we got an icon, resize to 22x22 for crisp macOS tray display
  if (trayIcon && !trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 22, height: 22 });
    trayIcon.setTemplateImage(true);
  } else {
    // Fallback: try to extract from icns
    const icnsPath = path.join(__dirname, 'build', 'icon.icns');
    if (fs.existsSync(icnsPath)) {
      trayIcon = nativeImage.createFromPath(icnsPath);
      trayIcon = trayIcon.resize({ width: 22, height: 22 });
      trayIcon.setTemplateImage(true);
    } else {
      trayIcon = nativeImage.createEmpty();
    }
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Cloe Desktop');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '设置...',
      click: () => createManagerWindow(),
    },
    { type: 'separator' },
    {
      label: '退出 Cloe',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ==================== Bootstrap ====================
app.whenReady().then(async () => {
  await startBridge();
  await waitForBridge();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed if tray is active
  // The tray menu has an explicit quit option
  if (!tray) {
    app.quit();
  }
});
