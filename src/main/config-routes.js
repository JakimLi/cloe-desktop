'use strict';

/**
 * Config HTTP routes — api-config, window position/scale, character layout,
 * plugin-rules.
 *
 * Extracted verbatim from createBridgeServers. Exports a single dispatcher
 * `register(ctx)` that returns a `(req, res) => boolean` handler; the bridge
 * calls it and stops on a hit (true).
 *
 * Dependencies are injected via ctx to avoid coupling to launcher.js globals:
 *   - loadConfig, saveConfig, getDataDir          (config module)
 *   - loadWindowPosition, saveWindowPosition, clearSavedWindowPosition
 *   - getWindowScale, setWindowScale, MIN_SCALE, MAX_SCALE
 *   - getWin()                                     (main window getter)
 */

module.exports = function register(ctx) {
  const {
    loadConfig, saveConfig, getDataDir,
    loadWindowPosition, saveWindowPosition, clearSavedWindowPosition,
    getWindowScale, setWindowScale, MIN_SCALE, MAX_SCALE,
    getWin,
  } = ctx;

  return function configRoutes(req, res, urlPath) {
    if (req.method === 'GET' && urlPath === '/api-config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(loadConfig()));
      return true;
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
      return true;
    }

    if (req.method === 'GET' && urlPath === '/window-position') {
      const saved = loadWindowPosition();
      let current = null;
      const win = getWin();
      if (win) {
        const [cx, cy] = win.getPosition();
        current = { x: cx, y: cy };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ saved, current }));
      return true;
    }

    // GET /window-scale — get current window scale
    if (req.method === 'GET' && urlPath === '/window-scale') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ scale: getWindowScale(), min: MIN_SCALE, max: MAX_SCALE }));
      return true;
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
      return true;
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
      return true;
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
      return true;
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
          const win = getWin();
          try { win?.webContents?.send('character-position-updated', cfg.characterPosition); } catch {}
          try { win?.webContents?.send('character-size-updated', cfg.characterSize); } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (_) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return true;
    }

    const path = require('path');
    const fs = require('fs');

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
      return true;
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
      return true;
    }

    return false;
  };
};
