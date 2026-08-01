'use strict';

/**
 * TTS HTTP routes — generate and serve TTS audio.
 *
 *   POST /tts/generate          generate TTS from text, trigger speak.
 *                               Body: {"text":"...","speak":true}
 *                               Reads ~/.cloe/tts-config.json for provider
 *                               settings. Supports any registered provider
 *                               (see tts-providers.js). No external scripts.
 *   GET /tts/:filename          stream an audio file from the TTS audio dir,
 *                               with HTTP Range support (206 Partial Content).
 *   GET /tts-fallback/:filename stream a bundled fallback audio file.
 *
 * Exports a single dispatcher `register(ctx)` that returns a
 * `(req, res) => boolean` handler.
 *
 * Dependencies injected via ctx:
 *   - getTtsAudioDir()    (gif-generation module)
 *   - broadcast(data)     (bridge.broadcast)
 */

const { PROVIDERS } = require('./tts-providers');

module.exports = function register(ctx) {
  const { getTtsAudioDir, broadcast } = ctx;
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const { execFile } = require('child_process');

  // ── TTS config loader (cached, with mtime check) ──
  let _ttsConfig = null;
  let _ttsConfigMtime = 0;
  function loadTtsConfig() {
    const cfgPath = path.join(os.homedir(), '.cloe', 'tts-config.json');
    try {
      const stat = fs.statSync(cfgPath);
      if (_ttsConfig && stat.mtimeMs === _ttsConfigMtime) return _ttsConfig;
      _ttsConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      _ttsConfigMtime = stat.mtimeMs;
      return _ttsConfig;
    } catch {
      return null;
    }
  }

  // ── WAV → MP3 via ffmpeg ──
  function convertToMp3(audioBuf, srcFormat) {
    return new Promise((resolve, reject) => {
      const ttsDir = getTtsAudioDir();
      const ts = Date.now();
      const inPath = path.join(ttsDir, `_tmp_${ts}.${srcFormat}`);
      const mp3Path = path.join(ttsDir, `tts_${ts}.mp3`);
      fs.writeFileSync(inPath, audioBuf);
      execFile('ffmpeg', ['-y', '-i', inPath, '-c:a', 'libmp3lame', '-b:a', '128k',
        '-ar', '44100', '-ac', '2', mp3Path],
        { timeout: 10000 }, (err) => {
          try { fs.unlinkSync(inPath); } catch {}
          if (err) return reject(new Error('ffmpeg conversion failed: ' + err.message));
          resolve(mp3Path);
        });
    });
  }

  // ── Trigger speak action via broadcast ──
  function triggerSpeak(mp3Filename) {
    if (broadcast) {
      broadcast({
        action: 'speak',
        audio_url: `http://localhost:19851/tts/${mp3Filename}`,
      });
    }
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => resolve(body));
    });
  }

  const TTS_CONFIG_PATH = path.join(os.homedir(), '.cloe', 'tts-config.json');

  function saveTtsConfig(cfg) {
    const dir = path.dirname(TTS_CONFIG_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TTS_CONFIG_PATH, JSON.stringify(cfg, null, 2));
    _ttsConfig = null; // invalidate cache
  }

  return function ttsRoutes(req, res) {
    const urlPath = (req.url || '').split('?')[0];

    // GET /tts/config — read TTS config
    if (req.method === 'GET' && urlPath === '/tts/config') {
      const cfg = loadTtsConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cfg || {}));
      return true;
    }

    // POST /tts/config — save TTS config
    if (req.method === 'POST' && urlPath === '/tts/config') {
      readBody(req).then((body) => {
        const cfg = JSON.parse(body);
        saveTtsConfig(cfg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }).catch((e) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
      return true;
    }

    // POST /tts/generate — generate TTS from text and optionally trigger speak
    if (req.method === 'POST' && urlPath === '/tts/generate') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', async () => {
        try {
          const { text, speak } = JSON.parse(body);
          if (!text || typeof text !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing "text" field' }));
            return;
          }

          const ttsConfig = loadTtsConfig();
          if (!ttsConfig) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'TTS not configured (~/.cloe/tts-config.json missing)' }));
            return;
          }

          const providerName = ttsConfig.provider || 'openai';
          const providerFn = PROVIDERS[providerName];
          if (!providerFn) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Unknown TTS provider: ${providerName}. Available: ${Object.keys(PROVIDERS).join(', ')}` }));
            return;
          }

          const providerCfg = ttsConfig[providerName];
          if (!providerCfg) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Provider "${providerName}" not configured in tts-config.json` }));
            return;
          }

          const ttsDir = getTtsAudioDir();
          fs.mkdirSync(ttsDir, { recursive: true });

          // Generate audio via the provider
          const { audio, format } = await providerFn(text, providerCfg);

          // Save — if already MP3, write directly; otherwise convert via ffmpeg
          let mp3Path;
          if (format === 'mp3') {
            const filename = `tts_${Date.now()}.mp3`;
            mp3Path = path.join(ttsDir, filename);
            fs.writeFileSync(mp3Path, audio);
          } else {
            mp3Path = await convertToMp3(audio, format);
          }

          const filename = path.basename(mp3Path);
          if (speak !== false) triggerSpeak(filename);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, filename, audio_url: `http://localhost:19851/tts/${filename}` }));
        } catch (e) {
          console.error('[TTS] generate error:', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    // GET /tts/:filename — serve audio files from audio_cache directory
    if (req.method === 'GET' && req.url.startsWith('/tts-fallback/')) {
      const filename = decodeURIComponent(req.url.slice(14));
      if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\\0')) {
        res.writeHead(400); res.end('Invalid filename'); return;
      }
      const fbDir = path.join(__dirname, '..', '..', 'audio', 'fallback');
      const filePath = path.join(fbDir, filename);
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const stat = fs.statSync(filePath);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
      return true;
    }

    if (req.method === 'GET' && req.url.startsWith('/tts/')) {
      const filename = decodeURIComponent(req.url.slice(5));
      if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
        res.writeHead(400);
        res.end('Invalid filename');
        return true;
      }
      const ttsDir = getTtsAudioDir();
      const filePath = path.join(ttsDir, filename);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return true;
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
            return true;
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
          return true;
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
      return true;
    }

    return false;
  };
};
