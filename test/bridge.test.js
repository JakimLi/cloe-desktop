#!/usr/bin/env node
/**
 * Cloe Desktop — Bridge API Tests
 * 
 * Tests the embedded WebSocket+HTTP bridge without needing Electron.
 * Just requires Node.js + ws module.
 * 
 * Usage: node test/bridge.test.js
 */

const http = require('http');
const { WebSocket } = require('ws');
const assert = require('assert');

const WS_PORT = 19850;
const HTTP_PORT = 19851;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

let passed = 0;
let failed = 0;

function log(name, ok, detail) {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function json(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : null; }
        catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function wsConnect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function wsMessage(ws, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    ws.once('message', (data) => { clearTimeout(timer); resolve(JSON.parse(data)); });
  });
}

async function run() {
  console.log('\n🧪 Cloe Desktop — Bridge API Tests\n');

  // ─── Pre-flight ───
  console.log('── Pre-flight ──');
  try {
    const status = await json('GET', '/status');
    log('Bridge is running', status.status === 200, `status ${status.status}`);
    log('Status has correct ports', 
      status.body.ws_port === WS_PORT && status.body.http_port === HTTP_PORT,
      JSON.stringify(status.body));
    console.log(`  ℹ️  Connected clients before tests: ${status.body.clients}`);
  } catch (e) {
    log('Bridge is running', false, e.message);
    console.log('\n  ⚠️  Start the app first: npm run dev  OR  open Cloe.app');
    process.exit(1);
  }

  // ─── HTTP API ───
  console.log('\n── HTTP API ──');
  
  const t1 = await json('GET', '/status');
  log('GET /status returns 200', t1.status === 200, `got ${t1.status}`);
  log('/status includes clients count', typeof t1.body.clients === 'number');

  const t2 = await json('POST', '/action', { action: 'smile' });
  log('POST /action returns 200', t2.status === 200, `got ${t2.status}`);
  log('/action echoes action back', t2.body.action?.action === 'smile', JSON.stringify(t2.body.action));
  log('/action reports sent_to count', typeof t2.body.sent_to === 'number');

  const t3 = await json('POST', '/action', { action: 'nod' });
  log('Multiple actions work', t3.body.action?.action === 'nod');

  const t4 = await json('POST', '/action', { action: 'speak', audio: 'doing' });
  log('Speak action with audio param', t4.body.action?.audio === 'doing', JSON.stringify(t4.body.action));

  const t5 = await json('GET', '/nonexistent');
  log('Unknown route returns 404', t5.status === 404, `got ${t5.status}`);

  // Test empty body (raw HTTP, no JSON)
  const t6 = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: HTTP_PORT, path: '/action',
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    req.end(); // no body
  });
  log('Empty body returns 400', t6.status === 400, `got ${t6.status}`);

  const t7 = await json('OPTIONS', '/action');
  log('CORS preflight returns 204', t7.status === 204, `got ${t7.status}`);

  // ─── WebSocket ───
  console.log('\n── WebSocket ──');

  try {
    const ws = await wsConnect();
    log('WS connection accepted', true);

    // Wait a bit for server to register the client
    await new Promise((r) => setTimeout(r, 500));
    const afterConnect = await json('GET', '/status');
    log('Client count increased after WS connect', afterConnect.body.clients > t1.body.clients,
      `${t1.body.clients} → ${afterConnect.body.clients}`);

    ws.close();
    await new Promise((r) => setTimeout(r, 500));
    const afterClose = await json('GET', '/status');
    log('Client count decreased after WS close', afterClose.body.clients < afterConnect.body.clients,
      `${afterConnect.body.clients} → ${afterClose.body.clients}`);

    // Test message forwarding: set up listener FIRST, then send action
    const ws2 = await wsConnect();
    await new Promise((r) => setTimeout(r, 300));
    const msgPromise = wsMessage(ws2);
    await json('POST', '/action', { action: 'wave' });
    const msg = await msgPromise;
    log('WS receives forwarded action from HTTP', msg.action === 'wave', `got ${msg.action}`);
    ws2.close();

  } catch (e) {
    log('WS test', false, e.message);
  }

  // ─── All supported actions ───
  console.log('\n── All Actions Coverage ──');
  const actions = ['smile', 'kiss', 'nod', 'wave', 'think', 'tease', 'shake_head', 'speak', 'blink'];
  for (const action of actions) {
    const r = await json('POST', '/action', { action });
    log(action, r.status === 200 && r.body.sent_to >= 0);
  }

  // ─── Summary ───
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  ✅ ${passed} passed   ❌ ${failed} failed   ${passed + failed} total`);
  console.log(`${'─'.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
