/**
 * Cloe Desktop — Global Control State
 *
 * Single source of truth for global switches:
 *   - muted: global TTS mute
 *   - global_paused: all running reminders are globally paused
 * Reads/writes ~/.cloe/mute-state.json.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_FILE = path.join(os.homedir(), '.cloe', 'mute-state.json');

/** @type {object|null} cached state */
let cached = null;

function _load() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { muted: false, global_paused: false };
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { muted: false, global_paused: false };
  }
}

function _save(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  cached = state;
}

function _ensureCached() {
  if (!cached) cached = _load();
}

// ── Mute ──

function isMuted() {
  _ensureCached();
  return !!cached.muted;
}

function toggleMute() {
  _ensureCached();
  cached.muted = !cached.muted;
  _save(cached);
  return cached.muted;
}

// ── Global Pause ──

function isGlobalPaused() {
  _ensureCached();
  return !!cached.global_paused;
}

function toggleGlobalPause() {
  _ensureCached();
  cached.global_paused = !cached.global_paused;
  _save(cached);
  return cached.global_paused;
}

module.exports = { isMuted, toggleMute, isGlobalPaused, toggleGlobalPause, _load };
