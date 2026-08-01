#!/usr/bin/env node
/**
 * Cloe Desktop — Electron Main Process
 *
 * Responsibilities:
 * 1. Embed WebSocket+HTTP bridge (no external subprocess needed)
 * 2. Create transparent always-on-top window
 * 3. Handle window drag via IPC
 */

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const os = require('os');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const windowRegistry = require('./src/main/window-registry');
const bridge = require('./src/main/bridge');
const reminderEngine = require('./reminder-engine');
const agentTracker = require('./agent-tracker');
const cloeSessions = require('./cloe-sessions');
const ttsScheduler = require('./tts-scheduler');
const taskEngine = require('./task-engine');
const muteState = require('./mute-state');
const weatherEngine = require('./weather-engine');
// ==================== Config ====================
const WS_PORT = 19850;
const HTTP_PORT = 19851;
// Bind to 0.0.0.0 so external clients (Android via Tailscale) can connect
const BRIDGE_HOST = '0.0.0.0';

let win;
let tray = null;
const bridgeClients = bridge.getClients();

// Canvas state + routes now live in src/main/canvas-store.js and canvas-routes.js.

// ==================== User config + data dir (see src/main/config.js) ====================
const {
  expandDataDir,
  loadConfig, saveConfig, getDataDir, getBundledSeedRoot,
  ensureCloeConfigDirAndMigrateConfig, bootstrapPackagedData,
} = require('./src/main/config');

// ==================== Action Sets (see src/main/action-sets.js) ====================
const actionSets = require('./src/main/action-sets');
const {
  loadActionSets, watchActionSets,
  getActiveSet, getSetById, buildActionsList, buildSetsSummary,
  getActionSetsPath, saveActionSets, isSafeFilename, generateSetId,
  broadcastSetConfig,
} = actionSets;

function broadcastToClients(data) {
  bridge.broadcast(data);
}

