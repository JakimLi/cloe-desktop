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
const os = require('os');
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
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

// ==================== User config (~/.cloe-desktop/config.json) ====================

function getConfigPath() {
  return path.join(os.homedir(), '.cloe-desktop', 'config.json');
}

function loadConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

// ==================== Action Sets — loaded from action-sets.json ====================
let actionSetsData = null;
let activeSetId = 'default';

function loadActionSets() {
  // Try multiple candidate paths: packaged (dist/) then dev (public/)
  const candidates = [
    path.join(__dirname, 'dist', 'action-sets.json'),
    path.join(__dirname, 'public', 'action-sets.json'),
  ];
  if (!app.isPackaged) {
    candidates.reverse(); // dev: public first
  }
  let loaded = false;
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        actionSetsData = JSON.parse(raw);
        activeSetId = actionSetsData.activeSetId || 'default';
        console.log(`[ActionSets] Loaded ${actionSetsData.sets.length} set(s) from ${p}`);
        loaded = true;
        break;
      }
    } catch (err) {
      console.warn(`[ActionSets] Failed to load ${p}: ${err.message}`);
    }
  }
  if (!loaded) {
    console.error('[ActionSets] No action-sets.json found in any candidate path');
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

// ==================== Action Sets CRUD Helpers ====================
function getActionSetsPath() {
  if (!app.isPackaged) {
    return path.join(__dirname, 'public', 'action-sets.json');
  }
  return path.join(__dirname, 'dist', 'action-sets.json');
}

function saveActionSets() {
  const filePath = getActionSetsPath();
  fs.writeFileSync(filePath, JSON.stringify(actionSetsData, null, 2), 'utf-8');
  console.log(`[ActionSets] Saved to ${filePath}`);
}

function generateSetId(name) {
  // Lowercase + underscore + short timestamp
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const ts = Math.floor(Date.now() / 1000) % 100000;
  return `${slug}_${ts}`;
}

function broadcastSetConfig(setId) {
  const set = getSetById(setId);
  if (!set) return;
  const msg = JSON.stringify({
    type: 'set-config',
    animations: set.animations || {},
    idlePlaylist: set.idlePlaylist || [],
    actionMap: set.actionMap || {},
  });
  let sent = 0;
  const dead = [];
  for (const ws of bridgeClients) {
    if (ws.readyState === 1) { ws.send(msg); sent++; }
    else dead.push(ws);
  }
  dead.forEach((ws) => bridgeClients.delete(ws));
  console.log(`[broadcast] set-config for "${setId}" → ${sent} client(s)`);
}

function broadcastToClients(data) {
  const msg = JSON.stringify(data);
  const dead = [];
  for (const ws of bridgeClients) {
    if (ws.readyState === 1) { ws.send(msg); }
    else dead.push(ws);
  }
  dead.forEach((ws) => bridgeClients.delete(ws));
}

// ==================== HTTPS / DashScope / GIF Generation ====================

const PYTHON_BIN = '/usr/local/bin/python3';
const GIF_GEN_TIMEOUT_MS = 10 * 60 * 1000;
const IMAGE_TASK_POLL_INTERVAL_MS = 5000;

/** taskId → { status, progress, startedAt, kind, actionName?, setId?, chromakey?, error? } */
const generationTasks = new Map();

function loadHermesEnvValue(key) {
  const envPath = path.join(os.homedir(), '.hermes', '.env');
  if (!fs.existsSync(envPath)) return '';
  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      if (k !== key) continue;
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  } catch (e) {
    console.warn(`[Hermes] read .env failed: ${e.message}`);
  }
  return '';
}

function resolveBailianApiKey() {
  const cfg = loadConfig();
  const fromCfg = cfg.dashscopeApiKey != null ? String(cfg.dashscopeApiKey).trim() : '';
  if (fromCfg) return fromCfg;
  return loadHermesEnvValue('BAILIAN_API_KEY').trim();
}

function getPublicAssetsRoot() {
  return app.isPackaged ? path.join(__dirname, 'dist') : path.join(__dirname, 'public');
}

/**
 * Absolute path to chroma reference image for GIF generation (set reference or bundled fallback).
 */
