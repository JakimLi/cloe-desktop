'use strict';

/**
 * Chat / screenshot / mute HTTP routes — chat message injection, window
 * screenshots, chat-toggle, engine route delegation, and global mute/pause.
 *
 * Extracted from createBridgeServers. These routes were scattered across two
 * regions (context-usage early, the rest at the tail); both move here.
 *
 * Latent-bug fixes applied during extraction (these paths used to throw
 * ReferenceError because the identifiers were never defined in scope):
 *   - `chatWin` → looked up dynamically via BrowserWindow.getAllWindows()
 *     .find(w => url includes '/chat.html'). Previously `chatWin` was always
 *     undefined, so /chat-screenshot returned "No window" and the chat.html
 *     IPC branch in /chat/message never fired.
 *   - `parsedUrl.query.bg` → `new URL(req.url, ...).searchParams.get('bg')`.
 *     Previously `parsedUrl` was undefined, so /screenshot?bg=1 threw.
 */

const { BrowserWindow } = require('electron');
const { readJsonBody, jsonRes } = require('./http-utils');

function findChatWindow() {
  return BrowserWindow.getAllWindows().find(w =>
    !w.isDestroyed() && w.webContents?.getURL()?.includes('/chat.html')
  );
}

module.exports = function register(ctx) {
  const {
    getWin,
    broadcastToClients,
    toggleChatWindow,
    reminderEngine, agentTracker, ttsScheduler, weatherEngine, taskEngine,
    muteState,
  } = ctx;

  return function chatRoutes(req, res, urlPath) {
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
      return true;
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
        const win = getWin();
        try { win?.webContents?.send('external-chat-message', msg); } catch {}
        try { findChatWindow()?.webContents?.send('external-chat-message', msg); } catch {}
        jsonRes(res, 200, { ok: true });
      });
      return true;
    }

    // GET /screenshot — capture window content as PNG (for debugging)
    //    /screenshot?bg=1 — temporarily add opaque background for better capture of transparent windows
    if (req.method === 'GET' && (urlPath === '/screenshot' || urlPath === '/chat-screenshot')) {
      const targetWin = urlPath === '/chat-screenshot' ? findChatWindow() : getWin();
      if (!targetWin || targetWin.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }

      const wantBg = new URL(req.url, 'http://localhost').searchParams.get('bg');
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
      return true;
    }

    // GET /dom-screenshot — take a screenshot via renderer-side Canvas (fallback for transparent windows)
    if (req.method === 'GET' && urlPath === '/dom-screenshot') {
      const targetWin = getWin();
      if (!targetWin || targetWin.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
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
      return true;
    }

    if (req.method === 'POST' && urlPath === '/chat-toggle') {
      toggleChatWindow();
      jsonRes(res, 200, { ok: true });
      return true;
    }

    // --- Reminder Engine Routes ---
    if (reminderEngine.handleReminderRoute(req, res)) {
      return true;
    }

    // --- Agent Session Tracker Routes ---
    if (agentTracker.handleAgentRoute(req, res)) {
      return true;
    }

    // --- TTS Scheduler Routes ---
    if (ttsScheduler.handleTTSRoute(req, res)) {
      return true;
    }

    // --- Weather Routes ---
    if (weatherEngine.handleWeatherRoute(req, res)) {
      return true;
    }

    // --- Task Engine Routes ---
    if (taskEngine.handleTaskRoute(req, res)) {
      return true;
    }

    // --- Global Mute Toggle ---
    if (req.method === 'POST' && urlPath === '/toggle-mute') {
      const muted = muteState.toggleMute();
      broadcastToClients({ type: 'mute-state-changed', muted });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ muted }));
      return true;
    }

    // --- Global Mute State ---
    if (req.method === 'GET' && urlPath === '/mute-state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ muted: muteState.isMuted() }));
      return true;
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
      return true;
    }

    // --- Global Pause State ---
    if (req.method === 'GET' && urlPath === '/global-pause-state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ paused: muteState.isGlobalPaused() }));
      return true;
    }

    return false;
  };
};
