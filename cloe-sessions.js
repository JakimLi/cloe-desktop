#!/usr/bin/env node
/**
 * Cloe Desktop — Internal Chat Session Store
 *
 * Persists Cloe's own chat sessions to disk so they survive app restarts.
 * External agent sessions (Claude Code, Hermes subagent, etc.) remain in
 * agent-tracker.js and are ephemeral — those are never written here.
 *
 * Each internal session:
 *   { id, title, hermesSessionId, messages, contextPct, status, createdAt, lastUpdated }
 *
 * File location: ~/.cloe-desktop/chat-sessions.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Storage path ──
const STORE_DIR = path.join(os.homedir(), '.cloe-desktop');
const STORE_FILE = path.join(STORE_DIR, 'chat-sessions.json');

// ── In-memory mirror (loaded once on startup) ──
/** @type {Map<string, object>} */
const sessions = new Map();

let broadcastFn = null;

function setBroadcast(fn) {
  broadcastFn = fn;
}

function broadcast(msg) {
  if (broadcastFn) {
    try { broadcastFn(msg); } catch {}
  }
}

// ── Persistence ──

function load() {
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const s of arr) {
        sessions.set(s.id, s);
      }
    }
    console.log(`[cloe-sessions] Loaded ${sessions.size} sessions from ${STORE_FILE}`);
  } catch (e) {
    console.error('[cloe-sessions] Failed to load:', e.message);
  }
}

let saveTimer = null;

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
  }, 500); // Debounce: batch rapid updates
}

function persist() {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    const arr = [];
    for (const s of sessions.values()) {
      arr.push(toPublic(s));
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('[cloe-sessions] Failed to save:', e.message);
  }
}

// ── Public representation (strip internal-only fields) ──

function toPublic(session) {
  if (!session) return null;
  return {
    id: session.id,
    source: 'cloe-desktop',
    source_label: 'Cloe Chat',
    title: session.title || '',
    hermesSessionId: session.hermesSessionId || null,
    messages: session.messages || [],
    contextPct: session.contextPct || 0,
    muted: !!session.muted,
    status: session.status || 'idle',
    turn_count: session.turn_count || 0,
    created_at: session.created_at,
    last_updated: session.last_updated || session.lastUpdated || session.created_at,
  };
}

// ── CRUD ──

function createSession(data = {}) {
  const id = `cloe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const session = {
    id,
    source: 'cloe-desktop',
    title: data.title || '',
    hermesSessionId: data.hermesSessionId || null,
    messages: data.messages || [],
    contextPct: 0,
    muted: !!data.muted,
    status: 'idle',
    turn_count: 0,
    created_at: now,
    last_updated: now,
  };
  sessions.set(id, session);
  scheduleSave();
  broadcast({ type: 'agent-session-registered', session: toPublic(session) });
  return session;
}

function getSession(id) {
  return sessions.get(id);
}

function updateSession(id, updates) {
  const session = sessions.get(id);
  if (!session) return null;
  Object.assign(session, updates, { last_updated: new Date().toISOString() });
  scheduleSave();
  broadcast({ type: 'agent-session-updated', session: toPublic(session) });
  return session;
}

function deleteSession(id) {
  const existed = sessions.delete(id);
  if (existed) {
    scheduleSave();
    broadcast({ type: 'agent-session-ended', session_id: id });
  }
  return existed;
}

function listAll() {
  const list = [];
  for (const s of sessions.values()) {
    list.push(toPublic(s));
  }
  return list;
}

// ── Notification helpers (mirror agent-tracker's TTS flow) ──

function notifyTurnEnd(id) {
  const session = sessions.get(id);
  if (!session) return null;
  session.status = 'turn_complete';
  session.turn_count = (session.turn_count || 0) + 1;
  session.last_updated = new Date().toISOString();
  scheduleSave();
  const pub = toPublic(session);
  broadcast({ type: 'agent-session-updated', session: pub });
  // Deferred TTS via tts-scheduler — same flow as external (agent-tracker).
  // Lazy-require to avoid the agent-tracker ↔ cloe-sessions circular dep at
  // module-load time; both modules are fully loaded by the time this runs.
  try { require('./agent-tracker').scheduleSessionTTS(pub, 'turn-end'); } catch (e) {
    console.error('[cloe-sessions] scheduleSessionTTS failed:', e.message);
  }
  return session;
}

function notifyWorking(id) {
  const session = sessions.get(id);
  if (!session) return null;
  session.status = 'working';
  session.last_updated = new Date().toISOString();
  scheduleSave();
  broadcast({ type: 'agent-session-updated', session: toPublic(session) });
  return session;
}

// Load on startup
load();

module.exports = {
  setBroadcast,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  listAll,
  notifyTurnEnd,
  notifyWorking,
  toPublic,
};
