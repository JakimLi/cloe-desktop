'use strict';

/**
 * GIF Generation — DashScope/Bailian image+video pipeline and reference-image
 * generation, invoked from the action-sets management API.
 *
 * Extracted verbatim from launcher.js. Owns the generationTasks Map (taskId →
 * progress/status), exposed by reference so the HTTP route that lists
 * generation status (GET /generation-tasks) keeps reading the same instance.
 *
 * Dependencies are all already-independent modules: config (data dirs),
 * action-sets (getSetById/saveActionSets/broadcastSetConfig/setActiveSetId),
 * bridge (progress broadcasts). broadcastToClients here is a thin alias.
 *
 * Path notes: getScriptsDir() and the reference-image fallback used
 * launcher.js __dirname (project root); both re-rooted via PROJECT_ROOT.
 */

const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');
const { app } = require('electron');

const { PROJECT_ROOT, getDataDir, getBundledSeedRoot, expandDataDir, loadConfig } = require('./config');
const actionSets = require('./action-sets');
const bridge = require('./bridge');

const { getSetById, saveActionSets, broadcastSetConfig } = actionSets;

const PYTHON_BIN = '/usr/local/bin/python3';
const GIF_GEN_TIMEOUT_MS = 10 * 60 * 1000;

function broadcastToClients(data) {
  bridge.broadcast(data);
}

function getScriptsDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'scripts');
  }
  return path.join(PROJECT_ROOT, 'scripts');
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
        path.join(PROJECT_ROOT, 'reference_upperbody_bluebg.png'),
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

module.exports = {
  // path helpers (also used by HTTP routes)
  getGifsDir,
  getSetGifSubdir,
  getSetAnimationPath,
  getTtsAudioDir,
  getSetGifDir,
  // generation tasks state (shared with status route)
  getGenerationTasks: () => generationTasks,
  // jobs
  runGifGenerationJob,
  runReferenceGenerationJob,
};
