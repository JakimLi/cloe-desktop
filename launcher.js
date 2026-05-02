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
const { pathToFileURL } = require('url');
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

// ==================== User config (~/.cloe/config.json) ====================

function getCloeConfigDir() {
  return path.join(os.homedir(), '.cloe');
}

function getConfigPath() {
  return path.join(getCloeConfigDir(), 'config.json');
}

function expandDataDir(raw) {
  const def = path.join(os.homedir(), '.cloe');
  const s = raw != null && String(raw).trim() !== '' ? String(raw).trim() : '~/.cloe';
  if (s.startsWith('~/')) return path.normalize(path.join(os.homedir(), s.slice(2)));
  if (s === '~') return os.homedir();
  if (path.isAbsolute(s)) return path.normalize(s);
  return path.normalize(path.join(os.homedir(), s));
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

/**
 * Writable data root: packaged → config dataDir; dev → project public/
 */
function getDataDir() {
  if (!app.isPackaged) {
    return path.join(__dirname, 'public');
  }
  const cfg = loadConfig();
  return expandDataDir(cfg.dataDir);
}

function getBundledSeedRoot() {
  return app.isPackaged ? path.join(__dirname, 'dist') : path.join(__dirname, 'public');
}

function copyTreeMissingOnly(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyTreeMissingOnly(s, d);
    } else if (!fs.existsSync(d)) {
      fs.copyFileSync(s, d);
    }
  }
}

function copyTreeOverwrite(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyTreeOverwrite(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function ensureCloeConfigDirAndMigrateConfig() {
  const cloeDir = getCloeConfigDir();
  if (!fs.existsSync(cloeDir)) {
    fs.mkdirSync(cloeDir, { recursive: true });
  }
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) {
    const merged = {
      version: 1,
      dataDir: '~/.cloe',
      videoModel: 'wan2.7-i2v',
      language: 'zh-CN',
    };
    const legacyDesktop = path.join(os.homedir(), '.cloe-desktop', 'config.json');
    if (fs.existsSync(legacyDesktop)) {
      try {
        const old = JSON.parse(fs.readFileSync(legacyDesktop, 'utf-8'));
        if (old.dashscopeApiKey != null) merged.dashscopeApiKey = old.dashscopeApiKey;
        if (old.videoModel != null) merged.videoModel = old.videoModel;
        if (old.language != null) merged.language = old.language;
        if (old.dataDir != null && String(old.dataDir).trim() !== '') merged.dataDir = old.dataDir;
        console.log('[Config] Migrated keys from ~/.cloe-desktop/config.json');
      } catch (err) {
        console.warn('[Config] Legacy ~/.cloe-desktop/config.json unreadable:', err.message);
      }
    }
    saveConfig(merged);
  } else {
    const cfg = loadConfig();
    let changed = false;
    if (cfg.dataDir == null || String(cfg.dataDir).trim() === '') {
      cfg.dataDir = '~/.cloe';
      changed = true;
    }
    if (cfg.version == null) {
      cfg.version = 1;
      changed = true;
    }
    if (changed) saveConfig(cfg);
  }

  const legacyPath = path.join(os.homedir(), '.cloe-desktop', 'config.json');
  const mergeMarker = path.join(cloeDir, '.merged-from-cloe-desktop-config');
  if (fs.existsSync(legacyPath) && !fs.existsSync(mergeMarker)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
      const cur = loadConfig();
      let changed = false;
      for (const k of ['dashscopeApiKey', 'videoModel', 'language']) {
        if (old[k] != null && old[k] !== '' && (cur[k] == null || cur[k] === '')) {
          cur[k] = old[k];
          changed = true;
        }
      }
      if (changed) saveConfig(cur);
    } catch (err) {
      console.warn('[Config] Legacy ~/.cloe-desktop merge failed:', err.message);
    }
    fs.writeFileSync(mergeMarker, `${new Date().toISOString()}\n`);
  }
}

