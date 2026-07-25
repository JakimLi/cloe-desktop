#!/usr/bin/env node
/**
 * Cloe Desktop — Agent Session Tracker
 *
 * Tracks external agent sessions (Claude Code, Hermes subagent, etc.).
 * Agents register, notify turn-end / needs-decision, and end sessions.
 * TTS notifications on turn-end and needs-decision events.
 *
 * Runs inside the Electron main process (launcher.js).
 * In-memory only — sessions are ephemeral and lost on restart.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const cloeSessions = require('./cloe-sessions');

// ==================== Session Store ====================

/** @type {Map<string, object>} */
const sessions = new Map();

/** Callback: broadcast WS message to all clients */
let broadcastFn = null;

function setBroadcast(fn) {
  broadcastFn = fn;
  cloeSessions.setBroadcast(fn);
}

function broadcast(msg) {
  if (broadcastFn) {
    try { broadcastFn(msg); } catch {}
  }
}

// ==================== TTS ====================

// Fallback audio files shipped with the app (audio/fallback/).
// Dev mode resolves relative to CWD, packaged app resolves relative to __dirname.
const _appRoot = fs.existsSync(path.join(__dirname, 'audio', 'fallback'))
  ? __dirname
  : path.resolve(process.resourcesPath || __dirname, '..');
const FALLBACK_DIR = path.join(_appRoot, 'audio', 'fallback');
const FALLBACK_FILES = {
  'turn-end': 'turn_complete.mp3',
  'needs-decision': 'needs_decision.mp3',
};

