/**
 * Cloe Desktop — TTS Scheduler (Conditional / Deferred TTS)
 *
 * Unified module for deferred TTS playback across reminder-engine and agent-tracker.
 * Instead of immediately playing TTS when a reminder triggers or a session turn ends,
 * it schedules the TTS after a configurable delay (default 3s).
 *
 * If the user acknowledges (clicks "知道了" / dismisses the card / interacts with the session)
 * within the delay window, the TTS is cancelled — the user obviously saw it.
 *
 * Config persists to ~/.cloe/tts-scheduler.json:
 *   { conditional_tts: boolean, tts_delay: number(ms) }
 *
 * Used by: reminder-engine.js, agent-tracker.js
 * Cancelled by: reminder-overlay.js (dismiss), App.jsx (session acknowledge)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ==================== Config ====================

const CONFIG_FILE = path.join(os.homedir(), '.cloe', 'tts-scheduler.json');

let configCache = null;

function _loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { conditional_tts: true, tts_delay: 3000 };
    return Object.assign(
      { conditional_tts: true, tts_delay: 3000 },
      JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    );
  } catch {
    return { conditional_tts: true, tts_delay: 3000 };
  }
}

function _saveConfig(cfg) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  configCache = cfg;
}

function getConfig() {
  if (!configCache) configCache = _loadConfig();
  return configCache;
}

function updateConfig(updates) {
  configCache = Object.assign({}, getConfig(), updates);
  _saveConfig(configCache);
  return configCache;
}

// ==================== Pending TTS Map ====================

/**
 * Map<sourceKey, { timer, text, ttsFn, source, id }>
 * - sourceKey: unique key like "reminder:喝水" or "agent:zcode-12345:turn-end"
 * - timer: setTimeout handle
 * - text: the TTS message (for logging)
 * - ttsFn: function that actually generates TTS (generateReminderTTS / generateAgentTTS)
 * - source: 'reminder' | 'agent'
 * - id: reminder id or session id
 */
const pending = new Map();

/** Broadcast function injected by launcher.js */
let broadcastFn = null;
function setBroadcast(fn) { broadcastFn = fn; }
function broadcast(msg) {
  if (broadcastFn) { try { broadcastFn(msg); } catch {} }
}

// ==================== Core API ====================

/**
 * Schedule a deferred TTS. If conditional_tts is disabled, fires immediately.
 *
 * @param {string} sourceKey - unique key (e.g. "reminder:喝水", "agent:sessionId:turn-end")
 * @param {string} text - TTS message text (for logging/preview)
 * @param {Function} ttsFn - callback that generates the actual TTS (e.g. generateReminderTTS)
 * @param {object} opts - { source: 'reminder'|'agent', id: string }
 */
function scheduleTTS(sourceKey, text, ttsFn, opts = {}) {
  // Cancel any existing pending TTS for the same key
  cancelTTS(sourceKey);

  const cfg = getConfig();

  // If conditional TTS is disabled, fire immediately
  if (!cfg.conditional_tts) {
    broadcast({ type: 'tts-scheduled', sourceKey, text, delay: 0 });
    ttsFn();
    return;
  }

  const delay = Math.max(0, cfg.tts_delay || 3000);

  broadcast({ type: 'tts-scheduled', sourceKey, text, delay, source: opts.source, id: opts.id });

  const timer = setTimeout(() => {
    pending.delete(sourceKey);
    console.log(`[TTS-Scheduler] Delay expired, playing TTS for ${sourceKey}: ${text}`);
    ttsFn();
  }, delay);

  pending.set(sourceKey, { timer, text, ttsFn, source: opts.source, id: opts.id });

  console.log(`[TTS-Scheduler] Scheduled TTS for ${sourceKey} in ${delay}ms`);
}

/**
 * Cancel a pending TTS (user acknowledged before delay expired).
 * @param {string} sourceKey - the key to cancel, or pass '*' to cancel ALL pending
 */
function cancelTTS(sourceKey) {
  if (sourceKey === '*') {
    for (const [key, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(key);
    }
    broadcast({ type: 'tts-cancelled', sourceKey: '*' });
    console.log('[TTS-Scheduler] Cancelled all pending TTS');
    return;
  }

  const entry = pending.get(sourceKey);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(sourceKey);
    broadcast({ type: 'tts-cancelled', sourceKey });
    console.log(`[TTS-Scheduler] Cancelled TTS for ${sourceKey}`);
  }
}

/**
 * Cancel all pending TTS for a given source type + id.
 * E.g. cancelBySource('agent', 'session-123') cancels all agent events for that session.
 *
 * @param {string} source - 'reminder' | 'agent'
 * @param {string} id - reminder id or session id
 */
function cancelBySource(source, id) {
  for (const [key, entry] of pending) {
    if (entry.source === source && entry.id === id) {
      clearTimeout(entry.timer);
      pending.delete(key);
      broadcast({ type: 'tts-cancelled', sourceKey: key });
      console.log(`[TTS-Scheduler] Cancelled TTS by source: ${key}`);
    }
  }
}

/**
 * Check if there's a pending TTS for the given sourceKey.
 */
function hasPending(sourceKey) {
  return pending.has(sourceKey);
}

// ==================== HTTP Routes ====================

/**
 * Handle HTTP routes for tts-scheduler config + cancel.
 * Returns true if the route was handled.
 */
function handleTTSRoute(req, res) {
  const urlPath = (req.url || '').split('?')[0];

  // GET /tts-scheduler/config
  if (req.method === 'GET' && urlPath === '/tts-scheduler/config') {
    const cfg = getConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cfg));
    return true;
  }

  // POST /tts-scheduler/config — update config
  if (req.method === 'POST' && urlPath === '/tts-scheduler/config') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const updates = {};
        if (data.conditional_tts !== undefined) updates.conditional_tts = !!data.conditional_tts;
        if (data.tts_delay !== undefined) {
          // Accept seconds from UI, store as ms internally
          updates.tts_delay = Math.max(0, Math.round(data.tts_delay));
        }
        const cfg = updateConfig(updates);
        broadcast({ type: 'tts-scheduler-config-changed', config: cfg });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cfg));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
    });
    return true;
  }

  // POST /tts-scheduler/cancel — cancel a pending TTS by sourceKey or by source+id
  if (req.method === 'POST' && urlPath === '/tts-scheduler/cancel') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      if (data.sourceKey) {
        cancelTTS(data.sourceKey);
      } else if (data.source && data.id) {
        cancelBySource(data.source, data.id);
      } else if (data.all) {
        cancelTTS('*');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return true;
  }

  return false;
}

// ==================== Exports ====================

module.exports = {
  setBroadcast,
  getConfig,
  updateConfig,
  scheduleTTS,
  cancelTTS,
  cancelBySource,
  hasPending,
  handleTTSRoute,
};