function seedPackagedDataDir(dataDir) {
  const bundledRoot = path.join(__dirname, 'dist');
  if (!fs.existsSync(bundledRoot)) {
    console.warn('[Seed] dist/ not found, skipping seed copy');
    return;
  }
  for (const sub of ['gifs', 'references', 'audio']) {
    copyTreeMissingOnly(path.join(bundledRoot, sub), path.join(dataDir, sub));
  }
  const destJson = path.join(dataDir, 'action-sets.json');
  if (!fs.existsSync(destJson)) {
    const srcJson = path.join(bundledRoot, 'action-sets.json');
    if (fs.existsSync(srcJson)) fs.copyFileSync(srcJson, destJson);
  }
}

function migrateLegacyElectronUserData(dataDir) {
  const marker = path.join(dataDir, '.migrated-from-electron-userdata');
  if (fs.existsSync(marker)) return;

  const legacyBase = app.getPath('userData');
  if (fs.existsSync(legacyBase)) {
    const legacyGifs = path.join(legacyBase, 'gifs');
    const legacyActionSets = path.join(legacyBase, 'action-sets.json');
    if (fs.existsSync(legacyGifs)) {
      copyTreeOverwrite(legacyGifs, path.join(dataDir, 'gifs'));
      console.log('[Migrate] GIFs from', legacyGifs, '→', path.join(dataDir, 'gifs'));
    }
    if (fs.existsSync(legacyActionSets)) {
      fs.copyFileSync(legacyActionSets, path.join(dataDir, 'action-sets.json'));
      console.log('[Migrate] action-sets.json from legacy userData');
    }
  }
  fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
}

function bootstrapPackagedData() {
  const dataDir = getDataDir();
  for (const sub of ['gifs', 'references', 'audio']) {
    const d = path.join(dataDir, sub);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  seedPackagedDataDir(dataDir);
  migrateLegacyElectronUserData(dataDir);
}

// ==================== Action Sets — loaded from action-sets.json ====================
let actionSetsData = null;
let activeSetId = 'default';

function loadActionSets() {
  const primary = getActionSetsPath();
  let p = primary;
  if (!fs.existsSync(p) && app.isPackaged) {
    const bundled = path.join(__dirname, 'dist', 'action-sets.json');
    if (fs.existsSync(bundled)) p = bundled;
  }
  let loaded = false;
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      actionSetsData = JSON.parse(raw);
      activeSetId = actionSetsData.activeSetId || 'default';
      console.log(`[ActionSets] Loaded ${actionSetsData.sets.length} set(s) from ${p}`);
      loaded = true;
    }
  } catch (err) {
    console.warn(`[ActionSets] Failed to load ${p}: ${err.message}`);
  }
  if (!loaded) {
    console.error('[ActionSets] No action-sets.json found');
    actionSetsData = null;
  }
}

let actionSetsWatcher = null;
let reloadDebounceTimer = null;

function watchActionSets() {
  if (actionSetsWatcher) return; // already watching

  const filePath = getActionSetsPath();
  const dir = path.dirname(filePath);

  // Watch the directory (more reliable than watching the file directly)
  try {
    actionSetsWatcher = fs.watch(dir, (eventType, filename) => {
      if (filename !== 'action-sets.json') return;

      // Debounce: wait 300ms after last change before reloading
      // (avoids double-reload and self-trigger from saveActionSets)
      clearTimeout(reloadDebounceTimer);
      reloadDebounceTimer = setTimeout(() => {
        const currentHash = JSON.stringify(actionSetsData);
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const newData = JSON.parse(raw);
          const newHash = JSON.stringify(newData);

          // Skip if data hasn't actually changed (e.g., our own save)
          if (newHash === currentHash) return;

          actionSetsData = newData;
          activeSetId = newData.activeSetId || 'default';
          console.log(`[ActionSets] Hot-reloaded from disk: ${newData.sets.length} set(s)`);

          // Notify renderer of the active set's config
          broadcastSetConfig(activeSetId);
        } catch (err) {
          console.warn(`[ActionSets] Hot-reload failed: ${err.message}`);
        }
      }, 300);
    });
    actionSetsWatcher.on('error', (err) => {
      console.warn(`[ActionSets] Watch error: ${err.message}`);
      actionSetsWatcher = null;
      // Retry after 5 seconds
      setTimeout(watchActionSets, 5000);
    });
    console.log(`[ActionSets] Watching ${dir} for changes`);
  } catch (err) {
    console.warn(`[ActionSets] Failed to watch: ${err.message}`);
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
  return path.join(getDataDir(), 'action-sets.json');
}

