'use strict';

/**
 * HTTP utils — shared helpers for the bridge HTTP route modules.
 *
 * Each route module historically inlined its own body-parsing and JSON
 * response code inside createBridgeServers. Centralising the two helpers
 * here keeps the route modules short and identical in behaviour.
 */

/** Accumulate the request body, JSON-parse it, invoke callback(err, data). */
function readJsonBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      callback(null, JSON.parse(body));
    } catch (e) {
      callback(e);
    }
  });
}

/** Write a JSON response with the given status code. */
function jsonRes(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

module.exports = { readJsonBody, jsonRes };
