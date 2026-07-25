'use strict';

/**
 * Action Sets — the data layer for character animation sets.
 *
 * Extracted from launcher.js. Owns the four previously-global variables
 * (actionSetsData, activeSetId, actionSetsWatcher, reloadDebounceTimer) and
 * exposes read accessors plus load/save/watch lifecycle.
 *
 * Mutator policy: this module deliberately exposes the internal data object
 * by reference (getActionSetsData) so that the in-line CRUD handlers still
 * living in launcher.js (and, later, the HTTP-route modules) can keep doing
 * `data.sets.push(...)` + saveActionSets(). Those handlers mutate the same
 * object instance, so the reference stays valid. Wholesale replacement of
 * the data (e.g. on disk hot-reload) goes through setActionSetsData().
 *
 * Path note: bundled action-sets.json fallback used to resolve via
 * launcher.js __dirname (project root); re-rooted through config.PROJECT_ROOT.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const { getDataDir, PROJECT_ROOT } = require('./config');
const bridge = require('./bridge');

let actionSetsData = null;
let activeSetId = 'default';
let actionSetsWatcher = null;
let reloadDebounceTimer = null;

function loadActionSets() {
  const primary = getActionSetsPath();
  let p = primary;
  if (!fs.existsSync(p) && app.isPackaged) {
    const bundled = path.join(PROJECT_ROOT, 'dist', 'action-sets.json');
    if (fs.existsSync(bundled)) p = bundled;
  }
  let loaded = false;
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      actionSetsData = JSON.parse(raw);
      activeSetId = actionSetsData.activeSetId || 'default';
      console.log(`[ActionSets] Loaded ${actionSetsData.sets.length} set(s) from ${p}`);
      loaded = true;
    }
  } catch (err) {
    console.warn(`[ActionSets] Failed to load ${p}: ${err.message}`);
  }
  if (!loaded) {
    console.error('[ActionSets] No action-sets.json found');
    actionSetsData = null;
  }
}

function watchActionSets() {
  if (actionSetsWatcher) return; // already watching

  const filePath = getActionSetsPath();
  const dir = path.dirname(filePath);

  // Watch the directory (more reliable than watching the file directly)
  try {
    actionSetsWatcher = fs.watch(dir, (eventType, filename) => {
      if (filename !== 'action-sets.json') return;

      // Debounce: wait 300ms after last change before reloading
      // (avoids double-reload and self-trigger from saveActionSets)
      clearTimeout(reloadDebounceTimer);
      reloadDebounceTimer = setTimeout(() => {
        const currentHash = JSON.stringify(actionSetsData);
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          const newData = JSON.parse(raw);
          const newHash = JSON.stringify(newData);

          // Skip if data hasn't actually changed (e.g., our own save)
          if (newHash === currentHash) return;

          actionSetsData = newData;
          activeSetId = newData.activeSetId || 'default';
          console.log(`[ActionSets] Hot-reloaded from disk: ${newData.sets.length} set(s)`);

          // Notify renderer of the active set's config
          broadcastSetConfig(activeSetId);
        } catch (err) {
          console.warn(`[ActionSets] Hot-reload failed: ${err.message}`);
        }
      }, 300);
    });
    actionSetsWatcher.on('error', (err) => {
      console.warn(`[ActionSets] Watch error: ${err.message}`);
      actionSetsWatcher = null;
      // Retry after 5 seconds
      setTimeout(watchActionSets, 5000);
    });
    console.log(`[ActionSets] Watching ${dir} for changes`);
  } catch (err) {
    console.warn(`[ActionSets] Failed to watch: ${err.message}`);
  }
}

function getActiveSet() {
  if (!actionSetsData || actionSetsData.sets.length === 0) return null;
  return actionSetsData.sets.find(s => s.id === activeSetId) || actionSetsData.sets[0];
}

function getSetById(setId) {
  if (!actionSetsData) return null;
  return actionSetsData.sets.find(s => s.id === setId) || null;
}

/**
 * Build actions list for a given set (for the management API).
 */
