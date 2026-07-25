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
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
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
let managerWin = null;
let tray = null;
const bridgeClients = bridge.getClients();

// ==================== Canvas Elements (in-memory store) ====================
const canvasElements = [];

/** Current canvas mode (null = free/default mode) */
let currentCanvasMode = null;

/** Canvas mode broadcast (sends to main renderer window) */
function broadcastCanvasUpdate() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('canvas-update', [...canvasElements]);
  }
}

/** Broadcast mode change to main renderer window */
function broadcastCanvasModeChange(mode) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('canvas-mode-change', { mode });
  }
}

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

// ==================== HTTPS / DashScope / GIF Generation ====================

const PYTHON_BIN = '/usr/local/bin/python3';
const GIF_GEN_TIMEOUT_MS = 10 * 60 * 1000;
const IMAGE_TASK_POLL_INTERVAL_MS = 5000;

/**
 * Resolve real filesystem path for Python scripts.
 * In packaged mode, scripts are in extraResources (outside asar).
 * In dev mode, scripts are in the project directory.
 */
function getScriptsDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'scripts');
  }
  return path.join(__dirname, 'scripts');
}

function getGifsDir() {
  const dir = path.join(getDataDir(), 'gifs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get the GIF subdirectory path for a specific set.
 * Default set → flat gifs/ (backward compatible)
 * Other sets → gifs/{setId}/
 */
function getSetGifSubdir(setId) {
  if (setId === 'default') return '';
  return setId;
}

/**
 * Get the relative animation path for an action in a specific set.
 * Default set → gifs/{name}.gif
 * Other sets → gifs/{setId}/{name}.gif
 */
function getSetAnimationPath(setId, actionName) {
  const subdir = getSetGifSubdir(setId);
  if (subdir) {
    return `gifs/${subdir}/${actionName}.gif`;
  }
  return `gifs/${actionName}.gif`;
}

/**
 * Get the TTS audio cache directory.
 * Always uses ~/.cloe/audio_cache (or CLOE_DATA_DIR/audio_cache),
 * regardless of dev/packaged mode — this is shared with Hermes TTS pipeline.
 * Creates the directory if it doesn't exist.
 */
function getTtsAudioDir() {
  const root = expandDataDir(loadConfig().dataDir);
  const dir = path.join(root, 'audio_cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get the absolute GIF output directory for a specific set.
 * Creates the directory if it doesn't exist.
 */
function getSetGifDir(setId) {
  const subdir = getSetGifSubdir(setId);
  if (subdir) {
    const dir = path.join(getGifsDir(), subdir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  return getGifsDir();
}

/**
 * Resolve reference image for Python: prefer dataDir (real FS), then bundled seed.
 */
function resolveReferenceForPython(set) {
  const p = resolveReferenceAbsolutePath(set);
  if (!p) return null;
  if (p.includes('.asar')) {
    console.warn('[Python] Reference path unexpectedly inside asar:', p);
    return null;
  }
  return p;
}

/** taskId → { status, progress, startedAt, kind, actionName?, setId?, chromakey?, error? } */
const generationTasks = new Map();

function resolveReferenceAbsolutePath(set) {
  const chromakey = set.chromakey || 'green';
  const bundled = getBundledSeedRoot();
  if (set.reference) {
    for (const root of [getDataDir(), bundled]) {
      const candidate = path.join(root, set.reference);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  const fallbacks =
    chromakey === 'blue'
      ? [
        path.join(getDataDir(), 'gifs', '_work_idle', '01_blue_bg_sitting.png'),
        path.join(bundled, 'gifs', '_work_idle', '01_blue_bg_sitting.png'),
        path.join(__dirname, 'reference_upperbody_bluebg.png'),
      ]
      : [
        path.join(getDataDir(), 'gifs', '_work_idle', '01_green_bg_sitting.png'),
        path.join(bundled, 'gifs', '_work_idle', '01_green_bg_sitting.png'),
      ];
  for (const fp of fallbacks) {
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

function resolveBailianApiKey() {
  const cfg = loadConfig();
  const fromCfg = cfg.dashscopeApiKey != null ? String(cfg.dashscopeApiKey).trim() : '';
  return fromCfg || '';
}

function requestUrlBuffer(urlStr, { method = 'GET', headers = {}, body = null, followRedirects = false } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const useTls = u.protocol === 'https:';
      const lib = useTls ? https : http;
      const payload = body != null ? (Buffer.isBuffer(body) ? body : Buffer.from(String(body))) : null;
      const hdrs = { ...headers };
      if (payload && !hdrs['Content-Length'] && method !== 'GET') {
        hdrs['Content-Length'] = String(payload.length);
      }
      const opts = {
        hostname: u.hostname,
        port: u.port || (useTls ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: hdrs,
      };
      const req = lib.request(opts, (res) => {
        if (followRedirects && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let nextUrl = res.headers.location;
          if (nextUrl.startsWith('/')) {
            nextUrl = `${u.protocol}//${u.host}${nextUrl}`;
          }
          res.resume();
          requestUrlBuffer(nextUrl, { method: 'GET', headers: { ...headers }, followRedirects: true })
            .then(resolve)
            .catch(reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function httpsPost(url, bodyBuf, headers = {}) {
  const useTls = new URL(url).protocol === 'https:';
  if (!useTls) {
    throw new Error('httpsPost expects https URL');
  }
  const hdrs = {
    ...headers,
  };
  if (!hdrs['Content-Type']) hdrs['Content-Type'] = 'application/json';
  return requestUrlBuffer(url, { method: 'POST', headers: hdrs, body: bodyBuf }).then(({ statusCode, body }) => {
    if (statusCode >= 400) {
      const t = body.toString('utf-8');
      throw new Error(`HTTP ${statusCode}: ${t.slice(0, 400)}`);
    }
    return body;
  });
}

function httpsGet(url, headers = {}) {
  return requestUrlBuffer(url, {
    method: 'GET',
    headers: { ...headers },
    followRedirects: true,
  }).then(({ statusCode, body }) => {
    if (statusCode >= 400) {
      const t = body.toString('utf-8');
      throw new Error(`HTTP ${statusCode}: ${t.slice(0, 400)}`);
    }
    return body;
  });
}

/** Default prompts for Wanx reference (green / blue screen). */

function dashScopeJson(postBody, headersExtra = {}) {
  const key = resolveBailianApiKey();
  if (!key) {
    throw new Error('DashScope API key missing: set dashscopeApiKey in config.json or BAILIAN_API_KEY in ~/.hermes/.env');
  }
  const url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
  const body = Buffer.from(JSON.stringify(postBody));
  const headers = {
    Authorization: `Bearer ${key}`,
    'X-DashScope-Async': 'enable',
    ...headersExtra,
  };
  return httpsPost(url, body, headers).then((buf) => {
    const txt = buf.toString('utf-8');
    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      throw new Error(`DashScope POST parse error: ${txt.slice(0, 200)}`);
    }
    if (data.code) {
      throw new Error(data.message || data.code || JSON.stringify(data));
    }
    return data;
  });
}

function dashScopeTaskGet(taskId) {
  const key = resolveBailianApiKey();
  const url = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
  return httpsGet(url, { Authorization: `Bearer ${key}` }).then((buf) => JSON.parse(buf.toString('utf-8')));
}

function mergeGenerateActionIntoSet(set, name, trigger) {
  if (!set.animations) set.animations = {};
  set.animations[name] = getSetAnimationPath(set.id, name);
  if (!set.actionMap) set.actionMap = {};
  set.actionMap[name] = name;
  if (trigger === 'idle') {
    if (!set.idlePlaylist) set.idlePlaylist = [];
    set.idlePlaylist.push(name);
  }
}

function runGifGenerationJob(taskId, setId, set, name, prompt, durationSec, chromakey, trigger) {
  const gifDir = getSetGifDir(setId);
  const outputGifAbs = path.join(gifDir, `${name}.gif`);
  const workDir = path.join(gifDir, `_work_${name}`);

  (async () => {
    broadcastToClients({ type: 'generation-progress', taskId, status: 'starting', progress: 5 });
    const rec = generationTasks.get(taskId);
    if (rec) {
      rec.status = 'starting';
      rec.progress = 5;
    }

    const apiKey = resolveBailianApiKey();
    if (!apiKey) {
      const err = 'DashScope API key not configured. Please go to Settings → API Configuration and enter your key.';
      if (rec) {
        rec.status = 'failed';
        rec.error = err;
      }
      broadcastToClients({ type: 'generation-error', taskId, error: err });
      return;
    }

    const referencePath = resolveReferenceForPython(set);
    if (!referencePath) {
      const err = 'No reference image: add a reference to the set or add public/gifs/_work_idle fallback image.';
      if (rec) {
        rec.status = 'failed';
        rec.error = err;
      }
      broadcastToClients({ type: 'generation-error', taskId, error: err });
      return;
    }

    const pyScript = path.join(getScriptsDir(), 'generate_gif_v2.py');
    const args = [
      pyScript,
      '--action', name,
      '--prompt', prompt,
      '--reference', referencePath,
      '--chromakey', chromakey,
      '--duration', String(durationSec),
      '--output', outputGifAbs,
      '--work-dir', workDir,
      '--no-copy',
    ];

    const env = { ...process.env, BAILIAN_API_KEY: apiKey };
    /** @type {import('child_process').ChildProcess | null} */
    let proc = null;
    let killedTimeout = false;
    const killTimer = setTimeout(() => {
      killedTimeout = true;
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGTERM');
        } catch (_) {}
        setTimeout(() => {
          if (proc && !proc.killed) try {
            proc.kill('SIGKILL');
          } catch (_) {}
        }, 5000);
      }
      const r = generationTasks.get(taskId);
      if (r) {
        r.status = 'failed';
        r.error = 'GIF generation timed out (10 min)';
      }
      broadcastToClients({ type: 'generation-error', taskId, error: 'GIF generation timed out (10 minutes)' });
    }, GIF_GEN_TIMEOUT_MS);

    // Use a real writable directory as cwd (Python can't chdir into asar)
    const spawnCwd = getGifsDir();
    proc = spawn(PYTHON_BIN, args, { cwd: spawnCwd, env });

    let stderrAcc = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const matches = [...text.matchAll(/\[(\d)\/(\d+)\]/g)];
      const r = generationTasks.get(taskId);
      if (!matches.length || !r) return;
      const last = matches[matches.length - 1];
      const cur = +last[1];
      const tot = +last[2] || 3;
      const progress = Math.min(95, 5 + Math.floor((cur / tot) * 90));
      if (progress > (r.progress || 0)) {
        r.progress = progress;
        r.status = 'running';
        broadcastToClients({
          type: 'generation-progress', taskId, status: 'running', progress,
        });
      }
    });

    proc.stderr.on('data', (c) => { stderrAcc += c.toString(); });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      const msg = err.message || String(err);
      const r = generationTasks.get(taskId);
      if (r) {
        r.status = 'failed';
        r.error = msg;
      }
      broadcastToClients({ type: 'generation-error', taskId, error: msg });
    });

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      const r = generationTasks.get(taskId);
      if (killedTimeout) return;

      if (code === 0 && fs.existsSync(outputGifAbs)) {
        const setNow = getSetById(setId);
        if (!setNow) {
          broadcastToClients({ type: 'generation-error', taskId, error: 'Set was removed during generation' });
          return;
        }

        console.log(`[GIF Gen] Output at: ${outputGifAbs}`);

        mergeGenerateActionIntoSet(setNow, name, trigger);
        saveActionSets();

        if (r) {
          r.status = 'succeeded';
          r.progress = 100;
          r.completedAt = Date.now();
        }
        broadcastToClients({
          type: 'generation-complete', taskId, actionName: name, setId,
        });
        if (setId === actionSets.getActiveSetId()) {
          broadcastSetConfig(setId);
        }
      } else {
        const detail = stderrAcc.trim() || `exit code ${code}`;
        if (r) {
          r.status = 'failed';
          r.error = detail;
        }
        broadcastToClients({ type: 'generation-error', taskId, error: detail });
      }
    });
  })();
}

function runReferenceGenerationJob(taskId, chromakey, promptText, imageBase64) {
  (async () => {
    broadcastToClients({ type: 'generation-progress', taskId, status: 'starting', progress: 5 });
    const rec = generationTasks.get(taskId);
    if (rec) {
      rec.status = 'starting';
      rec.progress = 5;
    }

    try {
      const apiKey = resolveBailianApiKey();
      if (!apiKey) throw new Error('DashScope API key missing');

      if (!imageBase64) throw new Error('No reference image provided');

      const bgColor = chromakey === 'blue' ? '#0000FF纯蓝色' : '#00FF00纯绿色';
      const prompt = promptText ||
        `参考这张照片，完全保持人物的长相、五官、发型、肤色、衣服、表情、姿势和构图不变，只把背景替换为${bgColor}的纯色背景，方便后续抠图。不要改变人物的任何细节，不要改变衣服的颜色。`;

      if (rec) {
        rec.status = 'running';
        rec.progress = 20;
        broadcastToClients({ type: 'generation-progress', taskId, status: 'running', progress: 20 });
      }

      // Use wan2.7-image-pro (same model as cloe-moment) for best character consistency
      const body = JSON.stringify({
        model: 'wan2.7-image-pro',
        input: {
          messages: [
            {
              role: 'user',
              content: [
                { image: `data:image/png;base64,${imageBase64}` },
                { text: prompt },
              ],
            },
          ],
        },
        parameters: { n: 1, watermark: false, thinking_mode: true },
      });

      const respBuf = await httpsPost(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        body,
        { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      );
      const resp = JSON.parse(respBuf.toString('utf-8'));

      // Extract image URL from wan2.7-image-pro response
      const content = resp?.output?.choices?.[0]?.message?.content;
      let imageUrl = null;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item && item.image) { imageUrl = item.image; break; }
        }
      }
      if (!imageUrl) {
        throw new Error(`No image in response: ${JSON.stringify(resp).slice(0, 500)}`);
      }

      if (rec) {
        rec.progress = 80;
        broadcastToClients({ type: 'generation-progress', taskId, status: 'running', progress: 80 });
      }

      const imgBuf = await httpsGet(imageUrl);
      const b64 = Buffer.from(imgBuf).toString('base64');

      if (rec) {
        rec.status = 'succeeded';
        rec.progress = 100;
        rec.completedAt = Date.now();
      }
      broadcastToClients({
        type: 'reference-generated', taskId, imageBase64: b64, chromakey,
      });
    } catch (e) {
      const msg = e?.message || String(e);
      if (rec) {
        rec.status = 'failed';
        rec.error = msg;
      }
      broadcastToClients({ type: 'generation-error', taskId, error: msg });
    }
  })();
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

    if (req.method === 'GET' && urlPath === '/api-config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(loadConfig()));
      return;
    }

    if (req.method === 'POST' && urlPath === '/api-config') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const patch = JSON.parse(body || '{}');
          if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'body must be a JSON object' }));
            return;
          }
          const merged = { ...loadConfig(), ...patch };
          saveConfig(merged);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(merged));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && urlPath === '/window-position') {
      const saved = loadWindowPosition();
      let current = null;
      if (win) {
        const [cx, cy] = win.getPosition();
        current = { x: cx, y: cy };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ saved, current }));
      return;
    }

    // GET /window-scale — get current window scale
    if (req.method === 'GET' && urlPath === '/window-scale') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ scale: getWindowScale(), min: MIN_SCALE, max: MAX_SCALE }));
      return;
    }

    // POST /window-scale — set window scale (0.3 ~ 2.0)
    if (req.method === 'POST' && urlPath === '/window-scale') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const s = parseFloat(payload.scale);
          if (isNaN(s) || !Number.isFinite(s)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'expected { scale: number }' }));
            return;
          }
          const actual = setWindowScale(s);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, scale: actual }));
        } catch (_) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/window-position') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          if (payload && payload.clear === true) {
            clearSavedWindowPosition();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          const x = payload.x;
          const y = payload.y;
          if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'expected { x, y } numbers' }));
            return;
          }
          saveWindowPosition(x, y);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (_) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // ── Character Layout (position + size within the window) ──

    // GET /character-layout — get character position & size
    if (req.method === 'GET' && urlPath === '/character-layout') {
      const cfg = loadConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        position: cfg.characterPosition || { x: 0.5, y: 1.0 },
        size: cfg.characterSize || { scale: 1.0 },
      }));
      return;
    }

    // POST /character-layout — set character position and/or size
    if (req.method === 'POST' && urlPath === '/character-layout') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const cfg = loadConfig();
          if (payload.position && typeof payload.position.x === 'number' && typeof payload.position.y === 'number') {
            cfg.characterPosition = { x: payload.position.x, y: payload.position.y };
          }
          if (payload.size && typeof payload.size.scale === 'number') {
            cfg.characterSize = { scale: Math.max(0.2, Math.min(3.0, payload.size.scale)) };
          }
          saveConfig(cfg);
          console.log(`[Config] Saved characterLayout: pos=${JSON.stringify(cfg.characterPosition)} size=${JSON.stringify(cfg.characterSize)}`);
          // Broadcast to main window for real-time update
          try { win?.webContents?.send('character-position-updated', cfg.characterPosition); } catch {}
          try { win?.webContents?.send('character-size-updated', cfg.characterSize); } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (_) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // GET /plugin-rules — read plugin-rules.json from dataDir
    if (req.method === 'GET' && urlPath === '/plugin-rules') {
      try {
        const rulesPath = path.join(getDataDir(), 'plugin-rules.json');
        const raw = fs.readFileSync(rulesPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(raw);
      } catch (_) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      }
      return;
    }

    // POST /plugin-rules — write plugin-rules.json to dataDir
    if (req.method === 'POST' && urlPath === '/plugin-rules') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const rules = JSON.parse(body || '{}');
          const rulesPath = path.join(getDataDir(), 'plugin-rules.json');
          fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2), 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON: ' + e.message }));
        }
      });
      return;
    }

    // POST /context-usage — receive context usage from Hermes plugin, broadcast to WS clients
    if (req.method === 'POST' && urlPath === '/context-usage') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          // Broadcast to all WS clients (renderer will handle the display)
          const usageData = {
            type: 'context-usage',
            usage_pct: data.usage_pct || 0,
            prompt_tokens: data.prompt_tokens || 0,
            context_limit: data.context_limit || 0,
            session_id: data.session_id || '',
          };
          broadcastToClients(usageData);
          // Also forward to ALL chat windows via IPC
          const allChatWins = BrowserWindow.getAllWindows().filter(w =>
            !w.isDestroyed() && w.webContents?.getURL()?.includes('/chat.html')
          );
          for (const cw of allChatWins) {
            try { cw.webContents.send('context-usage', usageData); } catch {}
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // --- Management API ---
    // GET /action-sets — list all sets
    if (req.method === 'GET' && req.url === '/action-sets') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sets: buildSetsSummary(), activeSetId: actionSets.getActiveSetId() }));
      return;
    }

    // GET /action-sets/:id/actions/:name/gif — serve GIF binary for Android full-sync
    if (req.method === 'GET' && urlPath.match(/^\/action-sets\/[^/]+\/actions\/[^/]+\/gif$/)) {
      const parts = urlPath.split('/');
      const setId = decodeURIComponent(parts[2]);
      const actionName = decodeURIComponent(parts[4]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return;
      }
      const rel = set.animations?.[actionName];
      if (!rel) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'action not found' }));
        return;
      }
      const absPath = path.join(getDataDir(), rel);
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'gif file not found' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': fs.statSync(absPath).size,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(absPath).pipe(res);
      return;
    }

    // GET /action-sets/:id — get one set with its actions
    if (req.method === 'GET' && urlPath.match(/^\/action-sets\/[^/]+$/)) {
      const setId = decodeURIComponent(urlPath.split('/action-sets/')[1]);
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
      res.end(JSON.stringify({ actions: buildActionsList(), activeSetId: actionSets.getActiveSetId() }));
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

    // GET /generation-tasks — in-memory GIF / reference generation state
    if (req.method === 'GET' && urlPath === '/generation-tasks') {
      const tasks = [...generationTasks.entries()].map(([taskId, t]) => ({
        taskId,
        status: t.status,
        progress: t.progress ?? 0,
        startedAt: t.startedAt,
        completedAt: t.completedAt ?? null,
        kind: t.kind ?? 'gif',
        actionName: t.actionName ?? undefined,
        setId: t.setId ?? undefined,
        chromakey: t.chromakey ?? undefined,
        error: t.error ?? undefined,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tasks }));
      return;
    }

    if (req.method === 'GET' && urlPath.startsWith('/generation-tasks/')) {
      const taskId = decodeURIComponent(urlPath.slice('/generation-tasks/'.length));
      const t = generationTasks.get(taskId);
      if (!t) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'task not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        taskId,
        status: t.status,
        progress: t.progress ?? 0,
        startedAt: t.startedAt,
        completedAt: t.completedAt ?? null,
        kind: t.kind ?? 'gif',
        actionName: t.actionName,
        setId: t.setId,
        chromakey: t.chromakey,
        error: t.error,
      }));
      return;
    }

    // --- Action Sets CRUD API ---

    // POST /action-sets/generate-reference — async Wanx chroma reference → WS reference-generated
    if (req.method === 'POST' && urlPath === '/action-sets/generate-reference') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const chromakey = data.chromakey === 'blue' ? 'blue' : 'green';
          const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
          const taskId = crypto.randomUUID();
          generationTasks.set(taskId, {
            status: 'pending',
            progress: 0,
            startedAt: Date.now(),
            kind: 'reference',
            chromakey,
          });
          runReferenceGenerationJob(taskId, chromakey, prompt || null, data.imageBase64 || null);
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ taskId, status: 'pending' }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /action-sets/:id/generate-action — async Python GIF pipeline
    const genGifMatch =
      req.method === 'POST' && urlPath.match(/^\/action-sets\/([^/]+)\/generate-action$/);
    if (genGifMatch) {
      const setId = decodeURIComponent(genGifMatch[1]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const name = typeof data.name === 'string' ? data.name.trim() : '';
          const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
          let duration =
            typeof data.duration === 'number' && Number.isFinite(data.duration)
              ? Math.round(data.duration)
              : 5;
          if (duration !== 3 && duration !== 5) duration = 5;

          let chromakey = data.chromakey;
          chromakey = chromakey === 'blue' || chromakey === 'green'
            ? chromakey
            : (set.chromakey === 'blue' ? 'blue' : 'green');

          const trigger = data.trigger === 'idle' ? 'idle' : 'manual';

          if (!name || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name must match [a-z][a-z0-9_]{0,63}' }));
            return;
          }
          if (!prompt) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'prompt is required' }));
            return;
          }
          if (!set.animations) set.animations = {};
          if (set.animations[name]) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'action already exists' }));
            return;
          }

          const taskId = crypto.randomUUID();
          generationTasks.set(taskId, {
            status: 'pending',
            progress: 0,
            startedAt: Date.now(),
            kind: 'gif',
            actionName: name,
            setId,
            chromakey,
          });

          runGifGenerationJob(taskId, setId, set, name, prompt, duration, chromakey, trigger);

          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ taskId, status: 'pending' }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // POST /action-sets — create new action set
    if (req.method === 'POST' && req.url === '/action-sets') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.name) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name is required' }));
            return;
          }
          if (!isSafeFilename(data.name)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name contains invalid characters (only alphanumeric, underscore, hyphen, Chinese allowed)' }));
            return;
          }
          const id = generateSetId(data.name);
          // Save reference image if provided
          if (data.referenceBase64) {
            const refDir = path.join(getDataDir(), 'references');
            if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
            fs.writeFileSync(path.join(refDir, `${id}.png`), Buffer.from(data.referenceBase64, 'base64'));
          }
          const newSet = {
            id,
            name: data.name,
            nameEn: data.nameEn || '',
            description: data.description || '',
            descriptionEn: data.descriptionEn || '',
            reference: data.referenceBase64 ? `references/${id}.png` : '',
            chromakey: data.chromakey || 'green',
            animations: {},
            idlePlaylist: [],
            actionMap: {},
          };
          actionSets.getActionSetsData().sets.push(newSet);
          saveActionSets();
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(newSet));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // DELETE /action-sets/:id — delete action set (must not match /action-sets/:id/actions/...)
    if (req.method === 'DELETE' && req.url.startsWith('/action-sets/') && !req.url.includes('/actions/')) {
      const setId = decodeURIComponent(req.url.split('/action-sets/')[1]?.split('?')[0]);
      if (setId === actionSets.getActiveSetId()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'cannot delete the active set' }));
        return;
      }
      if (actionSets.getActionSetsData().sets.length <= 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'cannot delete the last set' }));
        return;
      }
      const idx = actionSets.getActionSetsData().sets.findIndex(s => s.id === setId);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return;
      }
      actionSets.getActionSetsData().sets.splice(idx, 1);
      saveActionSets();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sets: buildSetsSummary(), activeSetId: actionSets.getActiveSetId() }));
      return;
    }

    // POST /action-sets/:id/activate — activate action set
    if (req.method === 'POST' && req.url.match(/^\/action-sets\/[^/]+\/activate$/)) {
      const setId = decodeURIComponent(req.url.split('/')[2]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return;
      }
      actionSets.setActiveSetId(setId);
      saveActionSets();
      broadcastSetConfig(setId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, activeSetId: setId }));
      return;
    }

    // POST /action-sets/:id/actions — add action to set
    if (req.method === 'POST' && req.url.match(/^\/action-sets\/[^/]+\/actions$/)) {
      const setId = decodeURIComponent(req.url.split('/')[2]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.name || !data.gifBase64) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name and gifBase64 are required' }));
            return;
          }
          if (!isSafeFilename(data.name)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name contains invalid characters (only alphanumeric, underscore, hyphen, Chinese allowed)' }));
            return;
          }
          // Save GIF file (namespace per set to avoid overwriting other sets)
          const gifsDir = getSetGifDir(setId);
          if (!fs.existsSync(gifsDir)) fs.mkdirSync(gifsDir, { recursive: true });
          fs.writeFileSync(path.join(gifsDir, `${data.name}.gif`), Buffer.from(data.gifBase64, 'base64'));

          // Update set data
          if (!set.animations) set.animations = {};
          set.animations[data.name] = getSetAnimationPath(setId, data.name);

          if (!set.actionMap) set.actionMap = {};
          set.actionMap[data.name] = data.name;

          if (data.trigger === 'idle') {
            if (!set.idlePlaylist) set.idlePlaylist = [];
            const weight = Math.max(1, Math.min(10, parseInt(data.idleWeight, 10) || 1));
            for (let i = 0; i < weight; i++) set.idlePlaylist.push(data.name);
          }

          saveActionSets();

          // Broadcast if this is the active set
          if (setId === actionSets.getActiveSetId()) {
            broadcastSetConfig(setId);
          }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ actions: buildActionsList(setId) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // DELETE /action-sets/:id/actions/:name — delete action from set
    if (req.method === 'DELETE' && req.url.match(/^\/action-sets\/[^/]+\/actions\/[^/]+$/)) {
      const parts = req.url.split('/');
      const setId = decodeURIComponent(parts[2]);
      const actionName = decodeURIComponent(parts[4]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return;
      }

      // Remove from animations
      if (set.animations) delete set.animations[actionName];

      // Remove from idlePlaylist
      if (set.idlePlaylist) {
        set.idlePlaylist = set.idlePlaylist.filter(n => n !== actionName);
      }

      // Remove from actionMap where value matches
      if (set.actionMap) {
        for (const [trigger, gifName] of Object.entries(set.actionMap)) {
          if (gifName === actionName) delete set.actionMap[trigger];
        }
      }

      saveActionSets();

      // Broadcast if this is the active set
      if (setId === actionSets.getActiveSetId()) {
        broadcastSetConfig(setId);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actions: buildActionsList(setId) }));
      return;
    }

    // PATCH /action-sets/:id/idle-playlist — update idle config for an action
    // Body: { name: string, enabled: boolean, weight?: number (1-10) }
    if (req.method === 'PATCH' && req.url.match(/^\/action-sets\/[^/]+\/idle-playlist$/)) {
      const setId = decodeURIComponent(req.url.split('/')[2]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.name || typeof data.enabled !== 'boolean') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name and enabled (boolean) are required' }));
            return;
          }
          // Verify action exists in this set
          if (!set.animations || !(data.name in set.animations)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `action "${data.name}" not found in set` }));
            return;
          }

          const weight = Math.max(1, Math.min(10, parseInt(data.weight, 10) || 1));
          if (!set.idlePlaylist) set.idlePlaylist = [];

          // Remove all existing entries of this action
          set.idlePlaylist = set.idlePlaylist.filter(n => n !== data.name);

          // If enabling, add back with the specified weight
          if (data.enabled) {
            for (let i = 0; i < weight; i++) set.idlePlaylist.push(data.name);
          }

          saveActionSets();
          if (setId === actionSets.getActiveSetId()) broadcastSetConfig(setId);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ actions: buildActionsList(setId) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /tts/:filename — serve audio files from audio_cache directory
    // Used by Hermes TTS pipeline: generate mp3 → save to ~/.cloe/audio_cache/ →
    // trigger speak with audio_url=http://localhost:19851/tts/filename.mp3
    // Supports Range requests (206 Partial Content) — Chromium requires this
    // for MP3 streaming; without it, playback truncates at ~10s.
    if (req.method === 'GET' && req.url.startsWith('/tts-fallback/')) {
      const filename = decodeURIComponent(req.url.slice(14));
      if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\\0')) {
        res.writeHead(400); res.end('Invalid filename'); return;
      }
      const fbDir = path.join(__dirname, 'audio', 'fallback');
      const filePath = path.join(fbDir, filename);
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const stat = fs.statSync(filePath);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/tts/')) {
      const filename = decodeURIComponent(req.url.slice(5));
      if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
        res.writeHead(400);
        res.end('Invalid filename');
        return;
      }
      const ttsDir = getTtsAudioDir();
      const filePath = path.join(ttsDir, filename);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.opus': 'audio/opus', '.ogg': 'audio/ogg' };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // Parse Range header
      const rangeHeader = req.headers['range'];
      if (rangeHeader) {
        const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          if (start >= fileSize || end >= fileSize || start > end) {
            res.writeHead(416, {
              'Content-Range': `bytes */${fileSize}`,
            });
            res.end();
            return;
          }
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Length': chunkSize,
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Cache-Control': 'no-cache',
            'Accept-Ranges': 'bytes',
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
          return;
        }
      }

      // Full response with Accept-Ranges so the client knows Range is supported
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileSize,
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // ==================== Canvas API ====================

    // Helper: read JSON body from request
    function readJsonBody(req, callback) {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          callback(null, JSON.parse(body || '{}'));
        } catch (e) {
          callback(e, null);
        }
      });
    }

    // Helper: send JSON response
    function jsonRes(res, status, data) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }

    // GET /canvas/elements — return all elements
    if (req.method === 'GET' && urlPath === '/canvas/elements') {
      jsonRes(res, 200, { elements: canvasElements });
      return;
    }

    // POST /canvas/elements — add an element
    if (req.method === 'POST' && urlPath === '/canvas/elements') {
      readJsonBody(req, (err, data) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        if (!data.id || !data.type) {
          jsonRes(res, 400, { error: 'element must have id and type' });
          return;
        }
        canvasElements.push(data);
        broadcastCanvasUpdate();
        jsonRes(res, 201, { ok: true, element: data, total: canvasElements.length });
      });
      return;
    }

    // PUT /canvas/elements/:id — update an element
    const putCanvasMatch = req.method === 'PUT' && urlPath.match(/^\/canvas\/elements\/([^/]+)$/);
    if (putCanvasMatch) {
      const id = decodeURIComponent(putCanvasMatch[1]);
      readJsonBody(req, (err, data) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const idx = canvasElements.findIndex(el => el.id === id);
        if (idx === -1) { jsonRes(res, 404, { error: 'element not found' }); return; }
        canvasElements[idx] = { ...canvasElements[idx], ...data, id }; // keep original id
        broadcastCanvasUpdate();
        jsonRes(res, 200, { ok: true, element: canvasElements[idx] });
      });
      return;
    }

    // DELETE /canvas/elements/:id — delete an element
    const delCanvasElMatch = req.method === 'DELETE' && urlPath.match(/^\/canvas\/elements\/([^/]+)$/);
    if (delCanvasElMatch) {
      const id = decodeURIComponent(delCanvasElMatch[1]);
      const idx = canvasElements.findIndex(el => el.id === id);
      if (idx === -1) { jsonRes(res, 404, { error: 'element not found' }); return; }
      canvasElements.splice(idx, 1);
      broadcastCanvasUpdate();
      jsonRes(res, 200, { ok: true, total: canvasElements.length });
      return;
    }

    // DELETE /canvas — clear all elements
    if (req.method === 'DELETE' && urlPath === '/canvas') {
      canvasElements.length = 0;
      broadcastCanvasUpdate();
      jsonRes(res, 200, { ok: true, total: 0 });
      return;
    }

    // POST /canvas/sync — batch sync (full replace)
    if (req.method === 'POST' && urlPath === '/canvas/sync') {
      readJsonBody(req, (err, data) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const elements = Array.isArray(data) ? data : (data.elements || []);
        if (!Array.isArray(elements)) {
          jsonRes(res, 400, { error: 'expected array or { elements: array }' });
          return;
        }
        canvasElements.length = 0;
        canvasElements.push(...elements);
        broadcastCanvasUpdate();
        jsonRes(res, 200, { ok: true, total: canvasElements.length });
      });
      return;
    }

    // GET /canvas/mode — get current canvas mode
    if (req.method === 'GET' && urlPath === '/canvas/mode') {
      jsonRes(res, 200, { mode: currentCanvasMode || 'free' });
      return;
    }

    // POST /canvas/mode — set canvas mode
    if (req.method === 'POST' && urlPath === '/canvas/mode') {
      readJsonBody(req, (err, data) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const name = data.name;
        if (!name || typeof name !== 'string') {
          jsonRes(res, 400, { error: 'body must contain { name: string }' });
          return;
        }
        currentCanvasMode = name === 'free' ? null : name;
        broadcastCanvasModeChange(currentCanvasMode || 'free');
        jsonRes(res, 200, { ok: true, mode: currentCanvasMode || 'free' });
      });
      return;
    }

    // POST /canvas/mode/reset — reset canvas mode to free
    if (req.method === 'POST' && urlPath === '/canvas/mode/reset') {
      currentCanvasMode = null;
      broadcastCanvasModeChange('free');
      jsonRes(res, 200, { ok: true, mode: 'free' });
      return;
    }

    // POST /canvas/show — show overlay in canvas mode (trigger React to mount Excalidraw)
    // POST /canvas/show — show overlay in terminal mode
    // POST /canvas/hide — hide overlay
    if (req.method === 'POST' && urlPath === '/canvas/show') {
      readJsonBody(req, (err, data) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
        const overlayMode = data && data.mode ? data.mode : 'canvas';
        const code = [
          '(function() {',
          "  window.dispatchEvent(new CustomEvent('cloe-bridge', {",
          "    detail: { action: 'show', mode: '" + overlayMode + "' }",
          "  }));",
          "  return 'ok';",
          '})()',
        ].join('\n');
        const timer = setTimeout(function() {
          jsonRes(res, 200, { ok: true, mode: overlayMode, note: 'timeout' });
        }, 3000);
        win.webContents.executeJavaScript(code, true).then(function() {
          clearTimeout(timer);
          jsonRes(res, 200, { ok: true, mode: overlayMode });
        }).catch(function(err) {
          clearTimeout(timer);
          jsonRes(res, 200, { ok: true, mode: overlayMode, warning: err.message });
        });
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/canvas/hide') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      const hideCode = [
        '(function() {',
        "  window.dispatchEvent(new CustomEvent('cloe-bridge', {",
        "    detail: { action: 'hide' }",
        "  }));",
        "  return 'ok';",
        '})()',
      ].join('\n');
      const timer = setTimeout(function() {
        jsonRes(res, 200, { ok: true });
      }, 3000);
      win.webContents.executeJavaScript(hideCode, true).then(function() {
        clearTimeout(timer);
        jsonRes(res, 200, { ok: true });
      }).catch(function(err) {
        clearTimeout(timer);
        jsonRes(res, 200, { ok: true, warning: err.message });
      });
      return;
    }

    // ==================== Code Walkthrough ====================
    // POST /terminal/walk — interactive code walkthrough in xterm terminal
    // Uses bat for syntax highlighting, renders ANSI directly in xterm.
    if (req.method === 'POST' && urlPath === '/terminal/walk') {
      readJsonBody(req, function(err, body) {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }

        var action = body && body.action;

        if (action === 'start') {
          // Pre-render all steps with bat, then send to renderer
          var steps = body.steps || [];
          var execFile = require('child_process').execFile;
          var nodePath = require('path');
          var batPromises = steps.map(function(step) {
            var expandedPath = (step.file || '').replace(/^~/, process.env.HOME || '/Users/lijian');
            var fileDir = nodePath.dirname(expandedPath);
            var fileName = nodePath.basename(expandedPath);

            // bat syntax-highlighted code rendering
            var renderPromise = new Promise(function(resolveRender) {
              var args = ['--color=always', '--style=numbers', '--wrap=never'];
              if (step.start && step.end) {
                args.push('--line-range', step.start + ':' + step.end);
              }
              if (step.highlight && step.highlight.length > 0) {
                args.push('--highlight-line', step.highlight.join(','));
              }
              args.push('--terminal-width', '120');
              args.push(expandedPath);
              execFile('bat', args, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }, function(batErr, stdout) {
                if (batErr) {
                  // Fallback: read raw file
                  try {
                    var fs = require('fs');
                    var content = fs.readFileSync(expandedPath, 'utf-8');
                    var lines = content.split('\n');
                    var s = step.start || 1;
                    var e = step.end || lines.length;
                    var range = lines.slice(s - 1, e).map(function(l, i) {
                      var n = String(s + i).padStart(4, ' ');
                      return '\x1b[90m' + n + ' │\x1b[0m ' + l;
                    }).join('\n');
                    resolveRender(range);
                  } catch (fsErr) {
                    resolveRender('Error: ' + fsErr.message);
                  }
                  return;
                }
                resolveRender(stdout);
              });
            });

            // git diff HEAD for this file
            var diffPromise = new Promise(function(resolveDiff) {
              execFile('git', ['-C', fileDir, 'diff', 'HEAD', '--color=always', '--', fileName],
                { encoding: 'utf-8', maxBuffer: 1024 * 1024 }, function(diffErr, diffStdout) {
                  resolveDiff(diffStdout && diffStdout.trim() ? diffStdout : '');
                });
            });

            return Promise.all([renderPromise, diffPromise]).then(function(results) {
              return {
                file: step.file,
                start: step.start,
                end: step.end,
                title: step.title,
                note: step.note,
                ansi: results[0],
                diffAnsi: results[1]
              };
            });
          });

          Promise.all(batPromises).then(function(rendered) {
            // 1. Ensure terminal mode is visible
            var showCode = [
              '(function() {',
              "  window.dispatchEvent(new CustomEvent('cloe-bridge', {",
              "    detail: { action: 'show', mode: 'terminal' }",
              "  }));",
              '})()',
            ].join('\n');
            win.webContents.executeJavaScript(showCode, true).then(function() {
              // 2. Wait for terminal to be visible, then inject data via base64
              setTimeout(function() {
                var b64 = Buffer.from(JSON.stringify(rendered)).toString('base64');
                var walkCode = [
                  '(function() {',
                  '  try {',
                  '    var s = atob("' + b64 + '");',
                  '    var u8 = new Uint8Array(s.length);',
                  '    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);',
                  '    var d = JSON.parse(new TextDecoder().decode(u8));',
                  '    if (window.cloeCodeWalk) window.cloeCodeWalk.start(d);',
                  '    return "ok";',
                  '  } catch(e) { return "err:" + e.message; }',
                  '})()',
                ].join('\n');
                win.webContents.executeJavaScript(walkCode, true).then(function(result) {
                  jsonRes(res, 200, { ok: true, steps: rendered.length, result: result });
                }).catch(function(jsErr) {
                  jsonRes(res, 200, { ok: true, steps: rendered.length, warning: jsErr.message });
                });
              }, 500);
            }).catch(function(showErr) {
              jsonRes(res, 500, { error: 'Failed to show terminal: ' + showErr.message });
            });
          });
          return;
        }

        if (action === 'stop') {
          var stopCode = [
            '(function() {',
            '  if (window.cloeCodeWalk) {',
            '    window.cloeCodeWalk.stop();',
            '  }',
            '  return "ok";',
            '})()',
          ].join('\n');
          win.webContents.executeJavaScript(stopCode, true).then(function() {
            jsonRes(res, 200, { ok: true });
          }).catch(function(jsErr) {
            jsonRes(res, 200, { ok: true, warning: jsErr.message });
          });
          return;
        }

        if (action === 'next') {
          var nextCode = [
            '(function() {',
            '  if (window.cloeCodeWalk && window.cloeCodeWalk.active) {',
            '    window.cloeCodeWalk.next();',
            '  }',
            '  return "ok";',
            '})()',
          ].join('\n');
          win.webContents.executeJavaScript(nextCode, true).then(function() {
            jsonRes(res, 200, { ok: true });
          });
          return;
        }

        if (action === 'prev') {
          var prevCode = [
            '(function() {',
            '  if (window.cloeCodeWalk && window.cloeCodeWalk.active) {',
            '    window.cloeCodeWalk.prev();',
            '  }',
            '  return "ok";',
            '})()',
          ].join('\n');
          win.webContents.executeJavaScript(prevCode, true).then(function() {
            jsonRes(res, 200, { ok: true });
          });
          return;
        }

        if (action === 'get-comments') {
          var commentCode = [
            '(function() {',
            '  if (!window.cloeCodeWalk) return JSON.stringify({comments:[]});',
            '  return JSON.stringify({comments: window.cloeCodeWalk.comments || []});',
            '})()',
          ].join('\n');
          win.webContents.executeJavaScript(commentCode, true).then(function(result) {
            try {
              var parsed = JSON.parse(result);
              jsonRes(res, 200, { ok: true, comments: parsed.comments || [] });
            } catch(e) {
              jsonRes(res, 200, { ok: true, comments: [] });
            }
          }).catch(function(jsErr) {
            jsonRes(res, 200, { ok: true, comments: [], warning: jsErr.message });
          });
          return;
        }

        jsonRes(res, 400, { error: 'unknown action: ' + action });
      });
      return;
    }

    // ==================== Excalidraw Direct Bridge ====================
    // These endpoints bypass the old IPC canvas mechanism and directly
    // call window.cloeExcalidraw in the renderer via executeJavaScript.

    // POST /canvas/excalidraw/draw — add/update elements on Excalidraw canvas
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/draw') {
      readJsonBody(req, function(err, data) {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
        var elements = Array.isArray(data) ? data : (data.elements || []);
        if (!Array.isArray(elements)) { jsonRes(res, 400, { error: 'expected array or { elements: array }' }); return; }
        var drawCode = '(function() { if (!window.cloeExcalidraw) return JSON.stringify({error:"not loaded"}); window.cloeExcalidraw.updateScene(' + JSON.stringify(elements) + '); return JSON.stringify({ok:true,count:' + elements.length + '}); })()';
        win.webContents.executeJavaScript(drawCode, true).then(function(result) {
          jsonRes(res, 200, JSON.parse(result));
        }).catch(function(err) {
          jsonRes(res, 500, { error: err.message });
        });
      });
      return;
    }

    // GET /canvas/excalidraw/scene — read current Excalidraw scene
    if (req.method === 'GET' && urlPath === '/canvas/excalidraw/scene') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      var getSceneCode = [
        '(function() {',
        '  var result = { loaded: !!window.cloeExcalidraw, elements: [], count: 0 };',
        '  if (window.cloeExcalidraw) {',
        '    var els = window.cloeExcalidraw.getSceneElements();',
        '    var clean = els.map(function(el) { var obj = Object.assign({}, el); delete obj.seed; return obj; });',
        '    result.elements = clean;',
        '    result.count = clean.length;',
        '  }',
        '  return JSON.stringify(result);',
        '})()',
      ].join('\n');
      win.webContents.executeJavaScript(getSceneCode, true).then(function(result) {
        jsonRes(res, 200, JSON.parse(result));
      }).catch(function(err) {
        jsonRes(res, 500, { error: err.message });
      });
      return;
    }

    // DELETE /canvas/excalidraw/scene — clear Excalidraw canvas
    if (req.method === 'DELETE' && urlPath === '/canvas/excalidraw/scene') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      win.webContents.executeJavaScript(`
        if (window.cloeExcalidraw) window.cloeExcalidraw.resetScene();
        'ok';
      `, true).then(() => {
        jsonRes(res, 200, { ok: true });
      }).catch(err => {
        jsonRes(res, 500, { error: err.message });
      });
      return;
    }

    // ── Canvas attention-guiding endpoints ──

    // POST /canvas/excalidraw/zoom — zoom to specific level
    //   body: { "level": 2 }  (1 = 100%, 2 = 200%)
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/zoom') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      readJsonBody(req, (err, body) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const level = Number(body.level) || 1;
        win.webContents.executeJavaScript(`
          if (window.cloeExcalidraw) window.cloeExcalidraw.zoomTo(${level});
          'ok';
        `, true).then(() => jsonRes(res, 200, { ok: true, level }))
          .catch(err => jsonRes(res, 500, { error: err.message }));
      });
      return;
    }

    // POST /canvas/excalidraw/pan — pan canvas so (x,y) is centered
    //   body: { "x": 200, "y": 300 }
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/pan') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      readJsonBody(req, (err, body) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const x = Number(body.x) || 0;
        const y = Number(body.y) || 0;
        win.webContents.executeJavaScript(`
          if (window.cloeExcalidraw) window.cloeExcalidraw.panTo(${x}, ${y});
          'ok';
        `, true).then(() => jsonRes(res, 200, { ok: true, x, y }))
          .catch(err => jsonRes(res, 500, { error: err.message }));
      });
      return;
    }

    // POST /canvas/excalidraw/select — select/highlight elements
    //   body: { "ids": ["el1", "el2"] }
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/select') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      readJsonBody(req, (err, body) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const ids = Array.isArray(body.ids) ? body.ids : [];
        const safeIds = JSON.stringify(ids);
        win.webContents.executeJavaScript(`
          if (window.cloeExcalidraw) window.cloeExcalidraw.selectElements(${safeIds});
          'ok';
        `, true).then(() => jsonRes(res, 200, { ok: true, selected: ids }))
          .catch(err => jsonRes(res, 500, { error: err.message }));
      });
      return;
    }

    // POST /canvas/excalidraw/deselect — clear selection
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/deselect') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      win.webContents.executeJavaScript(`
        if (window.cloeExcalidraw) window.cloeExcalidraw.deselectAll();
        'ok';
      `, true).then(() => jsonRes(res, 200, { ok: true }))
        .catch(err => jsonRes(res, 500, { error: err.message }));
      return;
    }

    // POST /canvas/excalidraw/focus — zoom + pan to center on specific elements
    //   body: { "ids": ["el1", "el2"] }
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/focus') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      readJsonBody(req, (err, body) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const ids = Array.isArray(body.ids) ? body.ids : [];
        const safeIds = JSON.stringify(ids);
        win.webContents.executeJavaScript(`
          if (window.cloeExcalidraw) window.cloeExcalidraw.focusElements(${safeIds});
          'ok';
        `, true).then(() => jsonRes(res, 200, { ok: true, focused: ids }))
          .catch(err => jsonRes(res, 500, { error: err.message }));
      });
      return;
    }

    // DELETE /canvas/excalidraw/elements — delete specific elements by id
    //   body: { "ids": ["el1", "el2"] }
    if (req.method === 'DELETE' && urlPath === '/canvas/excalidraw/elements') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      readJsonBody(req, (err, body) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const ids = Array.isArray(body.ids) ? body.ids : [];
        const safeIds = JSON.stringify(ids);
        win.webContents.executeJavaScript(`
          if (window.cloeExcalidraw) window.cloeExcalidraw.deleteElements(${safeIds});
          'ok';
        `, true).then(() => jsonRes(res, 200, { ok: true, deleted: ids }))
          .catch(err => jsonRes(res, 500, { error: err.message }));
      });
      return;
    }

    // POST /canvas/excalidraw/files — register binary files for image elements
    //   body: { "files": { "fileId1": { "mimeType": "image/jpeg", "data": "<base64>" } } }
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/files') {
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      readJsonBody(req, (err, body) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const filesMap = body.files || body;
        if (typeof filesMap !== 'object' || Array.isArray(filesMap)) {
          jsonRes(res, 400, { error: 'expected { files: { id: { mimeType, data } } }' }); return;
        }
        const safeFiles = JSON.stringify(filesMap);
        win.webContents.executeJavaScript(`
          (function() {
            if (!window.cloeExcalidraw || !window.cloeExcalidraw.addFiles) return JSON.stringify({error:'addFiles not available'});
            try { window.cloeExcalidraw.addFiles(${safeFiles}); return JSON.stringify({ok:true}); }
            catch(e) { return JSON.stringify({error:e.message}); }
          })()
        `, true).then(result => {
          jsonRes(res, 200, JSON.parse(result));
        }).catch(err => {
          jsonRes(res, 500, { error: err.message });
        });
      });
      return;
    }

    // POST /chat/message — inject an external message into the chat window
    //   body: { "role": "assistant", "content": "text", "image": "<optional base64>" }
    if (req.method === 'POST' && urlPath === '/chat/message') {
      readJsonBody(req, (err, body) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const role = body.role || 'assistant';
        const content = body.content || '';
        const image = body.image || null;
        if (!content && !image) { jsonRes(res, 400, { error: 'content or image required' }); return; }
        // Send via IPC to all windows that might be listening
        const msg = { role, content, image, timestamp: Date.now() };
        try { win?.webContents?.send('external-chat-message', msg); } catch {}
        try { chatWin?.webContents?.send('external-chat-message', msg); } catch {}
        jsonRes(res, 200, { ok: true });
      });
      return;
    }

    // GET /screenshot — capture window content as PNG (for debugging)
    //    /screenshot?bg=1 — temporarily add opaque background for better capture of transparent windows
    if (req.method === 'GET' && (urlPath === '/screenshot' || urlPath === '/chat-screenshot')) {
      const targetWin = urlPath === '/chat-screenshot' ? chatWin : win;
      if (!targetWin || targetWin.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }

      const wantBg = parsedUrl.query && parsedUrl.query.bg;
      const capture = () => targetWin.webContents.capturePage().then(img => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(img.toPNG());
      }).catch(err => {
        jsonRes(res, 500, { error: err.message });
      });

      if (wantBg) {
        // Inject a temporary opaque background behind everything, capture, then remove
        targetWin.webContents.executeJavaScript(`
          (function(){
            var d = document.createElement('div');
            d.id = '__screenshot_bg';
            d.style.cssText = 'position:fixed;inset:0;z-index:0;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);';
            document.body.insertBefore(d, document.body.firstChild);
          })();
        `).then(() => {
          setTimeout(() => {
            capture().then(() => {
              targetWin.webContents.executeJavaScript(`
                document.getElementById('__screenshot_bg')?.remove();
              `).catch(() => {});
            });
          }, 300);
        }).catch(() => capture());
      } else {
        capture();
      }
      return;
    }

    // GET /dom-screenshot — take a screenshot via renderer-side Canvas (fallback for transparent windows)
    if (req.method === 'GET' && urlPath === '/dom-screenshot') {
      const targetWin = win;
      if (!targetWin || targetWin.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return; }
      // Inject an opaque bg, draw all DOM images to a canvas, export as PNG
      const code = `(function(){
        return new Promise(function(resolve){
          try {
            var canvas = document.createElement('canvas');
            var dpr = window.devicePixelRatio || 1;
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            var ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            // Draw opaque background
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
            // Draw weather canvas if exists
            var wc = document.getElementById('weather-canvas');
            if (wc) { try { ctx.drawImage(wc, 0, 0, window.innerWidth, window.innerHeight); } catch(e) {} }
            // Draw all visible images
            var imgs = document.querySelectorAll('img');
            var pending = imgs.length;
            if (pending === 0) { resolve(canvas.toDataURL('image/png')); return; }
            imgs.forEach(function(img) {
              if (img.complete && img.naturalWidth > 0) {
                var r = img.getBoundingClientRect();
                if (r.width > 0) { try { ctx.drawImage(img, r.x, r.y, r.width, r.height); } catch(e) {} }
              }
              pending--;
              if (pending === 0) resolve(canvas.toDataURL('image/png'));
            });
          } catch(e) { resolve('ERROR:' + e.message); }
        });
      })();`;
      targetWin.webContents.executeJavaScript(code, true).then(function(dataUrl) {
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png')) {
          var base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
          var buf = Buffer.from(base64Data, 'base64');
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(buf);
        } else {
          jsonRes(res, 500, { error: 'Failed to capture: ' + dataUrl });
        }
      }).catch(function(err) {
        jsonRes(res, 500, { error: err.message });
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/chat-toggle') {
      toggleChatWindow();
      jsonRes(res, 200, { ok: true });
      return;
    }

    // --- Reminder Engine Routes ---
    if (reminderEngine.handleReminderRoute(req, res)) {
      return;
    }

    // --- Agent Session Tracker Routes ---
    if (agentTracker.handleAgentRoute(req, res)) {
      return;
    }

    // --- TTS Scheduler Routes ---
    if (ttsScheduler.handleTTSRoute(req, res)) {
      return;
    }

    // --- Weather Routes ---
    if (weatherEngine.handleWeatherRoute(req, res)) {
      return;
    }

    // --- Task Engine Routes ---
    if (taskEngine.handleTaskRoute(req, res)) {
      return;
    }

    // --- Global Mute Toggle ---
    if (req.method === 'POST' && urlPath === '/toggle-mute') {
      const muted = muteState.toggleMute();
      broadcastToClients({ type: 'mute-state-changed', muted });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ muted }));
      return;
    }

    // --- Global Mute State ---
    if (req.method === 'GET' && urlPath === '/mute-state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ muted: muteState.isMuted() }));
      return;
    }

    // --- Global Pause Toggle ---
    if (req.method === 'POST' && urlPath === '/toggle-global-pause') {
      const paused = muteState.toggleGlobalPause();
      let count = 0;
      if (paused) {
        count = reminderEngine.pauseAllRunning();
      } else {
        count = reminderEngine.resumeAllGloballyPaused();
      }
      broadcastToClients({ type: 'global-pause-changed', paused, count });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ paused, count }));
      return;
    }

    // --- Global Pause State ---
    if (req.method === 'GET' && urlPath === '/global-pause-state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ paused: muteState.isGlobalPaused() }));
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



// ==================== Manager Window ====================
function createManagerWindow() {
  if (managerWin) {
    managerWin.show();
    managerWin.focus();
    return;
  }

  managerWin = new BrowserWindow({
    width: 880,
    height: 620,
    title: 'Cloe',
    transparent: false,
    frame: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    alwaysOnTop: false,
    resizable: true,
    skipTaskbar: false,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#1c1c1e',
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
    windowRegistry.setManagerWindow(null);
  });
  windowRegistry.setManagerWindow(managerWin);
}

ipcMain.on('open-settings', () => {
  createManagerWindow();
});

// ==================== Chat Window (standalone BrowserWindow) ====================
// All chat windows now go through createChatWindowForSession() which ensures
// each window is bound to a cloe-desktop session ID.

function createChatWindow() {
  // Legacy entry point — create a new session and open a window for it
  const session = cloeSessions.createSession({ title: 'New chat' });
  return createChatWindowForSession(session.id);
}

function openLatestUnsentOrCreateChatSession() {
  const existing = cloeSessions.findLatestUnsentSession();
  if (existing) {
    createChatWindowForSession(existing.id);
    return { sessionId: existing.id, reused: true };
  }
  const session = cloeSessions.createSession({ title: 'New chat' });
  createChatWindowForSession(session.id);
  return { sessionId: session.id, reused: false };
}

function toggleChatWindow() {
  // Find the most recently used chat window and toggle it.
  // If none exists, create a new session + window.
  const chatWindows = BrowserWindow.getAllWindows().filter(w =>
    !w.isDestroyed() && w.webContents?.getURL()?.includes('/chat.html')
  );
  if (chatWindows.length > 0) {
    const target = chatWindows[chatWindows.length - 1];
    if (target.isVisible()) {
      target.hide();
      try { win?.webContents.send('chat-window-state', false); } catch {}
    } else {
      target.show();
      target.focus();
      try { win?.webContents.send('chat-window-state', true); } catch {}
    }
  } else {
    createChatWindow();
    try { win?.webContents.send('chat-window-state', true); } catch {}
  }
}

ipcMain.on('chat-window-close', (event) => {
  // Hide the specific window that sent this
  const senderWin = BrowserWindow.fromId(event.sender.id);
  if (senderWin && !senderWin.isDestroyed()) {
    senderWin.hide();
  }
  try { win?.webContents.send('chat-window-state', false); } catch {}
});
ipcMain.on('chat-window-toggle', () => toggleChatWindow());
ipcMain.on('chat-window-minimize', (event) => {
  const senderWin = BrowserWindow.fromId(event.sender.id);
  if (senderWin && !senderWin.isDestroyed()) {
    senderWin.minimize();
  }
});

// Legacy: open-new-chat-window is now handled by create-chat-session IPC.
// The old handler is removed to prevent duplicate session creation.

// ==================== Chat Window — Session Management ====================

/**
 * Create a new internal chat session and open it in a chat window.
 * IPC: 'create-chat-session' → returns { sessionId }
 */
ipcMain.handle('create-chat-session', async () => {
  const session = cloeSessions.createSession({ title: 'New chat' });
  createChatWindowForSession(session.id);
  return { sessionId: session.id };
});

/**
 * Open the latest unsent internal chat session, or create one if none exists.
 * IPC: 'quick-chat-session' → returns { sessionId, reused }
 */
ipcMain.handle('quick-chat-session', async () => {
  return openLatestUnsentOrCreateChatSession();
});

/**
 * Open an existing internal chat session in a chat window.
 * If the session already has an open window, focus it instead.
 * IPC: 'open-chat-session' (sessionId) → returns { ok: true }
 */
ipcMain.handle('open-chat-session', async (_event, sessionId) => {
  const session = cloeSessions.getSession(sessionId);
  if (!session) return { ok: false, error: 'session not found' };
  createChatWindowForSession(sessionId);
  return { ok: true };
});

/**
 * Delete an internal chat session (persisted storage).
 * IPC: 'delete-chat-session' (sessionId) → returns { ok: true }
 */
ipcMain.handle('delete-chat-session', async (_event, sessionId) => {
  // Close any chat window displaying this session
  const allWins = BrowserWindow.getAllWindows().filter(w =>
    !w.isDestroyed() && w.webContents?.getURL()?.includes('/chat.html')
  );
  for (const w of allWins) {
    if (w._cloeSessionId === sessionId) {
      try { w.close(); } catch {}
    }
  }
  cloeSessions.deleteSession(sessionId);
  return { ok: true };
});

/**
 * Create (or reuse) a chat window for a specific session ID.
 * Each window tracks which session it belongs to via _cloeSessionId.
 */
function createChatWindowForSession(sessionId) {
  // Check if a window for this session already exists
  const existing = BrowserWindow.getAllWindows().find(w =>
    !w.isDestroyed() &&
    w.webContents?.getURL()?.includes('/chat.html') &&
    w._cloeSessionId === sessionId
  );
  if (existing) {
    existing.show();
    existing.focus();
    return existing;
  }

  // Calculate offset from existing chat windows.
  // When the main window is in macOS fullscreen, its bounds span the whole
  // screen, so positioning the chat relative to mainBounds would place it
  // off-screen (and macOS may then enlarge it). In that case, anchor the
  // chat window to the visible screen area instead.
  let originX, originY;
  const mainIsFullscreen = win && !win.isDestroyed() && win.isFullScreen();
  if (mainIsFullscreen) {
    const screenArea = screen.getPrimaryDisplay().workArea;
    originX = screenArea.x + 40;
    originY = screenArea.y + 40;
  } else {
    const mainBounds = win?.getBounds() || { x: 100, y: 100, width: 600, height: 500 };
    originX = mainBounds.x + mainBounds.width + 16;
    originY = mainBounds.y;
  }
  const existingWindows = BrowserWindow.getAllWindows().filter(w =>
    !w.isDestroyed() && w.webContents?.getURL()?.includes('/chat.html')
  );
  const offset = existingWindows.length * 30;

  const chatWindow = new BrowserWindow({
    width: 400,
    height: 520,
    x: originX + offset,
    y: originY + offset,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    fullscreenable: false,
    minWidth: 300,
    minHeight: 250,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'chat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  chatWindow._cloeSessionId = sessionId;

  if (!app.isPackaged) {
    chatWindow.loadURL('http://localhost:5173/src/chat.html');
  } else {
    chatWindow.loadFile(path.join(__dirname, 'dist', 'src', 'chat.html'));
  }

  // Disable spellcheck so macOS doesn't draw red squiggles under the model
  // name shown in the <select>, or under typed text.
  try {
    chatWindow.webContents.session.setSpellCheckerEnabled(false);
    chatWindow.webContents.on('did-attach-webview', () => {
      chatWindow.webContents.session.setSpellCheckerEnabled(false);
    });
  } catch (e) {
    console.error('[chat] disable spellcheck failed:', e.message);
  }

  // Send the session ID to the window — use 'did-finish-load' as primary
  // and a small delay fallback in case the React app isn't ready yet
  chatWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      try { chatWindow.webContents.send('chat-window-session', sessionId); } catch {}
    }, 100);
  });

  chatWindow.once('ready-to-show', () => chatWindow.show());
  return chatWindow;
}

// ==================== Workspace Window (standalone BrowserWindow) ====================
let workspaceWin = null;

function createWorkspaceWindow() {
  // If window exists, toggle visibility
  if (workspaceWin && !workspaceWin.isDestroyed()) {
    if (workspaceWin.isVisible()) {
      workspaceWin.hide();
    } else {
      workspaceWin.show();
      workspaceWin.focus();
    }
    try { win?.webContents.send('workspace-window-state', workspaceWin.isVisible()); } catch {}
    return;
  }

  const display = screen.getPrimaryDisplay();
  const winWidth = 680;
  const winHeight = 520;
  // Center on screen: window center = screen center
  const centerX = Math.round(display.bounds.x + (display.bounds.width - winWidth) / 2);
  const centerY = Math.round(display.bounds.y + (display.bounds.height - winHeight) / 2);

  workspaceWin = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: centerX,
    y: centerY,
    transparent: true,
    frame: false,
    alwaysOnTop: false,
    resizable: true,
    minWidth: 400,
    minHeight: 300,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'workspace-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  workspaceWin.setMenuBarVisibility(false);

  if (!app.isPackaged) {
    workspaceWin.loadURL('http://localhost:5173/src/workspace.html');
  } else {
    workspaceWin.loadFile(path.join(__dirname, 'dist', 'src', 'workspace.html'));
  }

  workspaceWin.once('ready-to-show', () => { workspaceWin.show(); });

  workspaceWin.on('closed', () => {
    workspaceWin = null;
    windowRegistry.setWorkspaceWindow(null);
    try { win?.webContents.send('workspace-window-state', false); } catch {}
  });
  windowRegistry.setWorkspaceWindow(workspaceWin);

  try { win?.webContents.send('workspace-window-state', true); } catch {}
}

ipcMain.on('workspace-window-toggle', () => createWorkspaceWindow());
ipcMain.on('workspace-window-close', () => {
  if (workspaceWin && !workspaceWin.isDestroyed()) {
    workspaceWin.hide();
    try { win?.webContents.send('workspace-window-state', false); } catch {}
  }
});
ipcMain.on('workspace-window-move', (_e, payload) => {
  if (workspaceWin && !workspaceWin.isDestroyed() && payload) {
    const dx = Math.round(payload.dx || 0);
    const dy = Math.round(payload.dy || 0);
    const [x, y] = workspaceWin.getPosition();
    workspaceWin.setPosition(x + dx, y + dy);
  }
});

ipcMain.handle('get-chat-nickname', () => loadConfig().chatNickname || '');

// Chat window opacity toggle (transparent / opaque)
const CHAT_TRANSPARENT_OPACITY = 0.6;
const CHAT_OPAQUE_OPACITY = 1.0;
ipcMain.on('chat-set-opacity', (event, opacity) => {
  try { event.sender.setOpacity(opacity); } catch {}
});

// ==================== Chat Avatar ====================

function getChatAvatarPath() {
  return path.join(os.homedir(), '.cloe', 'chat-avatar.png');
}

ipcMain.handle('chat-select-avatar', async (event) => {
  // Attach the dialog to the chat window that asked for it (not the main
  // window) so the picker appears over the correct window in multi-session.
  const parent = BrowserWindow.fromWebContents(event.sender) || win;
  const result = await dialog.showOpenDialog(parent, {
    title: 'Select AI Avatar',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  const srcPath = result.filePaths[0];
  try {
    // Read the original image and return as base64 data URL (no resize — let the frontend crop)
    const nativeImg = nativeImage.createFromPath(srcPath);
    if (nativeImg.isEmpty()) return null;
    const pngBuf = nativeImg.toPNG();
    const base64 = pngBuf.toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (err) {
    console.error('[Chat] Error reading avatar image:', err);
    return null;
  }
});

ipcMain.handle('chat-save-avatar', (_event, dataUrl) => {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return false;
    // Extract base64 payload
    const base64 = dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    // Ensure ~/.cloe directory exists
    const cloeDir = path.join(os.homedir(), '.cloe');
    if (!fs.existsSync(cloeDir)) {
      fs.mkdirSync(cloeDir, { recursive: true });
    }
    const avatarPath = getChatAvatarPath();
    fs.writeFileSync(avatarPath, buf);
    return true;
  } catch (err) {
    console.error('[Chat] Error saving cropped avatar:', err);
    return false;
  }
});

ipcMain.handle('chat-get-avatar', () => {
  const avatarPath = getChatAvatarPath();
  try {
    if (fs.existsSync(avatarPath)) {
      const buf = fs.readFileSync(avatarPath);
      return `data:image/png;base64,${buf.toString('base64')}`;
    }
  } catch {}
  return null;
});

ipcMain.handle('chat-remove-avatar', () => {
  const avatarPath = getChatAvatarPath();
  try {
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }
    return true;
  } catch {
    return false;
  }
});

// ==================== Chat Fullscreen Pin (show on fullscreen Space) ====================

/**
 * Whether the user has pinned the chat window to appear over fullscreen.
 * Persisted in localStorage (on the chat renderer side) and synced via IPC.
 */
let chatFullscreenPenetrate = false;

ipcMain.on('chat-set-fullscreen-penetrate', (event, enabled) => {
  chatFullscreenPenetrate = !!enabled;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  if (chatFullscreenPenetrate) {
    // Allow chat to appear on fullscreen Spaces — the user can manually
    // drag it there, or it will be visible when the main window goes fullscreen.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'floating');
    console.log('[Chat] Pin enabled — visible on all workspaces');
  } else {
    win.setVisibleOnAllWorkspaces(false);
    win.setAlwaysOnTop(true, 'normal');
    console.log('[Chat] Pin disabled');
  }
});

ipcMain.handle('chat-get-fullscreen-penetrate', () => chatFullscreenPenetrate);

// ==================== Hermes API Proxy (see src/main/hermes-proxy.js — registers hermes-* ipc handlers) ====================
require('./src/main/hermes-proxy');

// ==================== Canvas Window ====================
// ==================== System Tray ====================
function createTray() {
  // Template-style tray icon (B&W cartoon face — black on transparent, auto-adapts to dark/light menu bar)
  const TRAY_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFY0lEQVR4nL2Z22tcVRjFf5mZtJl2nNqkMWmi8RJHK7XUS8XiXaGKIl4QBRERESo++KD/go/iow+Cvgjio3cfFLVStN6q1Zgm1TYxUdPaapPWNDOJnVQ+WBs2x3PO7DOTcUHInMvsvfa313fb00FjDAK/e9ebgHXAn8AqYB7oBI4BXbq3CJwB6kAFWAb2emNsBA7TBHINng97ZC8FbgL+AUaB9SJUBI7q2v6WdN8WsRY4CJwC7gfWaKzDepYZHSnPtgAj+vwocAL4UWQKQLesa2TPBkrAjCy7rLELsviS7m0HpoHvNa49P70ShDfLiobHgK+ASVmlLrK9stRqXRuJWspc3SJ+ud7bp/v9wJFWCTs8DnwgGazX/wVJaUBW7wH2A1WN1yU52LsnY8a051cB48Bx3bOxZ5slvEmDbZfmfpETLYpUjyTQJ2sf1CLOAvKeJOyZ+14txvrXAZ/r80XARLOEHXYC7wF/eZNdCVwi670lWVymd2yssrRc1/UZOZzpfE6RxMGkNAT8rGu3K6kw0ftweroP+MGLEBbGtmrrfgM+0/0jEf3lNOYGLWZJkaZHhFfr+8jyed1b1Ni2sEwwfRmejiziHmAHcAXNYQtwPXC3rOrD7qPwmDkO29bfDLztLeBa4G9Z23l2Vowoitg4F0Z21uSD/KOQlfBaOdOUrm+Vp9cUCVrBvLJdl0jjETU/QPrPRLjHC0WDcgKLFHtaJOuT3q9I5DLdT4oSvrWDCVe0YhRnOzXgSuJXGcV0jearyjC1LISN3DZgTNer5MUu7KwkPpX0nJWryq5dWQiXFFpyGshS6Se0D1Mi6SLEQFan65ZF+/XleQX9dmGfrDyoUvUczR9MeKP01SvS7ZBCFCaF81Sx1bxo0ZCwrexLZbQOOYDLSCuBiuYwP/FxXKk+F1pmFrxw0qVB8wk1xpDemY3UBEmwzNin3ZrSDnaI2LR281slpnWK+TtDCeek10kVMC60GR7RhBOy0A5t45iXEePIWvW2W8SsekvCBo33iqrAuRDCbsCqJnKETRqvee/PqLAvy1mSOoaRDEX5SZWwRUWqIMIOo9rGi3W9kDLJKUkkjrBVaYYhFTwD2kXrXN6MvHtIRdXukLBWiLmua5t8WPP5oKy6oC7kVY8YMc5kunxJ1diHwMvAjcpwz3nv9mk3XGObKTXnpTlzEIe7gGeBF4A/ZA0rNx/wao04nAs8Cbwu37CF7oqQdXI8rV2dzWrhOa226BXW7+u+BfavpWNrbT5qIBvXxBppJJ+4WmFZSauidisTYVexjSs+ujbf9V6mwWZRS7hvOn83JGnESWJCOppWO/5/YEwVYUuZ9RbgRdqPsv42S4JNH1Xt8s4M2okL1JKNhoS0NMIlOZzrBNqFbcA7+uxHpsyEa0oOFnvbiT3e56SYngnP0D4UY2J4o6OzRBS8wSytNsINymK2xbcHzlHxPluMDzn+TYUjGj34SEIuJevFwdJ8HFwd0xKCHCIG5QTHtQY3CaknQI1CiTvJTNLW1aonSip2jqpgLyoBfQN8F/O97pTys5p2mtlIM+PS14zX4frYKyv2e+3OpAp+KyPjyN4ZUCvbmLEI8cqSOmjf4lFY0X+NslVe6dbq3Cge0o68ETBvn6rDpuDvhB10J6E3RZ/DwPMZfowZbkQkDdGe7KmE944lJIBhNQETGc46DoUStvIyDV/IwR4OnPh84A7p3ZqDLCiHEE7rcB1OKCI8oU43CVuB24ADOtE3582CekhYC/k1Z413snmvFnBAhDoVLUwGFqKstnbdScOeLYL/yCeopIuBtUX2Z22PFd4mEXNGczj3Q4ydHFkU+tj7XtO1gsO/iZc4ciQ7vnwAAAAASUVORK5CYII=';
  let trayIcon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_B64, 'base64'));
  trayIcon.setTemplateImage(true);
  trayIcon = trayIcon.resize({ width: 22, height: 22 });

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

// ==================== Application Menu (macOS menu bar) ====================
function createAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { label: '设置...', accelerator: 'Cmd+,', click: () => createManagerWindow() },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${app.name}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${app.name}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置所有窗口' },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ==================== Bootstrap ====================

// Fix PATH for packaged app — macOS GUI apps get a minimal PATH from launchd,
// missing Homebrew, Hermes, and other shell-configured paths.
// Run a login shell to capture the full PATH and merge into process.env.
async function fixPath() {
  const { execSync } = require('child_process');
  try {
    const shellPath = process.env.SHELL || '/bin/zsh';
    const loginPath = execSync(`${shellPath} -l -c 'echo $PATH'`, {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    if (loginPath) {
      const extra = loginPath.split(':').filter(p => !process.env.PATH.includes(p));
      if (extra.length > 0) {
        process.env.PATH = [...extra, process.env.PATH].join(':');
        console.log('[PATH] Enriched with', extra.length, 'entries from login shell');
      }
    }
  } catch (e) {
    console.warn('[PATH] Failed to enrich PATH from login shell:', e.message);
  }
}

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
  createWindow();
  createTray();
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
