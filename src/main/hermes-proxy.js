'use strict';

/**
 * Hermes API Proxy — relays chat completions from the renderer to the local
 * Hermes gateway, avoiding browser CORS restrictions.
 *
 * Extracted verbatim from launcher.js. Self-contained: the only external
 * touchpoints are config (loadConfig) and cloeSessions, both already
 * independent modules. The `chatReqs` Map is private to this module.
 *
 * Stream events are routed back through the IPC `event.sender` (the renderer
 * that issued the request), not through a window handle — so this module does
 * not depend on window-registry at all.
 *
 * Loading this module registers five ipcMain handlers:
 *   hermes-check-health, hermes-chat-models, hermes-switch-model,
 *   hermes-chat-stop, hermes-chat-send
 */

const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { ipcMain } = require('electron');

const { loadConfig } = require('./config');
const cloeSessions = require('../../cloe-sessions');

function getHermesApiConfig() {
  const cfg = loadConfig();
  const api = cfg.hermesApi || {};
  return {
    host: api.host || '127.0.0.1',
    port: api.port || 8642,
    key: api.key || '',
  };
}

ipcMain.handle('hermes-check-health', async () => {
  const { host, port } = getHermesApiConfig();
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: host, port, path: '/health', method: 'GET', timeout: 5000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ connected: true, model: data.model || null });
          } catch {
            resolve({ connected: true });
          }
        });
      },
    );
    req.on('error', () => resolve({ connected: false }));
    req.on('timeout', () => { req.destroy(); resolve({ connected: false }); });
    req.end();
  });
});

ipcMain.handle('hermes-chat-models', async () => {
  // Read LLM models from Hermes config + provider API (not from Hermes /v1/models
  // which only returns the agent name "hermes-agent")
  const hermesConfigPath = path.join(os.homedir(), '.hermes', 'config.yaml');
  try {
    const yamlContent = fs.readFileSync(hermesConfigPath, 'utf-8');
    // Simple YAML parsing for model config
    let currentModel = '';
    let base_url = '';
    let api_key = '';
    const lines = yamlContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^default:\s*(.+)/.test(trimmed) && !base_url) currentModel = trimmed.replace(/^default:\s*/, '');
      if (/^base_url:\s*(.+)/.test(trimmed) && !base_url) base_url = trimmed.replace(/^base_url:\s*/, '');
      if (/^api_key:\s*(.+)/.test(trimmed) && !api_key) api_key = trimmed.replace(/^api_key:\s*/, '');
    }
    // Query provider's /models endpoint to get available LLM models
    if (base_url) {
      const modelsUrl = base_url.replace(/\/+$/, '') + '/models';
      return new Promise((resolve) => {
        const headers = { 'Content-Type': 'application/json' };
        if (api_key) headers['Authorization'] = `Bearer ${api_key}`;
        const parsed = new URL(modelsUrl);
        const req = https.request(
          { hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname, method: 'GET', headers, timeout: 5000 },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              try {
                const data = JSON.parse(body);
                let models = (data.data || []).map((m) => m.id);
                // Ensure the current model is always in the list (provider /models may lag behind)
                if (currentModel && !models.includes(currentModel)) {
                  models.unshift(currentModel);
                }
                // Return models with current model info
                resolve({ models, current: currentModel });
              } catch {
                resolve({ models: [currentModel], current: currentModel });
              }
            });
          },
        );
        req.on('error', () => resolve({ models: [currentModel], current: currentModel }));
        req.on('timeout', () => { req.destroy(); resolve({ models: [currentModel], current: currentModel }); });
        req.end();
      });
    }
    return { models: [currentModel], current: currentModel };
  } catch {
    return { models: [], current: '' };
  }
});

