#!/usr/bin/env node
/**
 * Cloe Desktop — Reminder Engine
 *
 * Timer state machine + persistence + HTTP route handlers.
 * Runs inside the Electron main process (launcher.js).
 *
 * Reminder modes:
 *   - interval:  periodic (e.g. drink water every 30min). auto_start=true by default.
 *   - countdown: single-shot (e.g. pomodoro 25min). auto_start=false by default.
 *
 * State machine:
 *   idle → running → triggered → idle (auto_start) / completed
 *                  ↘ paused  ↗ (resume)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ==================== Persistence ====================

const REMINDERS_FILE = path.join(os.homedir(), '.cloe', 'reminders.json');

function loadReminders() {
  try {
    if (!fs.existsSync(REMINDERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveReminders(data) {
  const dir = path.dirname(REMINDERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ==================== Timer Registry ====================

/** @type {Map<string, NodeJS.Timeout>} */
const timers = new Map();

/** Callback: broadcast WS message to all clients */
let broadcastFn = null;

function setBroadcast(fn) {
  broadcastFn = fn;
}

function broadcast(msg) {
  if (broadcastFn) {
    try { broadcastFn(msg); } catch {}
  }
}

// ==================== Timer Logic ====================

function clearTimer(id) {
  if (timers.has(id)) {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
}

/**
 * Start a reminder's timer. When it fires, set status to "triggered" and broadcast.
 */
function startTimer(reminder) {
  clearTimer(reminder.id);

  if (reminder.status !== 'running') return;

  const now = Date.now();
  const triggerAt = new Date(reminder.trigger_at).getTime();
  const delay = Math.max(0, triggerAt - now);

  if (delay <= 0) {
    // Already past trigger time (e.g. app just started and timer was overdue)
    triggerReminder(reminder);
    return;
  }

  timers.set(reminder.id, setTimeout(() => {
    timers.delete(reminder.id);
    const reminders = loadReminders();
    const r = reminders[reminder.id];
    if (!r || r.status !== 'running' || !r.enabled) return;
    triggerReminder(r);
  }, delay));
}

function triggerReminder(reminder) {
  const reminders = loadReminders();
  const r = reminders[reminder.id];
  if (!r) return;

  r.status = 'triggered';
  // Only increment round on work-phase triggers
  if (r.phase !== 'break') {
    r.round = (r.round || 0) + 1;
  }
  saveReminders(reminders);

  broadcast({
    type: 'reminder-triggered',
    reminder: sanitizeReminder(r),
  });

  // Also trigger the configured action on the character
  if (r.action) {
    broadcast({ type: 'action', action: r.action });
  }

  // Generate TTS voice message if enabled
  if (r.tts) {
    // Check global mute switch
    const { isMuted } = require('./mute-state');
    if (isMuted()) {
      console.log('[Reminder] TTS skipped: global mute is on');
    } else {
      generateReminderTTS(r);
    }
  }
}

/**
 * Generate a TTS voice message for the reminder and broadcast as a speak action.
 */
function generateReminderTTS(r) {
  const { execFile } = require('child_process');
  const path = require('path');

  // Build a natural language message
  let message;
  if (r.mode === 'countdown' && r.phase === 'break') {
    message = '休息时间到啦，放松一下吧';
  } else if (r.mode === 'countdown' && r.total_rounds > 0 && r.round >= r.total_rounds) {
    message = `${r.name}全部完成啦，辛苦了`;
  } else {
    message = `${r.name}时间到啦`;
  }

  const scriptPath = path.join(os.homedir(), '.hermes', 'skills', 'creative', 'cloe-desktop-action', 'scripts', 'generate_tts.py');
  execFile('python3', [scriptPath, '--text', message, '--speak'], {
    timeout: 15000,
    cwd: path.dirname(scriptPath),
  }, (err, stdout) => {
    if (err) {
      console.error('[Reminder] TTS generation failed:', err.message);
      return;
    }
    console.log('[Reminder] TTS generated for:', r.id);
  });
}

/**
 * Dismiss a triggered reminder.
 * If auto_start, start next cycle. Otherwise, set to idle.
 */
function dismissReminder(id) {
  clearTimer(id);
  const reminders = loadReminders();
  const r = reminders[id];
  if (!r) return null;

  if (r.status !== 'triggered') return r;

  if (r.auto_start) {
    // For countdown/pomodoro with break: alternate work ↔ break phases
    if (r.mode === 'countdown' && r.break_duration > 0) {
      if (r.phase === 'work') {
        // Work phase done → start break
        r.phase = 'break';
        r.trigger_at = new Date(Date.now() + r.break_duration * 1000).toISOString();
      } else {
        // Break done → check if all rounds completed, then start next work
        if (r.total_rounds > 0 && r.round >= r.total_rounds) {
          r.status = 'completed';
          r.enabled = false;
          saveReminders(reminders);
          broadcast({ type: 'reminder-stopped', reminder: sanitizeReminder(r) });
          return reminders[id];
        }
        r.phase = 'work';
        r.trigger_at = new Date(Date.now() + r.duration * 1000).toISOString();
      }
    } else {
      // interval mode or countdown without break
      // Check if max rounds reached → auto-complete
      if (r.total_rounds > 0 && r.round >= r.total_rounds) {
        r.status = 'completed';
        r.enabled = false;
        saveReminders(reminders);
        broadcast({ type: 'reminder-stopped', reminder: sanitizeReminder(r) });
        return reminders[id];
      }
      r.trigger_at = new Date(Date.now() + r.duration * 1000).toISOString();
    }
    r.status = 'running';
    saveReminders(reminders);
    startTimer(r);
    broadcast({ type: 'reminder-dismissed', reminder: sanitizeReminder(r) });
  } else {
    r.status = 'idle';
    saveReminders(reminders);
    broadcast({ type: 'reminder-dismissed', reminder: sanitizeReminder(r) });
  }

  return reminders[id];
}

/**
 * Stop (disable) a reminder entirely. Clears timer, hides card.
 */
function stopReminder(id) {
  clearTimer(id);
  const reminders = loadReminders();
  const r = reminders[id];
  if (!r) return null;

  r.enabled = false;
  r.status = 'idle';
  saveReminders(reminders);

  broadcast({ type: 'reminder-stopped', reminder: sanitizeReminder(r) });
  return reminders[id];
}

/**
 * Create or update a reminder. If it's new or just enabled + status idle, start it.
 */
function upsertReminder(data) {
  const reminders = loadReminders();
  const id = data.id || sanitizeId(data.name);

  if (!id) return null;

  const now = new Date().toISOString();
  const existing = reminders[id];

  // For interval mode, default auto_start=true; for countdown, default false
  const isInterval = (data.mode || 'interval') === 'interval';
  const autoStart = data.auto_start !== undefined ? data.auto_start : isInterval;

  const reminder = {
    id,
    name: data.name || id,
    mode: data.mode || 'interval',         // 'interval' | 'countdown'
    duration: Math.max(1, Math.round(data.duration || 1800)), // seconds
    enabled: data.enabled !== undefined ? data.enabled : true,
    auto_start: autoStart,
    tts: data.tts !== undefined ? data.tts : true,
    action: data.action || '',             // character action name (e.g. 'wave')

    // For countdown mode (pomodoro-like)
    break_duration: data.break_duration || 0,
    total_rounds: data.total_rounds || 0,  // 0 = infinite (both modes)

    // Runtime state
    status: existing ? existing.status : 'idle',
    round: existing ? existing.round : 0,
    phase: existing ? existing.phase : 'work', // 'work' | 'break'
    trigger_at: null,
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };

  // If explicitly starting, or it's enabled and idle → start running
  const shouldStart = data.start || (reminder.enabled && (!existing || existing.status === 'idle'));

  if (shouldStart && reminder.enabled) {
    reminder.status = 'running';
    reminder.trigger_at = new Date(Date.now() + reminder.duration * 1000).toISOString();
  } else if (existing && existing.trigger_at) {
    // Preserve existing timer if we're just updating metadata
    reminder.trigger_at = existing.trigger_at;
    if (existing.status === 'running') {
      reminder.status = 'running';
    }
  }

  reminders[id] = reminder;
  saveReminders(reminders);

  if (reminder.status === 'running') {
    startTimer(reminder);
  } else {
    clearTimer(id);
  }

  broadcast({ type: 'reminder-updated', reminder: sanitizeReminder(reminder) });
  return reminder;
}

function deleteReminder(id) {
  clearTimer(id);
  const reminders = loadReminders();
  if (!reminders[id]) return false;
  delete reminders[id];
  saveReminders(reminders);
  broadcast({ type: 'reminder-deleted', id });
  return true;
}

function toggleReminder(id) {
  const reminders = loadReminders();
  const r = reminders[id];
  if (!r) return null;

  r.enabled = !r.enabled;

  if (r.enabled && r.status === 'idle') {
    // Re-start
    r.status = 'running';
    r.trigger_at = new Date(Date.now() + r.duration * 1000).toISOString();
    saveReminders(reminders);
    startTimer(r);
  } else if (!r.enabled) {
    clearTimer(id);
    r.status = 'idle';
    r.trigger_at = null;
    saveReminders(reminders);
  } else {
    saveReminders(reminders);
  }

  broadcast({ type: 'reminder-updated', reminder: sanitizeReminder(r) });
  return reminders[id];
}

function pauseReminder(id) {
  clearTimer(id);
  const reminders = loadReminders();
  const r = reminders[id];
  if (!r || r.status !== 'running') return null;

  // Calculate remaining time
  const remaining = Math.max(0,
    new Date(r.trigger_at).getTime() - Date.now()
  );
  r.status = 'paused';
  r.remaining_ms = remaining;
  saveReminders(reminders);

  broadcast({ type: 'reminder-updated', reminder: sanitizeReminder(r) });
  return reminders[id];
}

function resumeReminder(id) {
  const reminders = loadReminders();
  const r = reminders[id];
  if (!r || r.status !== 'paused') return null;

  r.status = 'running';
  r.trigger_at = new Date(Date.now() + (r.remaining_ms || r.duration * 1000)).toISOString();
  delete r.remaining_ms;
  delete r.globally_paused;
  saveReminders(reminders);
  startTimer(r);

  broadcast({ type: 'reminder-updated', reminder: sanitizeReminder(r) });
  return reminders[id];
}

// ── Global Pause/Resume ──

/**
 * Pause all running reminders. Marks them with globally_paused=true so
 * resumeGlobalPause only resumes the ones we paused (not manually paused ones).
 * Returns count of paused reminders.
 */
function pauseAllRunning() {
  const reminders = loadReminders();
  let count = 0;
  for (const [id, r] of Object.entries(reminders)) {
    if (r.enabled && r.status === 'running') {
      const remaining = Math.max(0, new Date(r.trigger_at).getTime() - Date.now());
      r.status = 'paused';
      r.remaining_ms = remaining;
      r.globally_paused = true;
      clearTimer(id);
      count++;
      broadcast({ type: 'reminder-updated', reminder: sanitizeReminder(r) });
    }
  }
  if (count > 0) saveReminders(reminders);
  return count;
}

/**
 * Resume all reminders that were globally paused.
 * Does NOT touch manually paused reminders or stopped ones.
 * Returns count of resumed reminders.
 */
function resumeAllGloballyPaused() {
  const reminders = loadReminders();
  let count = 0;
  for (const [id, r] of Object.entries(reminders)) {
    if (r.enabled && r.status === 'paused' && r.globally_paused) {
      r.status = 'running';
      r.trigger_at = new Date(Date.now() + (r.remaining_ms || r.duration * 1000)).toISOString();
      delete r.remaining_ms;
      delete r.globally_paused;
      saveReminders(reminders);
      startTimer(r);
      count++;
      broadcast({ type: 'reminder-updated', reminder: sanitizeReminder(r) });
    }
  }
  return count;
}

// ==================== Restore on Startup ====================

/**
 * Restore all running timers after app restart.
 * Call this once during bridge startup.
 */
function restoreTimers() {
  const reminders = loadReminders();
  let restored = 0;
  for (const [id, r] of Object.entries(reminders)) {
    if (r.enabled && r.status === 'running' && r.trigger_at) {
      const triggerAt = new Date(r.trigger_at).getTime();
      const now = Date.now();

      if (triggerAt <= now) {
        // Timer was overdue — trigger immediately
        triggerReminder(r);
        restored++;
      } else {
        startTimer(r);
        restored++;
      }
    }
  }
  if (restored > 0) {
    console.log(`[Reminder] Restored ${restored} active timer(s)`);
  }
}

// ==================== Helpers ====================

function sanitizeId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    .slice(0, 32) || 'reminder';
}

