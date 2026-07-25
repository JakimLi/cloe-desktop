'use strict';

/**
 * Excalidraw HTTP routes — direct bridge to the renderer's Excalidraw.
 *
 * These endpoints bypass the old IPC canvas mechanism and directly
 * call window.cloeExcalidraw in the renderer via executeJavaScript.
 *
 * Extracted verbatim from createBridgeServers. Exports a single dispatcher
 * `register(ctx)` that returns a `(req, res, urlPath) => boolean` handler;
 * the bridge calls it and stops on a hit (true).
 *
 * Dependencies injected via ctx:
 *   - getWin()       (main window getter)
 */

const { readJsonBody, jsonRes } = require('./http-utils');

module.exports = function register(ctx) {
  const { getWin } = ctx;

  return function excalidrawRoutes(req, res, urlPath) {
    // POST /canvas/excalidraw/draw — add/update elements on Excalidraw canvas
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/draw') {
      const win = getWin();
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
      return true;
    }

    // GET /canvas/excalidraw/scene — read current Excalidraw scene
    if (req.method === 'GET' && urlPath === '/canvas/excalidraw/scene') {
      const win = getWin();
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
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
      return true;
    }

    // DELETE /canvas/excalidraw/scene — clear Excalidraw canvas
    if (req.method === 'DELETE' && urlPath === '/canvas/excalidraw/scene') {
      const win = getWin();
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
      win.webContents.executeJavaScript(`
        if (window.cloeExcalidraw) window.cloeExcalidraw.resetScene();
        'ok';
      `, true).then(() => {
        jsonRes(res, 200, { ok: true });
      }).catch(err => {
        jsonRes(res, 500, { error: err.message });
      });
      return true;
    }

    // ── Canvas attention-guiding endpoints ──

    // POST /canvas/excalidraw/zoom — zoom to specific level
    //   body: { "level": 2 }  (1 = 100%, 2 = 200%)
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/zoom') {
      const win = getWin();
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
      readJsonBody(req, (err, body) => {
        if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
        const level = Number(body.level) || 1;
        win.webContents.executeJavaScript(`
          if (window.cloeExcalidraw) window.cloeExcalidraw.zoomTo(${level});
          'ok';
        `, true).then(() => jsonRes(res, 200, { ok: true, level }))
          .catch(err => jsonRes(res, 500, { error: err.message }));
      });
      return true;
    }

    // POST /canvas/excalidraw/pan — pan canvas so (x,y) is centered
    //   body: { "x": 200, "y": 300 }
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/pan') {
      const win = getWin();
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
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
      return true;
    }

    // POST /canvas/excalidraw/select — select/highlight elements
    //   body: { "ids": ["el1", "el2"] }
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/select') {
      const win = getWin();
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
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
      return true;
    }

    // POST /canvas/excalidraw/deselect — clear selection
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/deselect') {
      const win = getWin();
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
      win.webContents.executeJavaScript(`
        if (window.cloeExcalidraw) window.cloeExcalidraw.deselectAll();
        'ok';
      `, true).then(() => jsonRes(res, 200, { ok: true }))
        .catch(err => jsonRes(res, 500, { error: err.message }));
      return true;
    }

    // POST /canvas/excalidraw/focus — zoom + pan to center on specific elements
    //   body: { "ids": ["el1", "el2"] }
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/focus') {
      const win = getWin();
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
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
      return true;
    }

    // DELETE /canvas/excalidraw/elements — delete specific elements by id
    //   body: { "ids": ["el1", "el2"] }
    if (req.method === 'DELETE' && urlPath === '/canvas/excalidraw/elements') {
      const win = getWin();
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
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
      return true;
    }

    // POST /canvas/excalidraw/files — register binary files for image elements
    //   body: { "files": { "fileId1": { "mimeType": "image/jpeg", "data": "<base64>" } } }
    if (req.method === 'POST' && urlPath === '/canvas/excalidraw/files') {
      const win = getWin();
      if (!win || win.isDestroyed()) { jsonRes(res, 503, { error: 'No window' }); return true; }
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
      return true;
    }

    return false;
  };
};
