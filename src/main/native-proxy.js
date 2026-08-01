'use strict';

/**
 * Native Agent Proxy — IPC handlers for Cloe Desktop chat window
 *
 * Mirrors the interface of hermes-proxy.js so the chat UI can transparently
 * switch between Hermes and the native agent.
 *
 * Registers IPC handlers:
 *   native-chat-send      — Send a message, stream response
 *   native-chat-stop      — Abort current request
 *   native-check-health   — Check if native agent is ready
 *   native-get-models     — List available models for current provider
 *   native-switch-model   — Switch model
 *   native-get-config     — Read full config
 *   native-save-config    — Save config
 *
 * Stream events routed via event.sender (same pattern as hermes-proxy):
 *   native-stream-delta   — { content, reqId }
 *   native-stream-tool    — { tool, emoji, label, reqId }
 *   native-stream-error   — { error, reqId }
 *   native-stream-end     — { reqId }
 */

const { ipcMain } = require('electron');
const { AgentSession, preloadPi } = require('../../native-agent/agent');
const channels = require('../../native-agent/channels');
const cron = require('../../native-agent/cron');
const config = require('../../native-agent/config');
const soul = require('../../native-agent/soul');
const memory = require('../../native-agent/memory');

// Active sessions by reqId (mirrors chatReqs in hermes-proxy)
const activeSessions = new Map(); // reqId → { session, abortController, sender }

// Persistent agent sessions by cloeSessionId
const persistentSessions = new Map();

function getOrCreateSession(cloeSessionId) {
  if (!persistentSessions.has(cloeSessionId)) {
    persistentSessions.set(cloeSessionId, new AgentSession(cloeSessionId));
  }
  return persistentSessions.get(cloeSessionId);
}

// ── Health check ──
ipcMain.handle('native-check-health', async () => {
  const cfg = config.loadConfig();
  const provider = config.getProvider();
  return {
    connected: !!(provider.baseURL && provider.apiKey),
    enabled: cfg.enabled,
    provider: cfg.provider,
    model: cfg.model,
  };
});

// ── Get models (reads from saved config, not hardcoded) ──
ipcMain.handle('native-get-models', async () => {
  const cfg = config.loadConfig();
  const providerName = cfg.provider || 'zhipu';
  const provider = cfg.providers?.[providerName] || {};
  return {
    models: provider.models || [],
    current: cfg.model || '',
    provider: providerName,
  };
});

// ── Switch model ──
ipcMain.handle('native-switch-model', async (_event, model) => {
  const cfg = config.loadConfig();
  cfg.model = model;
  config.saveConfig(cfg);
  return { success: true, model };
});

// ── Get config ──
ipcMain.handle('native-get-config', async () => {
  return config.loadConfig();
});

// ── Save config ──
ipcMain.handle('native-save-config', async (_event, cfg) => {
  config.saveConfig(cfg);
  return { success: true };
});

// ── Fetch available models from provider API ──
ipcMain.handle('native-fetch-models', async (_event, { baseURL, apiKey }) => {
  if (!baseURL) return { models: [], error: 'No baseURL' };
  
  return new Promise((resolve) => {
    const url = baseURL.replace(/\/+$/, '') + '/models';
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? require('https') : require('http');
    const headers = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    
    const req = lib.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: 'GET', headers, timeout: 10000 },
      (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const models = (data.data || []).map(m => m.id).filter(Boolean).sort();
            resolve({ models, error: null });
          } catch {
            resolve({ models: [], error: 'Failed to parse response' });
          }
        });
      }
    );
    req.on('error', e => resolve({ models: [], error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ models: [], error: 'Timeout' }); });
    req.end();
  });
});

