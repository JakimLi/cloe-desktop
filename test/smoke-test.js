#!/usr/bin/env node
/**
 * Cloe Desktop — Smoke Test (Screenshot Regression)
 * 
 * Starts the installed Cloe.app (or dev mode), sends each action,
 * takes screenshots, sends them to Feishu for visual verification.
 * 
 * Usage:
 *   node test/smoke-test.js              # test installed /Applications/Cloe.app
 *   node test/smoke-test.js --dev         # test dev mode (vite + electron)
 * 
 * Prerequisites:
 *   - Cloe.app installed (or dev mode running)
 *   - ~/.hermes/.env with FEISHU_APP_ID and FEISHU_APP_SECRET
 */

const { execSync, exec } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HTTP_PORT = 19851;
const ACTIONS = ['blink', 'smile', 'kiss', 'nod', 'wave', 'think', 'tease', 'shake_head', 'speak'];
const CROP = { x: 1040, y: 360, w: 380, h: 520 };
const FEISHU_CHAT = 'oc_e8eba4ee240f506188d642f09ebae0b5';

const useDev = process.argv.includes('--dev');
const label = useDev ? 'Dev Server' : 'Installed App';

// ─── Helpers ───
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function postAction(action) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action });
    const req = http.request({
      hostname: '127.0.0.1', port: HTTP_PORT, path: '/action',
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function screenshot(filepath) {
  const { x, y, w, h } = CROP;
  execSync(`screencapture -R ${x},${y},${w},${h} -x ${filepath}`, { timeout: 10000 });
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim();
}

async function getFeishuToken() {
  const envPath = path.join(os.homedir(), '.hermes', '.env');
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [k, ...v] = trimmed.split('=');
      env[k] = v.join('=');
    }
  }
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env['FEISHU_APP_ID'], app_secret: env['FEISHU_APP_SECRET'] }),
  });
  return (await resp.json()).tenant_access_token;
}

async function sendToFeishu(token, text, imagePath) {
  // Send text message
  await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ receive_id: FEISHU_CHAT, msg_type: 'text', content: JSON.stringify({ text }) }),
  });

  if (!imagePath) return;

  // Upload image
  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([fs.readFileSync(imagePath)]), path.basename(imagePath));

  const uploadResp = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const imageKey = (await uploadResp.json()).data.image_key;

  // Send text + image
  for (const payload of [
    { msg_type: 'text', content: JSON.stringify({ text }) },
    { msg_type: 'image', content: JSON.stringify({ image_key: imageKey }) },
  ]) {
    await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ receive_id: FEISHU_CHAT, ...payload }),
    });
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Find window position ───
function findWindowRect() {
  try {
    const result = sh(`osascript -e 'tell application "System Events" to get {position, size} of window 1 of process "${useDev ? 'Electron' : 'Cloe'}"'`);
    const [x, y, w, h] = result.split(',').map(Number);
    return { x, y, w, h };
  } catch {
    return null;
  }
}

// ─── Main ───
async function main() {
  console.log(`\n🧪 Cloe Desktop — Smoke Test (${label})\n`);

  // Wait for bridge
  console.log('Waiting for bridge...');
  for (let i = 0; i < 15; i++) {
    try {
      const status = await get(`http://127.0.0.1:${HTTP_PORT}/status`);
      if (status.clients >= 1) { console.log(`  ✅ Bridge ready (${status.clients} client)`); break; }
    } catch {}
    if (i === 14) { console.log('  ❌ Bridge not ready after 15s'); process.exit(1); }
    await sleep(1000);
  }

  // Find window position
  console.log('Finding window...');
  const rect = findWindowRect();
  if (!rect) {
    console.log('  ❌ Could not find Cloe/Electron window');
    process.exit(1);
  }
  console.log(`  ✅ Window at (${rect.x}, ${rect.y}) ${rect.w}x${rect.h}`);
  Object.assign(CROP, rect);

  // Get Feishu token
  console.log('Getting Feishu token...');
  const token = await getFeishuToken();
  console.log('  ✅ Token obtained');

  // Send intro message
  await sendToFeishu(token, `🧪 Smoke Test — ${label}\n${new Date().toLocaleString('zh-CN')}`, null);

  // Test each action
  const tmpDir = os.tmpdir();
  console.log('\nTesting actions:');
  for (let i = 0; i < ACTIONS.length; i++) {
    const action = ACTIONS[i];
    process.stdout.write(`  ${i + 1}/${ACTIONS.length} ${action}... `);

    const result = await postAction(action);
    await sleep(1500);

    const fp = path.join(tmpDir, `cloe_smoke_${action}.png`);
    screenshot(fp);

    await sendToFeishu(token, `▶ ${i + 1}/${ACTIONS.length} ${action} (sent_to: ${result.sent_to})`, fp);
    console.log(`✅ sent_to:${result.sent_to}`);
    await sleep(500);
  }

  // Final status check
  const finalStatus = await get(`http://127.0.0.1:${HTTP_PORT}/status`);
  await sendToFeishu(token, `✅ Smoke test complete — ${ACTIONS.length}/${ACTIONS.length} actions OK`, null);
  console.log(`\n  ✅ All ${ACTIONS.length} actions tested. Screenshots sent to Feishu.\n`);
}

main().catch((e) => {
  console.error('Smoke test failed:', e);
  process.exit(1);
});
