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
 *   native-stream-retry   — { attempt, maxRetries, delayMs, error, reqId }
 *   native-stream-end     — { reqId }
 */

const { ipcMain } = require('electron');
const { AgentSession, preloadPi } = require('../../native-agent/agent');
const channels = require('../../native-agent/channels');
const cron = require('../../native-agent/cron');
const config = require('../../native-agent/config');
const soul = require('../../native-agent/soul');
const memory = require('../../native-agent/memory');
const taskManager = require('../../native-agent/task-manager');

// Active sessions by reqId (mirrors chatReqs in hermes-proxy)
const activeSessions = new Map(); // reqId → { session, abortController, sender }

// Persistent agent sessions by cloeSessionId
const persistentSessions = new Map();

// Track sender (webContents) per cloeSessionId for followUp streaming
const sessionSenders = new Map(); // cloeSessionId → webContents

// Queued messages per cloeSessionId — when agent is running, new messages wait here
const messageQueues = new Map(); // cloeSessionId → [{ message, reqId, event }]

/**
 * Get or create an AgentSession for the given cloeSessionId.
 * On first creation, loads persisted message history from cloe-sessions
 * so the LLM has full context after app restart.
 */
function getOrCreateSession(cloeSessionId) {
  if (!persistentSessions.has(cloeSessionId)) {
    // Load persisted history from cloe-sessions store
    let history = [];
    try {
      const cloeSessions = require('../../cloe-sessions');
      const stored = cloeSessions.getSession(cloeSessionId);
      if (stored && Array.isArray(stored.messages)) {
        history = stored.messages;
        console.log(`[NativeAgent] Session ${cloeSessionId}: loaded ${history.length} messages from persistence`);
      }
    } catch (e) {
      console.warn('[NativeAgent] Failed to load session history:', e.message);
    }

    const fs2 = require('fs'); const path2 = require('path'); const os2 = require('os');
    try { fs2.appendFileSync(path2.join(os2.homedir(), '.cloe-desktop', 'native-agent-debug.log'),
      `[${new Date().toISOString()}] getOrCreateSession: ${cloeSessionId}, loaded ${history.length} messages from persistence\n`); } catch {}
    persistentSessions.set(cloeSessionId, new AgentSession(cloeSessionId, { history }));
  }
  return persistentSessions.get(cloeSessionId);
}

/**
 * Reload history for an existing session (e.g. when user reopens a session
 * that was created in a previous app run). Called from native-reload-history.
 */
function reloadSessionHistory(cloeSessionId) {
  let history = [];
  try {
    const cloeSessions = require('../../cloe-sessions');
    const stored = cloeSessions.getSession(cloeSessionId);
    if (stored && Array.isArray(stored.messages)) {
      history = stored.messages;
    }
  } catch (e) {
    console.warn('[NativeAgent] Failed to reload session history:', e.message);
  }

  const session = persistentSessions.get(cloeSessionId);
  if (session) {
    session.setHistory(history);
    console.log(`[NativeAgent] Session ${cloeSessionId}: reloaded ${history.length} messages`);
  } else {
    const fs3 = require('fs'); const path3 = require('path'); const os3 = require('os');
    try { fs3.appendFileSync(path3.join(os3.homedir(), '.cloe-desktop', 'native-agent-debug.log'),
      `[${new Date().toISOString()}] reloadSessionHistory: ${cloeSessionId}, created new session with ${history.length} messages\n`); } catch {}
    persistentSessions.set(cloeSessionId, new AgentSession(cloeSessionId, { history }));
  }
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

  // If agent is already running, queue the message for after the current run finishes.
  // This prevents concurrent prompt() calls (Pi throws "already processing").
  if (session.isRunning) {
    const sid = cloeSessionId || reqId;
    if (!messageQueues.has(sid)) messageQueues.set(sid, []);
    messageQueues.get(sid).push({ message, reqId, sender: event.sender });
    console.log(`[NativeAgent] Session busy, queued message (reqId=${reqId})`);
    return;
  }

  runNativeAgent(session, message, reqId, cloeSessionId, event);
});

/**
 * Run the native agent for a single message.
 * Extracted so it can be called both directly and from the queue drain.
 */