// ==================== HTTPS / DashScope / GIF Generation (see src/main/gif-generation.js) ====================
const gifGeneration = require('./src/main/gif-generation');
const {
  getGifsDir, getSetGifSubdir, getSetAnimationPath, getTtsAudioDir, getSetGifDir,
  runGifGenerationJob, runReferenceGenerationJob,
} = gifGeneration;


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
  // --- HTTP route modules (dependency-injected via ctx) ---
  const configRoutesHandler = require('./src/main/config-routes')({
    loadConfig, saveConfig, getDataDir,
    loadWindowPosition, saveWindowPosition, clearSavedWindowPosition,
    getWindowScale, setWindowScale, MIN_SCALE, MAX_SCALE,
    getWin: () => win,
  });

  const ttsRoutesHandler = require('./src/main/tts-routes')({
    getTtsAudioDir,
    broadcast: broadcastToClients,
  });

  const excalidrawRoutesHandler = require('./src/main/excalidraw-routes')({
    getWin: () => win,
  });

  const canvasRoutesHandler = require('./src/main/canvas-routes')({
    getWin: () => win,
  });

  const actionSetsRoutesHandler = require('./src/main/action-sets-routes')({
    actionSets,
    getActiveSet, getSetById, buildActionsList, buildSetsSummary,
    saveActionSets, isSafeFilename, generateSetId, broadcastSetConfig,
    getSetGifDir, getSetAnimationPath,
    runGifGenerationJob, runReferenceGenerationJob,
    getGenerationTasks: () => gifGeneration.getGenerationTasks(),
    getDataDir,
    handleActionPost,
  });

  const chatRoutesHandler = require('./src/main/chat-routes')({
    getWin: () => win,
    broadcastToClients,
    toggleChatWindow,
    reminderEngine, agentTracker, ttsScheduler, weatherEngine, taskEngine,
    muteState,
  });

  // --- WebSocket ---
  const wss = new WebSocketServer({ port: WS_PORT, host: BRIDGE_HOST });

  wss.on('connection', (ws) => {
    bridgeClients.add(ws);
    console.log(`[WS] Client connected (${bridgeClients.size})`);

    // Send current active set config so renderer knows all animations
    const set = getActiveSet();
    if (set) {
      try {
        ws.send(JSON.stringify({
          type: 'set-config',
          animations: set.animations || {},
          idlePlaylist: set.idlePlaylist || [],
          actionMap: set.actionMap || {},
        }));
      } catch (_) {}
    }

    ws.on('message', (raw) => {
      try { console.log(`[WS] ${raw.toString()}`); } catch (_) {}
    });
    ws.on('error', (e) => console.error(`[WS] ${e.message}`));
    ws.on('close', () => {
      bridgeClients.delete(ws);
      console.log(`[WS] Client disconnected (${bridgeClients.size})`);
    });
  });

  // --- Reminder Engine ---
  reminderEngine.setBroadcast(broadcastToClients);
  reminderEngine.restoreTimers();

  // --- Agent Session Tracker ---
  agentTracker.setBroadcast(broadcastToClients);

  // --- TTS Scheduler ---
  ttsScheduler.setBroadcast(broadcastToClients);

  // --- Weather Engine ---
  weatherEngine.setBroadcast(broadcastToClients);
  weatherEngine.init();

  // --- Task Engine ---
  taskEngine.setBroadcast(broadcastToClients);
  taskEngine.loadTasks();

  // --- HTTP ---
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
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

    const urlPath = (req.url || '').split('?')[0];

    if (configRoutesHandler(req, res, urlPath)) return;

    if (actionSetsRoutesHandler(req, res, urlPath)) return;
    if (ttsRoutesHandler(req, res, urlPath)) return;

    // ==================== Canvas API ====================


    if (canvasRoutesHandler(req, res, urlPath)) return;

    if (excalidrawRoutesHandler(req, res, urlPath)) return;
    if (chatRoutesHandler(req, res, urlPath)) return;

    // ==================== Native Agent Config (HTTP for manager settings page) ====================
    if (req.method === 'GET' && urlPath === '/native-agent/config') {
      const nativeConfig = require('./native-agent/config');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(nativeConfig.loadConfig()));
      return;
    }
    if (req.method === 'POST' && urlPath === '/native-agent/config') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const cfg = JSON.parse(body);
          const nativeConfig = require('./native-agent/config');
          nativeConfig.saveConfig(cfg);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    // Fetch models from provider API (server-side to avoid CORS)
    if (req.method === 'POST' && urlPath === '/native-agent/fetch-models') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { baseURL, apiKey } = JSON.parse(body);
          if (!baseURL) { res.writeHead(400); res.end(JSON.stringify({ error: 'No baseURL' })); return; }
          const https = require('https');
          const http = require('http');
          const url = baseURL.replace(/\/+$/, '') + '/models';
          const parsed = new URL(url);
          const lib = parsed.protocol === 'https:' ? https : http;
          const headers = {};
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
          const proxyReq = lib.request(
            { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'GET', headers, timeout: 10000 },
            (proxyRes) => {
              let proxyBody = '';
              proxyRes.on('data', c => proxyBody += c);
              proxyRes.on('end', () => {
                try {
                  const data = JSON.parse(proxyBody);
                  const models = (data.data || []).map(m => m.id).filter(Boolean).sort();
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ models, error: null }));
                } catch {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ models: [], error: 'Parse failed' }));
                }
              });
            }
          );
          proxyReq.on('error', e => { res.writeHead(200); res.end(JSON.stringify({ models: [], error: e.message })); });
          proxyReq.on('timeout', () => { proxyReq.destroy(); res.writeHead(200); res.end(JSON.stringify({ models: [], error: 'Timeout' })); });
          proxyReq.end();
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ==================== Web Search Config & Test ====================
    // Get available web search providers metadata
    if (req.method === 'GET' && urlPath === '/native-agent/web-search/providers') {
      const webSearch = require('./native-agent/web-search');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(webSearch.getProviders()));
      return;
    }
    // Test web search
    if (req.method === 'POST' && urlPath === '/native-agent/web-search/test') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { query } = JSON.parse(body);
          // Reload config to pick up latest saved settings
          const nativeConfig = require('./native-agent/config');
          nativeConfig.reloadConfig();
          const webSearch = require('./native-agent/web-search');
          const results = await webSearch.search(query || 'test', { maxResults: 3 });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, results, count: results.length }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
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