function saveActionSets() {
  const filePath = getActionSetsPath();
  fs.writeFileSync(filePath, JSON.stringify(actionSetsData, null, 2), 'utf-8');
  console.log(`[ActionSets] Saved to ${filePath}`);
}

/**
 * Validate that a user-supplied name is safe to use as a filename component.
 * Rejects path traversal (../), slashes, null bytes, etc.
 */
function isSafeFilename(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_\-\u4e00-\u9fff]+$/.test(name);
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
  const msg = {
    type: 'set-config',
    animations: set.animations || {},
    idlePlaylist: set.idlePlaylist || [],
    actionMap: set.actionMap || {},
  };
  // Attach default set as fallback for non-default sets
  if (setId !== 'default') {
    const defaultSet = getSetById('default');
    if (defaultSet) {
      msg.fallbackAnimations = defaultSet.animations || {};
      msg.fallbackActionMap = defaultSet.actionMap || {};
    }
  }
  const msgStr = JSON.stringify(msg);
  let sent = 0;
  const dead = [];
  for (const ws of bridgeClients) {
    if (ws.readyState === 1) { ws.send(msgStr); sent++; }
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

// ==================== Saved main window position ====================

function getWindowPositionFilePath() {
  return path.join(getCloeConfigDir(), 'window-position.json');
}

function loadWindowPosition() {
  const p = getWindowPositionFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (typeof data.x !== 'number' || typeof data.y !== 'number'
      || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
      return null;
    }
    return { x: Math.round(data.x), y: Math.round(data.y) };
  } catch {
    return null;
  }
}

function saveWindowPosition(x, y) {
  const p = getWindowPositionFilePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ x: Math.round(x), y: Math.round(y) }), 'utf-8');
}

function clearSavedWindowPosition() {
  const p = getWindowPositionFilePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** Returns { x, y } for the main floating window: saved position if valid, else bottom-right fallback. */
function getInitialMainWindowXY(windowWidth, windowHeight) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const fallback = { x: sw - 400, y: sh - 540 };

  const saved = loadWindowPosition();
  if (!saved) return fallback;

  // 宽松检查：允许窗口部分超出屏幕边缘（macOS 正常行为）
  // 只排除极端异常值（超过屏幕尺寸2倍）
  const maxReasonable = Math.max(sw, sh) * 2;
  if (Math.abs(saved.x) > maxReasonable || Math.abs(saved.y) > maxReasonable) {
    return fallback;
  }

  return saved;
}