function runNativeAgent(session, message, reqId, cloeSessionId, event) {
  const abortController = new AbortController();

  // Store sender for followUp (sub-agent completion notifications)
  if (cloeSessionId && event?.sender) {
    sessionSenders.set(cloeSessionId, event.sender);
  }

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
    onDelta: (chunk, type) => {
      if (type !== 'thinking') accumulatedText += chunk;
      sendTo('native-stream-delta', { content: chunk, contentType: type || 'text' });
    },
    onTool: (toolInfo) => {
      accumulatedTools.push(toolInfo);
      sendTo('native-stream-tool', toolInfo);
    },
    onRetry: (info) => {
      sendTo('native-stream-retry', info);
    },
    onError: (err) => {
      sendTo('native-stream-error', { error: err });
    },
    onEnd: (fullText, toolCalls, ctxUsage) => {
      activeSessions.delete(reqId);
      sendTo('native-stream-end', {});
      // Send context usage update to chat window
      if (ctxUsage) {
        console.log(`[NativeProxy] sending context-usage: pct=${ctxUsage.usagePct}, tokens=${ctxUsage.promptTokens}, window=${ctxUsage.contextWindow}`);
        sendTo('context-usage', {
          usage_pct: ctxUsage.usagePct,
          prompt_tokens: ctxUsage.promptTokens,
          context_limit: ctxUsage.contextWindow,
        });
      }
      
      // Return accumulated content for persistence
      // FollowUp messages: persist the assistant response but store the
      // system notification as role 'system' instead of 'user'
      if (cloeSessionId) {
        try {
          const cloeSessions = require('../../cloe-sessions');
          const cloeSession = cloeSessions.getSession(cloeSessionId);
          if (cloeSession) {
            const isFollowUp = reqId.startsWith('followup-');
            const userRole = isFollowUp ? 'system' : 'user';
            const newMessages = [
              ...cloeSession.messages,
              { role: userRole, content: message },
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
            const titleUpdate = (!cloeSession.title || cloeSession.title === 'New chat') && message && !isFollowUp
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
  }).finally(() => {
    // Drain queued messages for this session
    const sid = cloeSessionId || reqId;
    const queue = messageQueues.get(sid);
    if (queue && queue.length > 0 && !session.isRunning) {
      const next = queue.shift();
      console.log(`[NativeAgent] Draining queued message (reqId=${next.reqId}), ${queue.length} remaining`);
      runNativeAgent(session, next.message, next.reqId, cloeSessionId, { sender: next.sender });
    } else if (queue && queue.length === 0) {
      messageQueues.delete(sid);
    }
  });
}

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

// ── Reload session history (called when reopening a session after restart) ──
ipcMain.handle('native-reload-history', async (_event, cloeSessionId) => {
  reloadSessionHistory(cloeSessionId);
  return { success: true };
});

// ── Thinking level ──
ipcMain.handle('native-get-thinking-level', async () => {
  try {
    const { AgentSession } = await require('../../native-agent/agent.js');
    // Read from config directly (doesn't need a session)
    const config = require('../../native-agent/config.js');
    return config.loadConfig().thinkingLevel || 'medium';
  } catch (e) {
    return 'medium';
  }
});

ipcMain.handle('native-set-thinking-level', async (_event, level) => {
  try {
    const config = require('../../native-agent/config.js');
    const cfg = config.loadConfig();
    cfg.thinkingLevel = level;
    config.saveConfig(cfg);
    // Update all existing sessions
    for (const [, session] of persistentSessions) {
      if (session.setThinkingLevel) {
        session.setThinkingLevel(level);
      }
    }
    return { success: true, level };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
  // ── Multi-agent followUp mechanism ──
  // When a sub-agent task completes, trigger a followUp turn on the parent session.
  // This streams the result to the chat window just like a normal response.
  taskManager.setFollowUpTrigger((cloeSessionId, taskId, notification) => {
    const session = persistentSessions.get(cloeSessionId);
    const sender = sessionSenders.get(cloeSessionId);
    if (!session) {
      console.warn(`[NativeAgent] followUp: session ${cloeSessionId} not found`);
      return;
    }
    if (!sender || sender.isDestroyed()) {
      console.warn(`[NativeAgent] followUp: sender for ${cloeSessionId} unavailable`);
      return;
    }

    const reqId = `followup-${taskId}-${Date.now()}`;
    console.log(`[NativeAgent] followUp triggered: ${reqId} for session ${cloeSessionId}`);

    // Notify chat window to prepare a new response area for this followUp
    try {
      sender.send('native-followup-notify', { reqId, cloeSessionId, taskId });
    } catch {}

    // Wrap sender to match the event.sender interface
    const fakeEvent = { sender };
    runNativeAgent(session, notification, reqId, cloeSessionId, fakeEvent);
  });
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
