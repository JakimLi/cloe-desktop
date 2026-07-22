/**
 * Cloe Desktop — Global Mute State
 *
 * Single source of truth for the global TTS mute switch.
 * Reads/writes ~/.cloe/mute-state.json.
 * When muted, reminder-engine and agent-tracker skip TTS generation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MUTE_FILE = path.join(os.homedir(), '.cloe', 'mute-state.json');

/** @type {boolean|null} cached state, null = not yet loaded */
let cached = null;

function loadMuteState() {
  try {
    if (!fs.existsSync(MUTE_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(MUTE_FILE, 'utf-8'));
    return !!data.muted;
  } catch {
    return false;
  }
}

function saveMuteState(muted) {
  const dir = path.dirname(MUTE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MUTE_FILE, JSON.stringify({ muted }, null, 2), 'utf-8');
  cached = muted;
}

/**
 * Check if TTS is globally muted.
 * Reads from cache if available, otherwise loads from disk.
 */
function isMuted() {
  if (cached === null) cached = loadMuteState();
  return cached;
}

/**
 * Toggle mute state. Returns the new state.
 */
function toggleMute() {
  const newState = !isMuted();
  saveMuteState(newState);
  return newState;
}

module.exports = { isMuted, toggleMute, loadMuteState, saveMuteState };