ipcMain.handle('hermes-switch-model', async (_event, newModel) => {
  // Update Hermes config.yaml model.default and restart gateway
  const hermesConfigPath = path.join(os.homedir(), '.hermes', 'config.yaml');
  try {
    let content = fs.readFileSync(hermesConfigPath, 'utf-8');
    // Replace model.default value
    content = content.replace(/^(model:\s*\n\s*default:\s*).*/m, `$1${newModel}`);
    fs.writeFileSync(hermesConfigPath, content, 'utf-8');
    // Restart gateway via launchd (kill triggers KeepAlive auto-restart)
    const pidFile = path.join(os.homedir(), '.hermes', 'gateway.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pidInfo = JSON.parse(fs.readFileSync(pidFile, 'utf-8'));
        if (pidInfo.pid) process.kill(pidInfo.pid, 'SIGTERM');
      } catch {}
    }
    return { success: true, model: newModel };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Track active chat requests by reqId — supports unlimited concurrent requests
const chatReqs = new Map(); // reqId -> { req, sender, cloeSessionId, accumulatedContent, accumulatedTools }

ipcMain.on('hermes-chat-stop', (event, reqId) => {
  if (!reqId) return;
  const entry = chatReqs.get(reqId);
  if (entry) {
    try { entry.req.destroy(); } catch {}
    chatReqs.delete(reqId);
  }
});

ipcMain.on('hermes-chat-send', (event, payload) => {
  const { message, sessionId, model, reqId, cloeSessionId } = payload || {};
  const { host, port, key } = getHermesApiConfig();
  console.log(`[CHAT] send reqId=${reqId}, session=${sessionId}, cloeSession=${cloeSessionId}, activeReqs=${chatReqs.size}`);

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  // Use the cloe session's hermesSessionId if available, else generate one
  let effectiveSessionId = sessionId;
  if (!effectiveSessionId && cloeSessionId) {
    const cloeSession = cloeSessions.getSession(cloeSessionId);
    effectiveSessionId = cloeSession?.hermesSessionId || null;
  }
  if (!effectiveSessionId) {
    effectiveSessionId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  headers['X-Hermes-Session-Id'] = effectiveSessionId;

  // Mark cloe session as working
  if (cloeSessionId) {
    cloeSessions.updateSession(cloeSessionId, { status: 'working' });
  }

  // Every stream event carries reqId so the renderer can route precisely.
  const sendTo = (ch, data) => {
    try { event.sender.send(ch, { ...data, reqId }); } catch {}
  };

  // Accumulate content for persistence on stream end.
  // Track an ordered `parts` list so tool calls and text survive in the exact
  // order they arrived (matches what the renderer streams live). `text` and
  // `tools` are kept as flat mirrors for backward-compat / debugging.
  const accumulatedContent = { text: '', tools: [], parts: [] };

  const req = http.request(
    {
      hostname: host,
      port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers,
    },
    (res) => {
      let ended = false;

      // Non-200: read body, send error to renderer
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (!ended) {
            ended = true;
            try {
              let errMsg = `HTTP ${res.statusCode}`;
              if (body) {
                try {
                  const parsed = JSON.parse(body);
                  errMsg = parsed.error?.message || parsed.error || parsed.detail || parsed.message || body.slice(0, 500);
                } catch {
                  errMsg = body.slice(0, 500);
                }
              }
              sendTo('hermes-stream-error', { error: errMsg });
            } catch {}
          }
        });
        return;
      }

      // Relay session ID from response header
      const newSessionId = res.headers['x-hermes-session-id'];
      console.log(`[CHAT] response started reqId=${reqId}, session=${effectiveSessionId}, respSession=${newSessionId}`);
      if (newSessionId) {
        // Persist the hermes session ID for future requests
        if (cloeSessionId) {
          cloeSessions.updateSession(cloeSessionId, { hermesSessionId: newSessionId });
        }
        try { sendTo('hermes-stream-delta', { sessionId: newSessionId }); } catch {}
      }

      let buffer = '';
      let currentEvent = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { currentEvent = ''; continue; }
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }
          if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (currentEvent === 'hermes.tool.progress') {
                if (parsed.tool || parsed.emoji || parsed.label) {
                  accumulatedContent.tools.push({ tool: parsed.tool, emoji: parsed.emoji, label: parsed.label });
                  accumulatedContent.parts.push({ type: 'tool', tool: parsed.tool, emoji: parsed.emoji, label: parsed.label });
                }
                try { sendTo('hermes-stream-tool', parsed); } catch {}
              } else if (currentEvent === 'hermes.error') {
                // Backend error during streaming (e.g. model failure, rate limit)
                const errMsg = parsed.error || parsed.message || JSON.stringify(parsed);
                try { sendTo('hermes-stream-error', { error: errMsg }); } catch {}
              } else {
                // Standard chat.completion.chunk
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  accumulatedContent.text += content;
                  const parts = accumulatedContent.parts;
                  const last = parts[parts.length - 1];
                  if (last && last.type === 'text') last.text += content;
                  else parts.push({ type: 'text', text: content });
                  try { sendTo('hermes-stream-delta', { content }); } catch {}
                }
              }
            } catch { /* ignore malformed JSON lines */ }
          }
        }
      });

      res.on('end', () => {
        if (!ended) {
          ended = true;
          console.log(`[CHAT] stream ended reqId=${reqId}`);
          chatReqs.delete(reqId);

          // Persist messages + update status for the cloe session
          if (cloeSessionId && (accumulatedContent.text || accumulatedContent.tools.length > 0)) {
            const session = cloeSessions.getSession(cloeSessionId);
            if (session) {
              const newMessages = [
                ...session.messages,
                { role: 'user', content: message },
                { role: 'assistant', content: accumulatedContent.text, tools: accumulatedContent.tools, parts: accumulatedContent.parts },
              ];
              // Auto-title from first user message
              const titleUpdate = (!session.title || session.title === 'New chat') && message
                ? { title: message.slice(0, 40) + (message.length > 40 ? '…' : '') }
                : {};
              cloeSessions.updateSession(cloeSessionId, {
                ...titleUpdate,
                messages: newMessages,
              });
              // Notify turn-end (triggers TTS + status badge)
              cloeSessions.notifyTurnEnd(cloeSessionId);
            }
          }

          try { sendTo('hermes-stream-end', {}); } catch {}
        }
      });

      res.on('error', (err) => {
        if (!ended) {
          ended = true;
          chatReqs.delete(reqId);
          if (cloeSessionId) cloeSessions.updateSession(cloeSessionId, { status: 'idle' });
          try { sendTo('hermes-stream-error', { error: err.message }); } catch {}
        }
      });
    },
  );

  req.on('error', (err) => {
    chatReqs.delete(reqId);
    if (cloeSessionId) cloeSessions.updateSession(cloeSessionId, { status: 'idle' });
    try { sendTo('hermes-stream-error', { error: err.message }); } catch {}
  });

  const body = JSON.stringify({
    model: model || 'hermes',
    messages: [{ role: 'user', content: message }],
    stream: true,
  });
  req.write(body);
  req.end();
  chatReqs.set(reqId, { req, sender: event.sender, cloeSessionId, accumulatedContent });
});

module.exports = { getHermesApiConfig };