// ==================== Saved main window position (see src/main/config.js) ====================
const {
  getWindowPositionFilePath, loadWindowPosition, saveWindowPosition,
  clearSavedWindowPosition, getInitialMainWindowXY,
} = require('./src/main/config');

// ==================== Window ====================
const BASE_WIDTH = 500;  // GIF 400px + 边距
const BASE_HEIGHT = 520;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.0;
const DEFAULT_SCALE = 1.0;

function getWindowScale() {
  const cfg = loadConfig();
  const s = cfg.windowScale;
  if (typeof s === 'number' && s >= MIN_SCALE && s <= MAX_SCALE) return s;
  return DEFAULT_SCALE;
}

function setWindowScale(scale) {
  const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  const cfg = loadConfig();
  cfg.windowScale = s;
  saveConfig(cfg);
  // Resize the actual window
  if (win && !win.isDestroyed()) {
    const ww = Math.round(BASE_WIDTH * s);
    const wh = Math.round(BASE_HEIGHT * s);
    win.setSize(ww, wh, true);
    console.log(`[Window] Resized to ${ww}×${wh} (scale ${s.toFixed(2)})`);
  }
  return s;
}

function createWindow() {
  const scale = getWindowScale();
  const ww = Math.round(BASE_WIDTH * scale);
  const wh = Math.round(BASE_HEIGHT * scale);
  const pos = getInitialMainWindowXY(ww, wh);

  win = new BrowserWindow({
    width: ww,
    height: wh,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    fullscreenable: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
  windowRegistry.setMainWindow(win);
}

ipcMain.on('window-move', (_e, { dx, dy }) => {
  if (win) {
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }
});

// ==================== PTY (see src/main/pty.js — registers pty-* ipc handlers) ====================
require('./src/main/pty');

// ==================== Window Mode ====================
// 'character' = alwaysOnTop small float, 'terminal' = native title bar window
ipcMain.on('set-window-mode', (_e, mode) => {
  if (!win) return;
  if (mode === 'character') {
    const scale = getWindowScale();
    win.setAlwaysOnTop(true);
    win.setSize(Math.round(BASE_WIDTH * scale), Math.round(BASE_HEIGHT * scale), true);
    return;
  }
  // terminal / canvas: if maximized, keep maximized — just change alwaysOnTop
  win.setAlwaysOnTop(false);
  if (!win.isMaximized()) {
    const display = screen.getPrimaryDisplay();
    const { width: dw, height: dh } = display.workAreaSize;
    if (mode === 'terminal') {
      const tw = Math.min(1200, Math.round(dw * 0.75));
      const th = Math.min(800, Math.round(dh * 0.75));
      win.setSize(tw, th, true);
      win.center();
    } else if (mode === 'canvas') {
      const cw = Math.min(1400, Math.round(dw * 0.85));
      const ch = Math.min(900, Math.round(dh * 0.85));
      win.setSize(cw, ch, true);
      win.center();
    }
  }
});

ipcMain.on('toggle-fullscreen', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen()) {
    win.setFullScreen(false);
  } else {
    win.setFullScreen(true);
  }
});

ipcMain.on('minimize-window', () => {
  if (!win || win.isDestroyed()) return;
  win.minimize();
});

// ==================== Terminal Shortcut ====================

// Terminal shortcut is handled entirely in renderer.js (document-level keydown).
// IPC kept for config persistence only.
ipcMain.on('set-terminal-shortcut', (_e, accelerator) => {
  // Persist to config so it survives restarts
  const cfg = loadConfig();
  cfg.terminalShortcut = accelerator || '';
  saveConfig(cfg);
});

ipcMain.on('get-data-dir', (event) => {
  if (!app.isPackaged) {
    event.returnValue = '';
    return;
  }
  try {
    const dir = getDataDir();
    let href = pathToFileURL(dir).href;
    if (!href.endsWith('/')) href += '/';
    event.returnValue = href;
  } catch (err) {
    console.error('[IPC] get-data-dir:', err);
    event.returnValue = '';
  }
});