// ── Send message (main entry) ──
ipcMain.on('native-chat-send', async (event, payload) => {
  const { message, reqId, cloeSessionId } = payload || {};
  
  if (!message || !reqId) return;
  
  const session = getOrCreateSession(cloeSessionId || reqId);
  const abortController = new AbortController();
  
  activeSessions.set(reqId, { session, abortController, sender: event.sender });
  
  const sendTo = (ch, data) => {
    try { event.sender.send(ch, { ...data, reqId }); } catch {}
  };
  
  // Accumulate for persistence (mirrors hermes-proxy pattern)
  let accumulatedText = '';
  const accumulatedTools = [];
  
  session.addUserMessage(message);
  
  // Run the agent loop
  session.run({
    onDelta: (chunk) => {
      accumulatedText += chunk;
      sendTo('native-stream-delta', { content: chunk });
    },
    onTool: (toolInfo) => {
      accumulatedTools.push(toolInfo);
      sendTo('native-stream-tool', toolInfo);
    },
    onError: (err) => {
      sendTo('native-stream-error', { error: err });
    },
    onEnd: (fullText, toolCalls) => {
      activeSessions.delete(reqId);
      sendTo('native-stream-end', {});
      
      // Return accumulated content for persistence
      // (the caller in native-proxy will persist this to cloeSessions)
      if (cloeSessionId) {
        try {
          const cloeSessions = require('../../cloe-sessions');
          const cloeSession = cloeSessions.getSession(cloeSessionId);
          if (cloeSession) {
            const newMessages = [
              ...cloeSession.messages,
              { role: 'user', content: message },
              {
                role: 'assistant',
                content: accumulatedText,
                tools: accumulatedTools,
                parts: [
                  ...accumulatedTools.map(t => ({ type: 'tool', ...t })),
                  ...(accumulatedText ? [{ type: 'text', text: accumulatedText }] : []),
                ],
              },
            ];
            const titleUpdate = (!cloeSession.title || cloeSession.title === 'New chat') && message
              ? { title: message.slice(0, 40) + (message.length > 40 ? '…' : '') }
              : {};
            cloeSessions.updateSession(cloeSessionId, {
              ...titleUpdate,
              messages: newMessages,
            });
            cloeSessions.notifyTurnEnd(cloeSessionId);
          }
        } catch (e) {
          console.error('[NativeAgent] Session persistence failed:', e.message);
        }
      }
    },
  }, abortController.signal).catch(e => {
    console.error('[NativeAgent] Run failed:', e.message);
    sendTo('native-stream-error', { error: e.message });
    activeSessions.delete(reqId);
  });
});

// ── Stop / abort ──
ipcMain.on('native-chat-stop', (_event, reqId) => {
  const entry = activeSessions.get(reqId);
  if (entry) {
    entry.abortController.abort();
    activeSessions.delete(reqId);
  }
});

// ── Reset session ──
ipcMain.handle('native-reset-session', async (_event, cloeSessionId) => {
  const session = persistentSessions.get(cloeSessionId);
  if (session) session.reset();
  return { success: true };
});

// ── Cron management ──
ipcMain.handle('native-cron-list', async () => {
  return cron.list();
});

ipcMain.handle('native-cron-create', async (_event, data) => {
  return cron.create(data);
});

ipcMain.handle('native-cron-update', async (_event, id, changes) => {
  return cron.update(id, changes);
});

ipcMain.handle('native-cron-remove', async (_event, id) => {
  return { removed: cron.remove(id) };
});

/**
 * Initialize the native agent subsystem.
 * Call this once at app startup (after bridge is ready).
 */
function init() {
  // Watch soul file for hot reload
  soul.watchSoul();

  // Preload Pi agent modules (ESM dynamic import) to warm up the cache
  preloadPi();

  // Start cron scheduler if enabled
  const cfg = config.loadConfig();
  if (cfg.enabled) {
    cron.loadJobs();
    cron.start(async (job) => {
      console.log(`[NativeAgent Cron] Triggering: ${job.name}`);
      // Use channels.handleMessage to process the cron prompt
      if (job.channel === 'feishu' && job.target) {
        await channels.handleMessage('feishu', job.target, job.prompt);
      } else {
        // Desktop channel — send via IPC to chat window
        const { BrowserWindow } = require('electron');
        const chatWin = BrowserWindow.getAllWindows().find(w =>
          !w.isDestroyed() && w.webContents?.getURL()?.includes('/chat.html')
        );
        if (chatWin) {
          chatWin.webContents.send('native-cron-message', { job });
        }
      }
    });
  }
  
  console.log('[NativeAgent] Initialized');
}

module.exports = { init };
