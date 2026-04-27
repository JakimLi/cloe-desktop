#!/usr/bin/env node
/**
 * Cloe Desktop WebSocket Bridge (Node.js version)
 * 
 * WebSocket server on :19850 (Electron client connects)
 * HTTP server on :19851 (external triggers via curl/AI agent)
 * 
 * No Python dependency required.
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const WS_PORT = 19850;
const HTTP_PORT = 19851;

const clients = new Set();

// ─── WebSocket Server ──────────────────────────────────
const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[WS] Received: ${JSON.stringify(msg)}`);
    } catch (e) {
      console.error(`[WS] Parse error: ${e.message}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error: ${err.message}`);
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (${clients.size} total)`);
  });
});

console.log(`WebSocket server: ws://127.0.0.1:${WS_PORT}`);

// ─── HTTP Server ───────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ws_port: WS_PORT,
      http_port: HTTP_PORT,
      clients: clients.size,
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/action') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const msg = JSON.stringify(data);

        let sent = 0;
        const dead = [];
        for (const ws of clients) {
          if (ws.readyState === 1) { // OPEN
            ws.send(msg);
            sent++;
          } else {
            dead.push(ws);
          }
        }
        dead.forEach(ws => clients.delete(ws));

        console.log(`[HTTP] action=${data.action} → ${sent} client(s)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sent_to: sent, action: data }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`HTTP API: http://127.0.0.1:${HTTP_PORT}`);
  console.log(`Trigger: curl -s http://localhost:${HTTP_PORT}/action -d '{"action":"smile"}'`);
  console.log('Waiting for clients...');
});

// ─── Graceful shutdown ─────────────────────────────────
function shutdown() {
  console.log('\nShutting down...');
  for (const ws of clients) {
    ws.close();
  }
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