function buildActionsList(setId) {
  const set = setId ? getSetById(setId) : getActiveSet();
  if (!set) return [];

  const idleCounts = {};
  for (const name of (set.idlePlaylist || [])) {
    idleCounts[name] = (idleCounts[name] || 0) + 1;
  }

  const actionMap = set.actionMap || {};
  const hookTriggers = {};
  for (const [trigger, gifName] of Object.entries(actionMap)) {
    if (!hookTriggers[gifName]) hookTriggers[gifName] = [];
    hookTriggers[gifName].push(trigger);
  }

  const actionInfo = set.actionInfo || {};
  const actions = [];
  for (const [name, gifPath] of Object.entries(set.animations || {})) {
    const gifFile = gifPath.split('/').pop();
    let trigger = 'manual';
    let idleWeight = 0;
    let hookNames = [];
    let special = null;

    if (name in idleCounts) {
      trigger = 'idle';
      idleWeight = idleCounts[name];
    }
    if (name === 'working') special = '工作模式';
    if (name === 'speak') special = '语音';

    const hooks = hookTriggers[name];
    if (hooks) {
      hookNames = hooks;
      if (trigger !== 'idle') trigger = 'hook';
    }

    const info = actionInfo[name];
    const description = (info && info.description) || '';
    const descriptionEn = (info && info.descriptionEn) || '';

    actions.push({ name, gifFile, gifPath, trigger, idleWeight, hookNames, special, description, descriptionEn });
  }
  return actions;
}

/**
 * Build sets summary (lightweight, for set selector UI).
 */
function buildSetsSummary() {
  if (!actionSetsData) return [];
  return actionSetsData.sets.map(set => ({
    id: set.id,
    name: set.name,
    nameEn: set.nameEn || set.name,
    reference: set.reference,
    chromakey: set.chromakey,
    description: set.description,
    descriptionEn: set.descriptionEn || set.description,
    actionCount: Object.keys(set.animations || {}).length,
    active: set.id === activeSetId,
  }));
}

// ==================== Action Sets CRUD Helpers ====================
function getActionSetsPath() {
  return path.join(getDataDir(), 'action-sets.json');
}

function saveActionSets() {
  const filePath = getActionSetsPath();
  fs.writeFileSync(filePath, JSON.stringify(actionSetsData, null, 2), 'utf-8');
  console.log(`[ActionSets] Saved to ${filePath}`);
}

/**
 * Validate that a user-supplied name is safe to use as a filename component.
 * Rejects path traversal (../), slashes, null bytes, etc.
 */
function isSafeFilename(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_\-\u4e00-\u9fff]+$/.test(name);
}

function generateSetId(name) {
  // Lowercase + underscore + short timestamp
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const ts = Math.floor(Date.now() / 1000) % 100000;
  return `${slug}_${ts}`;
}

/**
 * Broadcast a set's config to all connected WS clients. Kept in this module
 * because it depends on getSetById(); uses bridge.broadcast() under the hood.
 */
function broadcastSetConfig(setId) {
  const set = getSetById(setId);
  if (!set) return;
  const msg = {
    type: 'set-config',
    animations: set.animations || {},
    idlePlaylist: set.idlePlaylist || [],
    actionMap: set.actionMap || {},
  };
  // Attach default set as fallback for non-default sets
  if (setId !== 'default') {
    const defaultSet = getSetById('default');
    if (defaultSet) {
      msg.fallbackAnimations = defaultSet.animations || {};
      msg.fallbackActionMap = defaultSet.actionMap || {};
    }
  }
  const sent = bridge.broadcast(msg);
  console.log(`[broadcast] set-config for "${setId}" → ${sent} client(s)`);
}

// ==================== State accessors (for in-line CRUD handlers) ====================

/** Returns the live action-sets data object (by reference) or null. */
function getActionSetsData() {
  return actionSetsData;
}

/** Replace the entire data object (used on disk hot-reload). */
function setActionSetsData(data) {
  actionSetsData = data;
}

function getActiveSetId() {
  return activeSetId;
}

function setActiveSetId(id) {
  activeSetId = id;
  if (actionSetsData) actionSetsData.activeSetId = id;
}

module.exports = {
  loadActionSets,
  watchActionSets,
  getActiveSet,
  getSetById,
  buildActionsList,
  buildSetsSummary,
  getActionSetsPath,
  saveActionSets,
  isSafeFilename,
  generateSetId,
  broadcastSetConfig,
  getActionSetsData,
  setActionSetsData,
  getActiveSetId,
  setActiveSetId,
};