function resolveReferenceAbsolutePath(set) {
  const root = getPublicAssetsRoot();
  const chromakey = set.chromakey || 'green';
  if (set.reference) {
    const candidate = path.join(root, set.reference);
    if (fs.existsSync(candidate)) return candidate;
  }
  const fallbacks =
    chromakey === 'blue'
      ? [
        path.join(root, 'gifs', '_work_idle', '01_blue_bg_sitting.png'),
        path.join(__dirname, 'reference_upperbody_bluebg.png'),
      ]
      : [
        path.join(root, 'gifs', '_work_idle', '01_green_bg_sitting.png'),
      ];
  for (const fp of fallbacks) {
    if (fs.existsSync(fp)) return fp;
  }
  return null;
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
const REFERENCE_PROMPT_GREEN =
  '一个美丽的亚洲女孩上半身半身照，纯绿色背景(#00FF00)，自然坐姿，双手自然放身前，表情自然放松。电影质感，高清摄影风格。上半身取景，从肩膀到腰部以上。';
const REFERENCE_PROMPT_BLUE =
  '一个美丽的亚洲女孩上半身半身照，纯蓝色背景(#0000FF)，自然坐姿，双手自然放身前，表情自然放松。电影质感，高清摄影风格。上半身取景，从肩膀到腰部以上。';

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
  set.animations[name] = `gifs/${name}.gif`;
  if (!set.actionMap) set.actionMap = {};
  set.actionMap[name] = name;
  if (trigger === 'idle') {
    if (!set.idlePlaylist) set.idlePlaylist = [];
    set.idlePlaylist.push(name);
  }
}

