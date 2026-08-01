'use strict';

/**
 * Native Agent Channels — 消息平台适配器
 *
 * 支持的 channel:
 *   - feishu (飞书) — 通过 Open API 发送消息
 *   - desktop (本地) — 通过 Cloe Desktop chat 窗口
 *
 * Channel 接口:
 *   send(message) — 发送消息到 channel
 *   onMessage(cb) — 监听 incoming 消息
 *
 * 每条 incoming 消息触发 agent.run()，
 * agent 的回复通过 channel.send() 发回去。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const config = require('./config');
const { AgentSession } = require('./agent');

// ── Channel Registry ──

const channels = new Map();
const sessions = new Map(); // channel:sessionId → AgentSession

/**
 * Register a channel adapter.
 */
function registerChannel(name, adapter) {
  channels.set(name, adapter);
  console.log(`[NativeAgent] Channel "${name}" registered`);
}

/**
 * Send a message from the agent to a channel.
 */
function sendMessage(channelName, target, text) {
  const ch = channels.get(channelName);
  if (!ch) { console.warn(`[NativeAgent] Unknown channel: ${channelName}`); return; }
  return ch.send(target, text);
}

/**
 * Handle an incoming message from any channel.
 * Creates/reuses an AgentSession and runs the agent loop.
 */
async function handleMessage(channelName, target, text, callbacks = {}) {
  const sessionKey = `${channelName}:${target}`;
  
  let session = sessions.get(sessionKey);
  if (!session) {
    session = new AgentSession(sessionKey);
    sessions.set(sessionKey, session);
  }
  
  // If session is already running, queue the message (simple approach: just add to messages)
  if (session.isRunning) {
    session.addUserMessage(text);
    return;
  }
  
  session.addUserMessage(text);
  
  const defaultCallbacks = {
    onDelta: (chunk) => {
      // Stream delta — for desktop channel, forwarded via IPC
      callbacks.onDelta?.(chunk);
    },
    onTool: (toolInfo) => {
      callbacks.onTool?.(toolInfo);
    },
    onError: (err) => {
      console.error(`[NativeAgent] Error in session ${sessionKey}:`, err);
      sendMessage(channelName, target, `⚠️ ${err}`);
      callbacks.onError?.(err);
    },
    onEnd: (fullText, toolCalls) => {
      if (fullText) {
        sendMessage(channelName, target, fullText);
      }
      callbacks.onEnd?.(fullText, toolCalls);
    },
  };
  
  await session.run(defaultCallbacks);
}

/**
 * Reset a session for a channel+target.
 */
function resetSession(channelName, target) {
  const sessionKey = `${channelName}:${target}`;
  const session = sessions.get(sessionKey);
  if (session) {
    session.reset();
  } else {
    sessions.set(sessionKey, new AgentSession(sessionKey));
  }
}

/**
 * Get a session by channel+target.
 */
function getSession(channelName, target) {
  return sessions.get(`${channelName}:${target}`);
}

// ── Feishu Channel ──

const FEISHU_TOKEN_CACHE = { token: null, expires: 0 };

function getFeishuConfig() {
  // Read from ~/.cloe/native-agent.json or fact_store
  const nativeConfig = config.loadConfig();
  return nativeConfig.feishu || {};
}

function getFeishuTenantToken() {
  if (FEISHU_TOKEN_CACHE.token && Date.now() < FEISHU_TOKEN_CACHE.expires) {
    return Promise.resolve(FEISHU_TOKEN_CACHE.token);
  }
  
  const fc = getFeishuConfig();
  if (!fc.appId || !fc.appSecret) {
    return Promise.reject(new Error('Feishu appId/appSecret not configured'));
  }
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ app_id: fc.appId, app_secret: fc.appSecret });
    const req = https.request(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.tenant_access_token) {
              FEISHU_TOKEN_CACHE.token = parsed.tenant_access_token;
              FEISHU_TOKEN_CACHE.expires = Date.now() + (parsed.expire - 300) * 1000;
              resolve(parsed.tenant_access_token);
            } else {
              reject(new Error('Failed to get Feishu token'));
            }
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendFeishuMessage(chatId, text) {
  const token = await getFeishuTenantToken();
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    });
    
    const req = https.request(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Register Feishu channel (lazy — only activates if configured)
registerChannel('feishu', {
  async send(target, text) {
    try {
      await sendFeishuMessage(target, text);
    } catch (e) {
      console.error('[NativeAgent] Feishu send failed:', e.message);
    }
  },
});

// ── Desktop Channel ──
// The desktop channel is handled by IPC in native-proxy.js,
// which calls handleMessage('desktop', sessionId, text, callbacks) directly.
// No explicit registration needed — callbacks are passed inline.

module.exports = {
  registerChannel,
  sendMessage,
  handleMessage,
  resetSession,
  getSession,
  AgentSession,
};
