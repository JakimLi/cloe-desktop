'use strict';

/**
 * Canvas HTTP routes — element CRUD, mode, overlay show/hide.
 *
 * Extracted verbatim from createBridgeServers. State lives in canvas-store
 * (canvasElements array + currentCanvasMode); this module only mutates it via
 * the store's accessors and broadcasts. show/hide drive the main window via
 * executeJavaScript, hence getWin in ctx.
 */

const { readJsonBody, jsonRes } = require('./http-utils');
const canvasStore = require('./canvas-store');
const { canvasElements, broadcastCanvasUpdate, broadcastCanvasModeChange } = canvasStore;

module.exports = function register(ctx) {
  const { getWin } = ctx;

  return function canvasRoutes(req, res, urlPath) {
    // GET /canvas/elements — return all elements
    if (req.method === 'GET' && urlPath === '/canvas/elements') {
      jsonRes(res, 200, { elements: canvasElements });
      return true;
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
      return true;
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
      return true;
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
      return true;
    }

    // DELETE /canvas — clear all elements
    if (req.method === 'DELETE' && urlPath === '/canvas') {
      canvasElements.length = 0;
      broadcastCanvasUpdate();
      jsonRes(res, 200, { ok: true, total: 0 });
      return true;
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
      return true;
    }

    // GET /canvas/mode — get current canvas mode
    if (req.method === 'GET' && urlPath === '/canvas/mode') {
      jsonRes(res, 200, { mode: canvasStore.getCurrentCanvasMode() || 'free' });
      return true;
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
        canvasStore.setCurrentCanvasMode(name === 'free' ? null : name);
        broadcastCanvasModeChange(canvasStore.getCurrentCanvasMode() || 'free');
        jsonRes(res, 200, { ok: true, mode: canvasStore.getCurrentCanvasMode() || 'free' });
      });
      return true;
    }

    // POST /canvas/mode/reset — reset canvas mode to free
    if (req.method === 'POST' && urlPath === '/canvas/mode/reset') {
      canvasStore.setCurrentCanvasMode(null);
      broadcastCanvasModeChange('free');
      jsonRes(res, 200, { ok: true, mode: 'free' });
      return true;
    }

    // POST /canvas/show — show overlay in canvas mode (trigger React to mount Excalidraw)
    // POST /canvas/show — show overlay in terminal mode
    // POST /canvas/hide — hide overlay
    if (req.method === 'POST' && urlPath === '/canvas/show') {
      readJsonBody(req, (err, data) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const win = getWin();
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
      return true;
    }

    if (req.method === 'POST' && urlPath === '/canvas/hide') {
      const win = getWin();
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
      return true;
    }

    return false;
  };
};