ipcMain.handle('get-window-position', () => {
  if (!win) return null;
  const [x, y] = win.getPosition();
  return { x, y };
});

ipcMain.handle('save-window-position', (_event, payload) => {
  const x = payload?.x;
  const y = payload?.y;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false };
  }
  saveWindowPosition(x, y);
  return { ok: true };
});

// ==================== Character Position (Shift+drag offset) ====================
ipcMain.on('get-character-position', (event) => {
  const cfg = loadConfig();
  event.returnValue = cfg.characterPosition || { x: 0.5, y: 1.0 };
});

ipcMain.on('save-character-position', (_e, pos) => {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
  const cfg = loadConfig();
  cfg.characterPosition = { x: pos.x, y: pos.y };
  saveConfig(cfg);
  console.log(`[Config] Saved characterPosition: ${JSON.stringify(cfg.characterPosition)}`);
  // Broadcast to main window so it updates in real-time
  try { win?.webContents?.send('character-position-updated', cfg.characterPosition); } catch {}
});

// ── Character Size (scale factor for GIF layers) ──
ipcMain.on('get-character-size', (event) => {
  const cfg = loadConfig();
  event.returnValue = cfg.characterSize || { scale: 1.0 };
});

ipcMain.on('save-character-size', (_e, size) => {
  if (!size || typeof size.scale !== 'number') return;
  const cfg = loadConfig();
  cfg.characterSize = { scale: Math.max(0.2, Math.min(3.0, size.scale)) };
  saveConfig(cfg);
  console.log(`[Config] Saved characterSize: ${JSON.stringify(cfg.characterSize)}`);
  // Broadcast to main window so it updates in real-time
  try { win?.webContents?.send('character-size-updated', cfg.characterSize); } catch {}
});



// ==================== Windows (see src/main/windows.js — registers manager/chat/workspace/avatar/pin ipc) ====================
const { createManagerWindow, toggleChatWindow } = require('./src/main/windows');


// ==================== Hermes API Proxy (see src/main/hermes-proxy.js — registers hermes-* ipc handlers) ====================
require('./src/main/hermes-proxy');

// ==================== Native Agent Proxy (alternative to Hermes, embeds agent in Electron) ====================
const nativeProxy = require('./src/main/native-proxy');

// ==================== Canvas Window ====================
// ==================== System Tray / App Menu / PATH (see src/main/lifecycle.js) ====================
const { createTray, createAppMenu, fixPath } = require('./src/main/lifecycle');


app.whenReady().then(async () => {
  // Explicitly set regular activation policy so the app always appears in
  // cmd+tab / Dock, even when transparent frameless windows have focus.
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
  }
  await fixPath();
  ensureCloeConfigDirAndMigrateConfig();
  if (app.isPackaged) {
    bootstrapPackagedData();
  }
  loadActionSets();
  watchActionSets();
  await startBridge();
  await waitForBridge();
  
  // Initialize native agent (soul watch + cron scheduler)
  try { nativeProxy.init(); } catch (e) { console.error('[NativeAgent] Init failed:', e.message); }
  
  createWindow();
  tray = createTray();
  createAppMenu();

  win.on('enter-full-screen', () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('fullscreen-changed', true);
  });
  win.on('leave-full-screen', () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('fullscreen-changed', false);
  });
});

// On macOS, an app whose key window is at floating level (alwaysOnTop)
// gets treated as an "accessory" app and disappears from cmd+tab.
// When the app is reactivated (dock click, etc.), bring main window forward.
app.on('activate', () => {
  if (process.platform === 'darwin') {
    app.dock?.show();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  }
});

// Ensure chat window creation doesn't cause the app to vanish from cmd+tab.
// Explicitly show dock icon whenever any new window is created.
app.on('browser-window-created', () => {
  if (process.platform === 'darwin') {
    app.dock?.show();
  }
});

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed if tray is active
  // The tray menu has an explicit quit option
  if (!tray) {
    app.quit();
  }
});