// ==================== Window ====================
function createWindow() {
  const ww = 380;
  const wh = 520;
  const pos = getInitialMainWindowXY(ww, wh);

  win = new BrowserWindow({
    width: ww,
    height: wh,
    x: pos.x,
    y: pos.y,
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
  // Embedded 32x32 tray icon (base64, pink circle with "C") — no file I/O needed
  const TRAY_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFo0lEQVR4nJWXz6slRxXHP6equu+vd+f9ikHfRDQwjLhxNSAoJiDBhICbiIMrCWQlJLjx33AhCboR3eoLRGbnmI0IujEgzIBBHHWCZDJk5v267/54t7uqjovbfW913/ucyYVDdd/uOud7vudbp6oFQFWtiARVfYbIm8BrxHiNqF1AUEAVFEAhJqb1Nev/qYKqIjLHuntY+x7h5B05OHhUx5Rl8Fn5Mrn7BYbnAfAKMQKVYxIQmwCE6jrE5jtazXUZdLtQlveZz34kz+//XlWtAGhZvoSYP2CNMPcBwYCR5eR0bASnCSBWoBssABohqIJGun2LMYovXpYv7bwvqrpPGe7g7AGFDxixVPFWYytYCmQNQLsMFYDaV4yBbs9SFJ/Qy75m8PEtMntAEQKyIXh9rQmda882vJcCSU2MZToJ9Adf4KL8sejcf4izX6H0iohpOm/VfqPgYlL/VhlS7URN/UayXAj+n6IX5RwxeSNDSbJJs2xrIKaBY1KKJwJYBDGUDpUcjVXUNpUbqK3rmVK9Rnn6/mUAFJDMrYInDLRL0FB8Qn+a6dp9bM5rMFqPgms8qFPW/wcgsXTtR131jqcFYATXaBYblB9jxCBoCIiwYiAk2Yak/iGgPiJA9AEjkgCgybQR3LJztRmoJpmtPkxmSL8P0xl4v3ge4kr1Ia5MBel0YTrDdLowmSZiTAAo4EwLwPIFQASc44Pf3OL+nb/zueeu8o3vfZcsy2BerKgP1egDGEt5Mecvv7vFo08e8uVr17jxrRfAl1Vbr9mohWsxeAUfFxYWo5aBoHD7nV8xfnTMK2+9wfb+Hrd++nNmZ+OFbsvQMI3KbDTm1i9/zfZwh1du/oDx0Qm3f3tICBEtPDQsQOER/XikqTh88FxczDk/PeXjf9zjq1+/gcXQ3d3lwd/usr27w2BnB50XSEW/+oiIMHl8wtnRMQfXr3NxdEwIng/v3uXqc19kOBjSzXKcMasSZAbRj060rlGMkdHojJMHD5HTCbl1zHxB9swue/v7bO3uwbyEogQx6LyAEBd7V1FUy1kYHx1zfHREeXJKz2QUvkR7XXb39rgy2MIgiQbKsBRJ9J7p6Qj99JTdUUHmlSyDkcK8N6BvxhhAfWQ6OmcwvAIqTI6O6Hd6SFRi6ZlPZ5Qnp1wZFfRDQSnK8bxg6nK2bAcjttJAC4CESG4cF52c88zjTKRwBpPnZGoQXy89+Osf/8T52RmoMhwMefHFb0MZkBDIomCMY2rm+Kh4UTA5uRqkCCC1EC2idx4oYaWBoiw4Pz9nNp4QvcdmGVv9AYNuHydmtdwQzh8/hhAZDrcXwvIBQsSXnslkzHgyJpQlRgy9To9ht09u3WqLzhyiH/xXCbGxAcWohBDQqglZBFEWS6kG4AOIWayeSgupqY+EEIghIIDFYJbtpmIgczjK2tmqDxgFowJqkrYaW00nLNa3T+6XzxQJERcVVKqWHJp9plp5Cw20AFx6+mllmfaOJoAErLLysxGAr5rJJgDL3S/NXlfBnghAm4nU23DtXxS37IKXAriMgbAOwLcArB3L0v1GIRjcspd/ZgAbLMamXi4DUPsPEYdqAeTrh8uWNQ4in9EuA6BaGuDfmExRjU92QpOdTSw9nUXEKsJ/DJk7JO8IoepGbecbLWXlKeasHWKjkuVCbt817Pbfppg+IO9ZYgyXluBpAF2mnSaYgMkssXjIs8OfGblx9TFd9zrOKlnHEuJic28j2ASqRrsJTPunqsQYEGfp5rDde13eeOGR0UO18tL197H+VXJ7n8EVi8tl9YFZ07wpu9Z34NoJOVkRxgm9gaWff8SWeVV+8p3benhYfZweqpWbEvTP955lJm8yL1+jKK8RY05UWTrxMdkPwuokVfeBWDeoBISiQIGz/6LbeY/P996WH37zU/3+oZV3b4b/Aej+HWDk6pQnAAAAAElFTkSuQmCC';
  let trayIcon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_B64, 'base64'));
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

// ==================== Bootstrap ====================
app.whenReady().then(async () => {
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
});

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed if tray is active
  // The tray menu has an explicit quit option
  if (!tray) {
    app.quit();
  }
});
