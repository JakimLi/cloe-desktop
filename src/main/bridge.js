'use strict';

/**
 * Bridge — owner of the WebSocket client set and the generic broadcast helper.
 *
 * `bridgeClients` was previously a module-level Set in launcher.js touched by
 * the WS server, the HTTP status route, the shutdown path, and every engine/
 * generation routine that needed to push a message. Centralising it here lets
 * split-off modules broadcast without receiving the Set as a parameter.
 *
 * Note: business-specific broadcasters (e.g. broadcastSetConfig, which needs
 * the action-sets data layer) stay with their owning module and call
 * `bridge.broadcast(rawData)` under the hood.
 */

const bridgeClients = new Set();

/** Underlying client set — exposed for the WS server / status route. */
function getClients() {
  return bridgeClients;
}

/** Number of currently connected WS clients. */
function getClientCount() {
  return bridgeClients.size;
}

/**
 * Send a JSON message to every live client. Dead sockets are reaped.
 * @param {*} data - any JSON-serialisable payload
 * @returns {number} number of clients the message was sent to
 */
function broadcast(data) {
  const msg = JSON.stringify(data);
  const dead = [];
  let sent = 0;
  for (const ws of bridgeClients) {
    if (ws.readyState === 1) { ws.send(msg); sent++; }
    else dead.push(ws);
  }
  dead.forEach((ws) => bridgeClients.delete(ws));
  return sent;
}

module.exports = {
  getClients,
  getClientCount,
  broadcast,
};
