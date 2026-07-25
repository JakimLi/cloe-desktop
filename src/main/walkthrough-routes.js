'use strict';

/**
 * Walkthrough HTTP route — interactive code walkthrough in the xterm terminal.
 *
 *   POST /terminal/walk   { action: start | stop | next | prev | get-comments }
 *
 * Uses bat for syntax highlighting, renders ANSI directly in xterm.
 * Extracted verbatim from createBridgeServers. Exports a single dispatcher
 * `register(ctx)` that returns a `(req, res, urlPath) => boolean` handler;
 * the bridge calls it and stops on a hit (true).
 *
 * Dependencies injected via ctx:
 *   - getWin()       (main window getter)
 *
 * The local `require('child_process').execFile`, `require('path')`, and
 * `require('fs')` calls inside the route body are preserved verbatim.
 */

const { readJsonBody, jsonRes } = require('./http-utils');

module.exports = function register(ctx) {
  const { getWin } = ctx;

  return function walkthroughRoutes(req, res, urlPath) {
    // POST /terminal/walk — interactive code walkthrough in xterm terminal
    // Uses bat for syntax highlighting, renders ANSI directly in xterm.
    if (req.method === 'POST' && urlPath === '/terminal/walk') {
      const win = getWin();
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
      return true;
    }

    return false;
  };
};