function sanitizeReminder(r) {
  return {
    id: r.id,
    name: r.name,
    mode: r.mode,
    duration: r.duration,
    enabled: r.enabled,
    auto_start: r.auto_start,
    tts: r.tts,
    action: r.action,
    break_duration: r.break_duration,
    total_rounds: r.total_rounds,
    status: r.status,
    round: r.round,
    phase: r.phase,
    trigger_at: r.trigger_at,
    remaining_ms: r.remaining_ms,
    created_at: r.created_at,
  };
}

// ==================== HTTP Route Handlers ====================

/**
 * Read JSON body from HTTP request. Calls callback(err, parsedObj).
 */
function readJsonBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      cb(null, JSON.parse(body || '{}'));
    } catch (e) {
      cb(e);
    }
  });
}

function jsonRes(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Register reminder routes on the HTTP server.
 * Call this in the server request handler, BEFORE the 404 fallback.
 * Returns true if the route was handled, false otherwise.
 */
function handleReminderRoute(req, res) {
  const urlPath = (req.url || '').split('?')[0];
  const method = req.method;

  // GET /reminders — list all
  if (method === 'GET' && urlPath === '/reminders') {
    const reminders = loadReminders();
    const list = Object.values(reminders).map(sanitizeReminder);
    jsonRes(res, 200, { reminders: list });
    return true;
  }

  // POST /reminders — create or update
  if (method === 'POST' && urlPath === '/reminders') {
    readJsonBody(req, (err, body) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      const r = upsertReminder(body);
      if (!r) { jsonRes(res, 400, { error: 'missing name' }); return; }
      jsonRes(res, 200, { reminder: sanitizeReminder(r) });
    });
    return true;
  }

  // GET /reminders/:id
  if (method === 'GET' && urlPath.match(/^\/reminders\/[^/]+$/)) {
    const id = decodeURIComponent(urlPath.split('/reminders/')[1]);
    const reminders = loadReminders();
    const r = reminders[id];
    if (!r) { jsonRes(res, 404, { error: 'not found' }); return true; }
    jsonRes(res, 200, { reminder: sanitizeReminder(r) });
    return true;
  }

  // POST /reminders/:id/dismiss
  if (method === 'POST' && urlPath.match(/^\/reminders\/[^/]+\/dismiss$/)) {
    const id = decodeURIComponent(urlPath.split('/')[2]);
    const r = dismissReminder(id);
    if (!r) { jsonRes(res, 400, { error: 'not triggered' }); return true; }
    jsonRes(res, 200, { reminder: sanitizeReminder(r) });
    return true;
  }

  // POST /reminders/:id/stop
  if (method === 'POST' && urlPath.match(/^\/reminders\/[^/]+\/stop$/)) {
    const id = decodeURIComponent(urlPath.split('/')[2]);
    const r = stopReminder(id);
    if (!r) { jsonRes(res, 404, { error: 'not found' }); return true; }
    jsonRes(res, 200, { reminder: sanitizeReminder(r) });
    return true;
  }

  // POST /reminders/:id/toggle
  if (method === 'POST' && urlPath.match(/^\/reminders\/[^/]+\/toggle$/)) {
    const id = decodeURIComponent(urlPath.split('/')[2]);
    const r = toggleReminder(id);
    if (!r) { jsonRes(res, 404, { error: 'not found' }); return true; }
    jsonRes(res, 200, { reminder: sanitizeReminder(r) });
    return true;
  }

  // POST /reminders/:id/pause
  if (method === 'POST' && urlPath.match(/^\/reminders\/[^/]+\/pause$/)) {
    const id = decodeURIComponent(urlPath.split('/')[2]);
    const r = pauseReminder(id);
    if (!r) { jsonRes(res, 400, { error: 'not running' }); return true; }
    jsonRes(res, 200, { reminder: sanitizeReminder(r) });
    return true;
  }

  // POST /reminders/:id/resume
  if (method === 'POST' && urlPath.match(/^\/reminders\/[^/]+\/resume$/)) {
    const id = decodeURIComponent(urlPath.split('/')[2]);
    const r = resumeReminder(id);
    if (!r) { jsonRes(res, 400, { error: 'not paused' }); return true; }
    jsonRes(res, 200, { reminder: sanitizeReminder(r) });
    return true;
  }

  // DELETE /reminders/:id
  if (method === 'DELETE' && urlPath.match(/^\/reminders\/[^/]+$/)) {
    const id = decodeURIComponent(urlPath.split('/reminders/')[1]);
    const ok = deleteReminder(id);
    if (!ok) { jsonRes(res, 404, { error: 'not found' }); return true; }
    jsonRes(res, 200, { ok: true });
    return true;
  }

  return false; // not handled
}

// ==================== Exports ====================

module.exports = {
  setBroadcast,
  restoreTimers,
  handleReminderRoute,
  // Direct access for internal use
  loadReminders,
  saveReminders,
  upsertReminder,
  dismissReminder,
  stopReminder,
  deleteReminder,
  toggleReminder,
  pauseReminder,
  resumeReminder,
  pauseAllRunning,
  resumeAllGloballyPaused,
};