function runGifGenerationJob(taskId, setId, set, name, prompt, durationSec, chromakey, trigger) {
  const gifDir = path.join(path.dirname(getActionSetsPath()), 'gifs');
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
      const err = 'DashScope API key missing: set dashscopeApiKey in ~/.cloe-desktop/config.json or BAILIAN_API_KEY in ~/.hermes/.env';
      if (rec) {
        rec.status = 'failed';
        rec.error = err;
      }
      broadcastToClients({ type: 'generation-error', taskId, error: err });
      return;
    }

    const referencePath = resolveReferenceAbsolutePath(set);
    if (!referencePath) {
      const err = 'No reference image: add a reference to the set or add public/gifs/_work_idle fallback image.';
      if (rec) {
        rec.status = 'failed';
        rec.error = err;
      }
      broadcastToClients({ type: 'generation-error', taskId, error: err });
      return;
    }

    const pyScript = path.join(__dirname, 'scripts', 'generate_gif_v2.py');
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

    proc = spawn(PYTHON_BIN, args, { cwd: __dirname, env });

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
        if (setId === activeSetId) {
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

function runReferenceGenerationJob(taskId, chromakey, promptText) {
  (async () => {
    broadcastToClients({ type: 'generation-progress', taskId, status: 'starting', progress: 5 });
    const rec = generationTasks.get(taskId);
    if (rec) {
      rec.status = 'starting';
      rec.progress = 5;
    }

    let apiTaskId = null;

    try {
      const apiKey = resolveBailianApiKey();
      if (!apiKey) throw new Error('DashScope API key missing');

      const prompt = promptText || (chromakey === 'blue' ? REFERENCE_PROMPT_BLUE : REFERENCE_PROMPT_GREEN);

      const postResp = await dashScopeJson({
        model: 'wanx2.1-t2i-turbo',
        input: { prompt },
        parameters: { size: '1024*1024', n: 1 },
      });

      apiTaskId =
        postResp.output?.task_id ||
        postResp.task_id ||
        postResp.output?.taskId;

      if (!apiTaskId) {
        throw new Error(`No task id in response: ${JSON.stringify(postResp).slice(0, 400)}`);
      }

      if (rec) {
        rec.dashscopeTaskId = apiTaskId;
        rec.status = 'running';
      }

      const deadline = Date.now() + 50 * 60 * 1000;
      /** @type {any} */
      let statusObj = {};

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, IMAGE_TASK_POLL_INTERVAL_MS));
        statusObj = await dashScopeTaskGet(apiTaskId);
        const st =
          statusObj.output?.task_status ||
          statusObj.task_status ||
          statusObj.output?.taskStatus;

        if (rec && st) rec.statusDetail = String(st);

        const prog = statusObj.output?.task_metrics?.percentage;
        if (rec && typeof prog === 'number') {
          rec.progress = Math.min(90, Math.max(10, prog));
          broadcastToClients({ type: 'generation-progress', taskId, status: 'running', progress: rec.progress });
        }

        if (st === 'FAILED' || st === 'UNKNOWN') {
          const errDetail =
            statusObj.output?.message ||
            statusObj.message ||
            statusObj.output?.message ||
            JSON.stringify(statusObj.output || statusObj).slice(0, 600);
          throw new Error(typeof errDetail === 'string' ? errDetail : 'Image task failed');
        }

        if (st === 'SUCCEEDED' || st === 'SUCCESS') {
          const out = statusObj.output;
          /** @type {string | undefined} */
          let imageUrl = null;
          const results = out?.results || out?.images;
          if (Array.isArray(results) && results[0]?.url) {
            imageUrl = results[0].url;
          } else if (out?.choices?.[0]?.message?.content) {
            const c = out.choices[0].message.content;
            if (Array.isArray(c) && c[0]?.image) {
              imageUrl = c[0].image;
            }
          } else if (typeof results?.[0]?.code === 'string' && /^https?:\/\//.test(results[0].code)) {
            imageUrl = results[0].code;
          }

          if (!imageUrl) {
            const rawImg = statusObj.results?.output?.choices?.[0]?.message?.content?.[0]?.image;
            if (typeof rawImg === 'string' && rawImg.startsWith('http')) {
              imageUrl = rawImg;
            }
          }

          if (!imageUrl && out?.render_urls?.[0]) {
            imageUrl = out.render_urls[0];
          }

          if (!imageUrl && statusObj.results?.results?.[0]?.url) {
            imageUrl = statusObj.results.results[0].url;
          }

          if (!imageUrl) {
            throw new Error(`SUCCEEDED but no image URL: ${JSON.stringify(out || statusObj).slice(0, 500)}`);
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
          return;
        }
      }

      throw new Error('DashScope reference image polling timed out');
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

    // --- Management API ---
    // GET /action-sets — list all sets
    if (req.method === 'GET' && req.url === '/action-sets') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sets: buildSetsSummary(), activeSetId }));
      return;
    }

    // GET /action-sets/:id — get one set with its actions
    if (req.method === 'GET' && req.url.startsWith('/action-sets/')) {
      const setId = decodeURIComponent(req.url.split('/action-sets/')[1]?.split('?')[0]);
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
          runReferenceGenerationJob(taskId, chromakey, prompt || null);
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
          const id = generateSetId(data.name);
          // Save reference image if provided
          if (data.referenceBase64) {
            const refDir = path.join(path.dirname(getActionSetsPath()), 'references');
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
          actionSetsData.sets.push(newSet);
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
      if (setId === activeSetId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'cannot delete the active set' }));
        return;
      }
      if (actionSetsData.sets.length <= 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'cannot delete the last set' }));
        return;
      }
      const idx = actionSetsData.sets.findIndex(s => s.id === setId);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return;
      }
      actionSetsData.sets.splice(idx, 1);
      saveActionSets();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sets: buildSetsSummary(), activeSetId }));
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
      activeSetId = setId;
      actionSetsData.activeSetId = setId;
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
          // Save GIF file
          const gifsDir = path.join(path.dirname(getActionSetsPath()), 'gifs');
          if (!fs.existsSync(gifsDir)) fs.mkdirSync(gifsDir, { recursive: true });
          fs.writeFileSync(path.join(gifsDir, `${data.name}.gif`), Buffer.from(data.gifBase64, 'base64'));

          // Update set data
          if (!set.animations) set.animations = {};
          set.animations[data.name] = `gifs/${data.name}.gif`;

          if (!set.actionMap) set.actionMap = {};
          set.actionMap[data.name] = data.name;

          if (data.trigger === 'idle') {
            if (!set.idlePlaylist) set.idlePlaylist = [];
            set.idlePlaylist.push(data.name);
          }

          saveActionSets();

          // Broadcast if this is the active set
          if (setId === activeSetId) {
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
      if (setId === activeSetId) {
        broadcastSetConfig(setId);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actions: buildActionsList(setId) }));
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