function speakFallback(event) {
  const filename = FALLBACK_FILES[event];
  if (!filename) return;
  const filePath = path.join(FALLBACK_DIR, filename);
  if (!fs.existsSync(filePath)) return;

  const BRIDGE_URL = 'http://127.0.0.1:19851';
  const payload = JSON.stringify({
    action: 'speak',
    audio_url: `${BRIDGE_URL}/tts-fallback/${filename}`,
  });
  const req = require('http').request(`${BRIDGE_URL}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, (res) => { res.resume(); });
  req.on('error', (e) => console.error('[agent-tracker] fallback speak failed:', e.message));
  req.write(payload);
  req.end();
}

function getAgentTTSMessage(session, event) {
  const displayName = session.title || session.source_label || session.source;
  const TURN_END_SUFFIXES = [
    '完成了一轮',
    '跑完啦',
    '这轮搞定啦',
    '做完了',
    '一轮搞定',
    '搞定啦，你要看看吗',
  ];
  const NEEDS_DECISION_SUFFIXES = [
    '需要你决策',
    '在等你拿主意',
    '需要你拍个板',
    '卡住了，等你决定',
    '有个事要你定一下',
    '在等你决定呢',
  ];
  const suffixes = event === 'turn-end' ? TURN_END_SUFFIXES
    : event === 'needs-decision' ? NEEDS_DECISION_SUFFIXES
    : null;
  if (!suffixes) return null;
  return `${displayName}${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
}

function generateAgentTTS(session, event) {
  const liveSession = getSessionForTTS(session?.id) || session;

  // Check global mute switch
  const { isMuted } = require('./mute-state');
  if (isMuted()) {
    console.log('[agent-tracker] TTS skipped: global mute is on');
    return;
  }
  if (liveSession?.muted) {
    console.log('[agent-tracker] TTS skipped: session mute is on');
    return;
  }

  const message = getAgentTTSMessage(liveSession, event);
  if (!message) return;

  const { execFile } = require('child_process');
  const scriptPath = path.join(os.homedir(), '.hermes', 'skills', 'creative',
    'cloe-desktop-action', 'scripts', 'generate_tts.py');
  execFile('python3', [scriptPath, '--text', message, '--speak'],
    { timeout: 15000 }, (err) => {
      if (err) {
        console.error('[agent-tracker] TTS failed, using fallback:', err.message);
        speakFallback(event);
      }
    });
}

/**
 * Schedule deferred TTS for a session turn event.
 * Shared by external (agent-tracker) and internal (cloe-sessions) sessions.
 * Honors the global mute switch; cancelled if the user acknowledges within
 * the configured delay (see tts-scheduler).
 *
 * @param {object} session - public session object (must have id/title/source_label/source)
 * @param {'turn-end'|'needs-decision'} event
 */
function scheduleSessionTTS(session, event) {
  try {
    const liveSession = getSessionForTTS(session?.id) || session;
    const { isMuted } = require('./mute-state');
    if (isMuted()) return;
    if (liveSession?.muted) return;
    const ttsScheduler = require('./tts-scheduler');
    const sourceKey = `agent:${liveSession.id}:${event}`;
    const message = getAgentTTSMessage(liveSession, event);
    if (!message) return;
    ttsScheduler.scheduleTTS(sourceKey, message, () => generateAgentTTS(liveSession, event), {
      source: 'agent',
      id: liveSession.id,
    });
  } catch (e) {
    console.error('[agent-tracker] scheduleSessionTTS failed:', e.message);
  }
}

function getSessionForTTS(id) {
  if (!id) return null;
  const internal = cloeSessions.getSession(id);
  if (internal) return cloeSessions.toPublic(internal);
  const external = sessions.get(id);
  return external ? toPublic(external) : null;
}

// ==================== Session Operations ====================

function createSession(data) {
  const id = data.id || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!data.id) data.id = id;

  const existing = sessions.get(id);
  const now = new Date().toISOString();

  const session = {
    id,
    source: data.source || 'unknown',
    source_label: data.source_label || data.source || 'Unknown',
    status: 'working',
    title: existing ? existing.title : (data.title || ''),
    muted: existing ? !!existing.muted : !!data.muted,
    created_at: existing ? existing.created_at : now,
    last_updated: now,
    turn_count: existing ? existing.turn_count : 0,
  };

  sessions.set(id, session);

  if (!existing) {
    broadcast({ type: 'agent-session-registered', session: toPublic(session) });
  } else {
    broadcast({ type: 'agent-session-updated', session: toPublic(session) });
  }

  return session;
}

function notifyTurnEnd(id, data) {
  const session = sessions.get(id);
  if (!session) return null;

  session.status = 'turn_complete';
  session.turn_count++;
  session.last_updated = new Date().toISOString();

  broadcast({ type: 'agent-session-updated', session: toPublic(session) });

  // Deferred TTS via tts-scheduler (cancelled if user acknowledges within delay)
  scheduleSessionTTS(session, 'turn-end');

  return session;
}

function notifyNeedsDecision(id, data) {
  const session = sessions.get(id);
  if (!session) return null;

  session.status = 'needs_decision';
  session.last_updated = new Date().toISOString();

  broadcast({ type: 'agent-session-updated', session: toPublic(session) });

  // Deferred TTS via tts-scheduler (cancelled if user acknowledges within delay)
  scheduleSessionTTS(session, 'needs-decision');

  return session;
}

function endSession(id) {
  const session = sessions.get(id);
  if (!session) return false;

  sessions.delete(id);
  broadcast({ type: 'agent-session-ended', session_id: id });
  return true;
}

function cancelSession(id) {
  const session = sessions.get(id);
  if (!session) return false;

  sessions.delete(id);
  broadcast({ type: 'agent-session-cancelled', session_id: id });
  return true;
}

function setTitle(id, title) {
  const session = sessions.get(id);
  if (!session) return null;

  session.title = title;
  session.last_updated = new Date().toISOString();

  broadcast({ type: 'agent-session-title-set', session: toPublic(session) });
  return session;
}

function setSessionMuted(id, muted) {
  const internal = cloeSessions.getSession(id);
  if (internal) {
    const updated = cloeSessions.updateSession(id, { muted: !!muted });
    if (updated && muted) {
      try { require('./tts-scheduler').cancelBySource('agent', id); } catch {}
    }
    return updated ? cloeSessions.toPublic(updated) : null;
  }

  const session = sessions.get(id);
  if (!session) return null;

  session.muted = !!muted;
  session.last_updated = new Date().toISOString();
  sessions.set(id, session);
  broadcast({ type: 'agent-session-updated', session: toPublic(session) });

  if (muted) {
    try { require('./tts-scheduler').cancelBySource('agent', id); } catch {}
  }

  return toPublic(session);
}

function listSessions() {
  // Merge external (ephemeral) + internal (persisted cloe-desktop) sessions
  const external = [];
  for (const session of sessions.values()) {
    external.push(toPublic(session));
  }
  const internal = cloeSessions.listAll();
  return [...internal, ...external];
}

/** Strip internal fields for public API response */
function toPublic(session) {
  return {
    id: session.id,
    source: session.source || 'unknown',
    source_label: session.source_label || session.source || 'Unknown',
    isInternal: session.source === 'cloe-desktop',
    muted: !!session.muted,
    status: session.status,
    title: session.title,
    created_at: session.created_at,
    last_updated: session.last_updated,
    turn_count: session.turn_count,
  };
}

// ==================== HTTP Route Handler ====================

/**
 * Handle HTTP routes for agent session tracker.
 * Returns true if the route was handled, false otherwise.
 * Must be called after CORS headers are set.
 */
function handleAgentRoute(req, res) {
  const urlPath = (req.url || '').split('?')[0];

  // GET /agent-sessions — list all
  if (req.method === 'GET' && urlPath === '/agent-sessions') {
    jsonRes(res, 200, { sessions: listSessions() });
    return true;
  }

  // POST /agent-sessions — register or update
  if (req.method === 'POST' && urlPath === '/agent-sessions') {
    readJsonBody(req, (err, data) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      const session = createSession(data || {});
      jsonRes(res, 200, { ok: true, session: toPublic(session) });
    });
    return true;
  }

  // POST /agent-sessions/:id/turn-end
  const turnEndMatch = req.method === 'POST' && urlPath.match(/^\/agent-sessions\/([^/]+)\/turn-end$/);
  if (turnEndMatch) {
    const id = decodeURIComponent(turnEndMatch[1]);
    readJsonBody(req, (err, data) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      const session = notifyTurnEnd(id, data || {});
      if (!session) { jsonRes(res, 404, { error: 'session not found' }); return; }
      jsonRes(res, 200, { ok: true, session: toPublic(session) });
    });
    return true;
  }

  // POST /agent-sessions/:id/needs-decision
  const needsDecisionMatch = req.method === 'POST' && urlPath.match(/^\/agent-sessions\/([^/]+)\/needs-decision$/);
  if (needsDecisionMatch) {
    const id = decodeURIComponent(needsDecisionMatch[1]);
    readJsonBody(req, (err, data) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      const session = notifyNeedsDecision(id, data || {});
      if (!session) { jsonRes(res, 404, { error: 'session not found' }); return; }
      jsonRes(res, 200, { ok: true, session: toPublic(session) });
    });
    return true;
  }

  // POST /agent-sessions/:id/title
  const titleMatch = req.method === 'POST' && urlPath.match(/^\/agent-sessions\/([^/]+)\/title$/);
  if (titleMatch) {
    const id = decodeURIComponent(titleMatch[1]);
    readJsonBody(req, (err, data) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      const session = setTitle(id, data?.title || '');
      if (!session) { jsonRes(res, 404, { error: 'session not found' }); return; }
      jsonRes(res, 200, { ok: true, session: toPublic(session) });
    });
    return true;
  }

  // POST /agent-sessions/:id/mute
  const muteMatch = req.method === 'POST' && urlPath.match(/^\/agent-sessions\/([^/]+)\/mute$/);
  if (muteMatch) {
    const id = decodeURIComponent(muteMatch[1]);
    readJsonBody(req, (err, data) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      const muted = data?.muted;
      if (typeof muted !== 'boolean') {
        jsonRes(res, 400, { error: 'muted boolean required' });
        return;
      }
      const session = setSessionMuted(id, muted);
      if (!session) { jsonRes(res, 404, { error: 'session not found' }); return; }
      jsonRes(res, 200, { ok: true, session });
    });
    return true;
  }

  // POST /agent-sessions/:id/cancel
  const cancelMatch = req.method === 'POST' && urlPath.match(/^\/agent-sessions\/([^/]+)\/cancel$/);
  if (cancelMatch) {
    const id = decodeURIComponent(cancelMatch[1]);
    if (!cancelSession(id)) { jsonRes(res, 404, { error: 'session not found' }); return; }
    jsonRes(res, 200, { ok: true });
    return true;
  }

  // DELETE /agent-sessions/:id
  const deleteMatch = req.method === 'DELETE' && urlPath.match(/^\/agent-sessions\/([^/]+)$/);
  if (deleteMatch) {
    const id = decodeURIComponent(deleteMatch[1]);
    // Try internal session first, then external
    if (cloeSessions.deleteSession(id)) {
      jsonRes(res, 200, { ok: true });
      return true;
    }
    if (!endSession(id)) { jsonRes(res, 404, { error: 'session not found' }); return true; }
    jsonRes(res, 200, { ok: true });
    return true;
  }

  // GET /agent-sessions/:id — get single session with full detail (messages etc.)
  const getOneMatch = req.method === 'GET' && urlPath.match(/^\/agent-sessions\/([^/]+)$/);
  if (getOneMatch) {
    const id = decodeURIComponent(getOneMatch[1]);
    const internal = cloeSessions.getSession(id);
    if (internal) {
      jsonRes(res, 200, { session: cloeSessions.toPublic(internal) });
      return true;
    }
    const external = sessions.get(id);
    if (external) {
      jsonRes(res, 200, { session: toPublic(external) });
      return true;
    }
    jsonRes(res, 404, { error: 'session not found' });
    return true;
  }

  // PATCH /agent-sessions/:id — update session (title, messages, contextPct, etc.)
  const patchMatch = req.method === 'PATCH' && urlPath.match(/^\/agent-sessions\/([^/]+)$/);
  if (patchMatch) {
    const id = decodeURIComponent(patchMatch[1]);
    readJsonBody(req, (err, data) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      // Internal sessions support full updates; external only supports title
      const internal = cloeSessions.getSession(id);
      if (internal) {
        const updated = cloeSessions.updateSession(id, data || {});
        jsonRes(res, 200, { ok: true, session: cloeSessions.toPublic(updated) });
        return;
      }
      if (data?.title != null) {
        const session = setTitle(id, data.title);
        if (session) { jsonRes(res, 200, { ok: true, session: toPublic(session) }); return; }
      }
      jsonRes(res, 404, { error: 'session not found' });
    });
    return true;
  }

  // POST /agent-sessions/:id/notify-working — mark an internal session as working
  const notifyWorkingMatch = req.method === 'POST' && urlPath.match(/^\/agent-sessions\/([^/]+)\/notify-working$/);
  if (notifyWorkingMatch) {
    const id = decodeURIComponent(notifyWorkingMatch[1]);
    const session = cloeSessions.notifyWorking(id);
    if (!session) { jsonRes(res, 404, { error: 'session not found' }); return true; }
    jsonRes(res, 200, { ok: true });
    return true;
  }

  return false;
}

// ==================== Helpers (self-contained) ====================

function readJsonBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      callback(null, JSON.parse(body || '{}'));
    } catch (e) {
      callback(e, null);
    }
  });
}

function jsonRes(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ==================== Exports ====================

module.exports = {
  setBroadcast,
  handleAgentRoute,
  // Shared TTS scheduling (used by cloe-sessions for internal chat)
  scheduleSessionTTS,
  // Exposed for testing
  _sessions: sessions,
  _createSession: createSession,
  _notifyTurnEnd: notifyTurnEnd,
  _notifyNeedsDecision: notifyNeedsDecision,
  _endSession: endSession,
  _cancelSession: cancelSession,
  _setTitle: setTitle,
  _setSessionMuted: setSessionMuted,
  _listSessions: listSessions,
};
