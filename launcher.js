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

// ==================== Action Sets — loaded from action-sets.json ====================
let actionSetsData = null;
let activeSetId = 'default';

function loadActionSets() {
  const manifestPath = path.join(__dirname, 'public', 'action-sets.json');
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    actionSetsData = JSON.parse(raw);
    activeSetId = actionSetsData.activeSetId || 'default';
    console.log(`[ActionSets] Loaded ${actionSetsData.sets.length} set(s), active: ${activeSetId}`);
  } catch (err) {
    console.error('[ActionSets] Failed to load action-sets.json:', err.message);
    actionSetsData = null;
  }
}

function getActiveSet() {
  if (!actionSetsData || actionSetsData.sets.length === 0) return null;
  return actionSetsData.sets.find(s => s.id === activeSetId) || actionSetsData.sets[0];
}

function getSetById(setId) {
  if (!actionSetsData) return null;
  return actionSetsData.sets.find(s => s.id === setId) || null;
}

/**
 * Build actions list for a given set (for the management API).
 */
function buildActionsList(setId) {
  const set = setId ? getSetById(setId) : getActiveSet();
  if (!set) return [];

  const idleCounts = {};
  for (const name of (set.idlePlaylist || [])) {
    idleCounts[name] = (idleCounts[name] || 0) + 1;
  }

  const actionMap = set.actionMap || {};
  const hookTriggers = {};
  for (const [trigger, gifName] of Object.entries(actionMap)) {
    if (!hookTriggers[gifName]) hookTriggers[gifName] = [];
    hookTriggers[gifName].push(trigger);
  }

  const actions = [];
  for (const [name, gifPath] of Object.entries(set.animations || {})) {
    const gifFile = gifPath.split('/').pop();
    let trigger = 'manual';
    let idleWeight = 0;
    let hookNames = [];
    let special = null;

    if (name in idleCounts) {
      trigger = 'idle';
      idleWeight = idleCounts[name];
    }
    if (name === 'working') special = '工作模式';
    if (name === 'speak') special = '语音';

    const hooks = hookTriggers[name];
    if (hooks) {
      hookNames = hooks;
      if (trigger !== 'idle') trigger = 'hook';
    }

    actions.push({ name, gifFile, gifPath, trigger, idleWeight, hookNames, special });
  }
  return actions;
}

/**
 * Build sets summary (lightweight, for set selector UI).
 */
function buildSetsSummary() {
  if (!actionSetsData) return [];
  return actionSetsData.sets.map(set => ({
    id: set.id,
    name: set.name,
    nameEn: set.nameEn || set.name,
    reference: set.reference,
    chromakey: set.chromakey,
    description: set.description,
    descriptionEn: set.descriptionEn || set.description,
    actionCount: Object.keys(set.animations || {}).length,
    active: set.id === activeSetId,
  }));
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
    // GET /action-sets — list all sets
    if (req.method === 'GET' && req.url === '/action-sets') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sets: buildSetsSummary(), activeSetId }));
      return;
    }

    // GET /action-sets/:id — get one set with its actions
    if (req.method === 'GET' && req.url.startsWith('/action-sets/')) {
      const setId = req.url.split('/action-sets/')[1]?.split('?')[0];
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: set.id,
        name: set.name,
        nameEn: set.nameEn || set.name,
        reference: set.reference,
        chromakey: set.chromakey,
        description: set.description,
        descriptionEn: set.descriptionEn || set.description,
        actions: buildActionsList(setId),
      }));
      return;
    }

    // GET /actions — backward compatible, returns active set's actions
    if (req.method === 'GET' && req.url === '/actions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actions: buildActionsList(), activeSetId }));
      return;
    }

    // GET /actions?set=xxx — actions for a specific set
    if (req.method === 'GET' && req.url.startsWith('/actions?set=')) {
      const setId = new URL(req.url, 'http://localhost').searchParams.get('set');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actions: buildActionsList(setId), setId }));
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
  loadActionSets();
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
