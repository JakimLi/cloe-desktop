#!/usr/bin/env node
/**
 * Cloe Desktop — Task Engine
 *
 * CRUD task management with persistence, timer support, and priority ordering.
 * Tasks are stored in ~/.cloe/tasks.json and restored on startup.
 * Timer tracks elapsed seconds for the currently active task.
 *
 * Runs inside the Electron main process (launcher.js).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ==================== Constants ====================

const TASKS_FILE = path.join(os.homedir(), '.cloe', 'tasks.json');
const PRIORITY_FILE = path.join(os.homedir(), '.cloe', 'task-order.json');
const TIMER_TICK_MS = 1000; // broadcast timer update every second

// ==================== State ====================

/** @type {Map<string, object>} id → task */
const tasks = new Map();

/** Ordered list of task IDs (priority order). First = highest priority. */
let order = [];

/** ID of the currently timing task, or null */
let timingId = null;

/** Accumulated seconds for tasks that have been timed before */
/** @type {Map<string, number>} id → accumulated seconds before current session */
const accumulated = new Map();

/** Timer interval handle */
let _timerInterval = null;

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

// ==================== Persistence ====================

function _ensureDir() {
  const dir = path.dirname(TASKS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadTasks() {
  _ensureDir();
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
      // data is an array of task objects
      for (const t of (data || [])) {
        // Backfill tags for older tasks that predate the field
        if (!Array.isArray(t.tags)) t.tags = [];
        tasks.set(t.id, t);
        // Restore accumulated time from completed sessions
        if (t.accumulated_seconds > 0) {
          accumulated.set(t.id, t.accumulated_seconds);
        }
      }
    }
  } catch (e) {
    console.error('[task-engine] Failed to load tasks:', e.message);
  }
  try {
    if (fs.existsSync(PRIORITY_FILE)) {
      order = JSON.parse(fs.readFileSync(PRIORITY_FILE, 'utf8')) || [];
      // Filter out IDs that no longer exist
      order = order.filter(id => tasks.has(id));
    } else {
      // Default order: load order
      order = [...tasks.keys()];
    }
  } catch (e) {
    order = [...tasks.keys()];
  }
  // Ensure all tasks are in order
  for (const id of tasks.keys()) {
    if (!order.includes(id)) order.push(id);
  }
  // Restore timer state: if any task was timing on shutdown
  for (const t of tasks.values()) {
    if (t.status === 'timing') {
      t.status = 'pending'; // reset timing on restart (we don't know how long)
    }
  }
  _saveTasks();
  _saveOrder();
}

function _saveTasks() {
  _ensureDir();
  const data = [];
  for (const t of tasks.values()) {
    data.push({
      ...t,
      // Include current accumulated time
      accumulated_seconds: accumulated.get(t.id) || 0,
    });
  }
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[task-engine] Failed to save tasks:', e.message);
  }
}

function _saveOrder() {
  _ensureDir();
  try {
    fs.writeFileSync(PRIORITY_FILE, JSON.stringify(order), 'utf8');
  } catch (e) {
    console.error('[task-engine] Failed to save order:', e.message);
  }
}

// ==================== Timer ====================

function _startTimerInterval() {
  if (_timerInterval) return;
  _timerInterval = setInterval(() => {
    if (timingId && accumulated.has(timingId)) {
      accumulated.set(timingId, accumulated.get(timingId) + 1);
      broadcast({
        type: 'task-timer-tick',
        task_id: timingId,
        elapsed_seconds: accumulated.get(timingId),
      });
    }
  }, TIMER_TICK_MS);
}

function _stopTimerInterval() {
  if (_timerInterval) {
    clearInterval(_timerInterval);
    _timerInterval = null;
  }
}

// ==================== Helpers ====================

/**
 * Normalize tags input into a deduplicated, trimmed string array.
 * Accepts an array or a comma/space-separated string. Empty/dupes dropped.
 */
function normalizeTags(input) {
  let arr = [];
  if (Array.isArray(input)) {
    arr = input;
  } else if (typeof input === 'string') {
    arr = input.split(/[,，\s]+/);
  }
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const tag = String(raw || '').trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

function _generateId() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toPublic(task) {
  return {
    id: task.id,
    title: task.title,
    content: task.content || '',
    tags: Array.isArray(task.tags) ? task.tags : [],
    status: task.status,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at || null,
    elapsed_seconds: accumulated.get(task.id) || 0,
  };
}

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

function _broadcastOrdered() {
  // Broadcast full state (tasks + order) so renderer stays in sync
  broadcast({
    type: 'task-state-sync',
    tasks: getOrderedTasks().map(toPublic),
    timing_id: timingId,
  });
}

// ==================== Task Operations ====================

function getOrderedTasks() {
  // Return tasks in priority order, completed tasks at the end
  const active = order.filter(id => {
    const t = tasks.get(id);
    return t && t.status !== 'completed';
  }).map(id => tasks.get(id));

  const completed = order.filter(id => {
    const t = tasks.get(id);
    return t && t.status === 'completed';
  }).map(id => tasks.get(id));

  return [...active, ...completed];
}

function createTask(data) {
  const id = data.id || _generateId();
  const now = new Date().toISOString();

  const task = {
    id,
    title: (data.title || '').trim() || 'Untitled',
    content: (data.content || '').trim(),
    tags: normalizeTags(data.tags),
    status: 'pending', // pending | timing | completed
    created_at: now,
    updated_at: now,
    completed_at: null,
  };

  tasks.set(id, task);
  accumulated.set(id, 0);
  // Insert at the very top so the newest task shows first.
  order.unshift(id);

  _saveTasks();
  _saveOrder();
  broadcast({ type: 'task-created', task: toPublic(task) });
  return task;
}

function updateTask(id, data) {
  const task = tasks.get(id);
  if (!task) return null;

  const now = new Date().toISOString();
  if (data.title !== undefined) task.title = (data.title || '').trim() || 'Untitled';
  if (data.content !== undefined) task.content = (data.content || '').trim();
  if (data.tags !== undefined) task.tags = normalizeTags(data.tags);
  task.updated_at = now;

  _saveTasks();
  broadcast({ type: 'task-updated', task: toPublic(task) });
  return task;
}

function deleteTask(id) {
  if (!tasks.has(id)) return false;

  // Stop timer if this task was timing — broadcast so frontend clears focus.
  if (timingId === id) {
    timingId = null;
    _stopTimerInterval();
    broadcast({ type: 'task-timing-stopped', task_id: id });
  }

  tasks.delete(id);
  accumulated.delete(id);
  order = order.filter(oid => oid !== id);

  _saveTasks();
  _saveOrder();
  broadcast({ type: 'task-deleted', task_id: id });
  return true;
}

function completeTask(id) {
  const task = tasks.get(id);
  if (!task) return null;

  // Stop timer if this task was timing. Broadcast the stop so the frontend
  // clears its focus state — completeTask sets status to 'completed' below,
  // so we must not call stopTiming() (which resets status to 'pending').
  if (timingId === id) {
    timingId = null;
    _stopTimerInterval();
    broadcast({ type: 'task-timing-stopped', task: toPublic(task) });
  }

  task.status = 'completed';
  task.completed_at = new Date().toISOString();
  task.updated_at = task.completed_at;

  _saveTasks();
  broadcast({ type: 'task-completed', task: toPublic(task) });
  return task;
}

function reopenTask(id) {
  const task = tasks.get(id);
  if (!task) return null;

  task.status = 'pending';
  task.completed_at = null;
  task.updated_at = new Date().toISOString();

  _saveTasks();
  broadcast({ type: 'task-reopened', task: toPublic(task) });
  return task;
}

function startTiming(id) {
  const task = tasks.get(id);
  if (!task) return null;
  if (task.status === 'completed') return null;

  // Stop previous timer if any
  if (timingId) {
    const prev = tasks.get(timingId);
    if (prev) prev.status = 'pending';
  }

  timingId = id;
  task.status = 'timing';
  task.updated_at = new Date().toISOString();

  _startTimerInterval();
  _saveTasks();
  broadcast({ type: 'task-timing-started', task: toPublic(task) });
  return task;
}

function stopTiming(id) {
  const task = tasks.get(id);
  if (!task) return null;
  if (timingId !== id) return null;

  timingId = null;
  task.status = 'pending';
  task.updated_at = new Date().toISOString();

  _stopTimerInterval();
  _saveTasks();
  broadcast({ type: 'task-timing-stopped', task: toPublic(task) });
  return task;
}

function reorderTask(fromIdx, toIdx) {
  // Reorder within the active section only
  const activeOrder = order.filter(id => tasks.get(id)?.status !== 'completed');
  const completedOrder = order.filter(id => tasks.get(id)?.status === 'completed');

  if (fromIdx < 0 || fromIdx >= activeOrder.length) return false;
  if (toIdx < 0 || toIdx >= activeOrder.length) return false;
  if (fromIdx === toIdx) return false;

  const [moved] = activeOrder.splice(fromIdx, 1);
  activeOrder.splice(toIdx, 0, moved);

  order = [...activeOrder, ...completedOrder];
  _saveOrder();
  _broadcastOrdered();
  return true;
}

function listTasks() {
  return getOrderedTasks().map(toPublic);
}

// ==================== HTTP Route Handler ====================

/**
 * Handle HTTP routes for task engine.
 * Returns true if the route was handled, false otherwise.
 */
function handleTaskRoute(req, res) {
  const urlPath = (req.url || '').split('?')[0];

  // GET /tasks — list all (ordered)
  if (req.method === 'GET' && urlPath === '/tasks') {
    jsonRes(res, 200, { tasks: listTasks(), timing_id: timingId });
    return true;
  }

  // POST /tasks — create
  if (req.method === 'POST' && urlPath === '/tasks') {
    readJsonBody(req, (err, data) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      const task = createTask(data || {});
      jsonRes(res, 201, { ok: true, task: toPublic(task) });
    });
    return true;
  }

  // PATCH /tasks/:id — update title/content
  const patchMatch = req.method === 'PATCH' && urlPath.match(/^\/tasks\/([^/]+)$/);
  if (patchMatch) {
    const id = decodeURIComponent(patchMatch[1]);
    readJsonBody(req, (err, data) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      const task = updateTask(id, data || {});
      if (!task) { jsonRes(res, 404, { error: 'task not found' }); return; }
      jsonRes(res, 200, { ok: true, task: toPublic(task) });
    });
    return true;
  }

  // DELETE /tasks/:id
  const deleteMatch = req.method === 'DELETE' && urlPath.match(/^\/tasks\/([^/]+)$/);
  if (deleteMatch) {
    const id = decodeURIComponent(deleteMatch[1]);
    if (!deleteTask(id)) { jsonRes(res, 404, { error: 'task not found' }); return; }
    jsonRes(res, 200, { ok: true });
    return true;
  }

  // POST /tasks/:id/complete
  const completeMatch = req.method === 'POST' && urlPath.match(/^\/tasks\/([^/]+)\/complete$/);
  if (completeMatch) {
    const id = decodeURIComponent(completeMatch[1]);
    const task = completeTask(id);
    if (!task) { jsonRes(res, 404, { error: 'task not found' }); return; }
    jsonRes(res, 200, { ok: true, task: toPublic(task) });
    return true;
  }

  // POST /tasks/:id/reopen
  const reopenMatch = req.method === 'POST' && urlPath.match(/^\/tasks\/([^/]+)\/reopen$/);
  if (reopenMatch) {
    const id = decodeURIComponent(reopenMatch[1]);
    const task = reopenTask(id);
    if (!task) { jsonRes(res, 404, { error: 'task not found' }); return; }
    jsonRes(res, 200, { ok: true, task: toPublic(task) });
    return true;
  }

  // POST /tasks/:id/start — begin timing
  const startMatch = req.method === 'POST' && urlPath.match(/^\/tasks\/([^/]+)\/start$/);
  if (startMatch) {
    const id = decodeURIComponent(startMatch[1]);
    const task = startTiming(id);
    if (!task) { jsonRes(res, 404, { error: 'task not found or cannot start' }); return; }
    jsonRes(res, 200, { ok: true, task: toPublic(task) });
    return true;
  }

  // POST /tasks/:id/stop — stop timing
  const stopMatch = req.method === 'POST' && urlPath.match(/^\/tasks\/([^/]+)\/stop$/);
  if (stopMatch) {
    const id = decodeURIComponent(stopMatch[1]);
    const task = stopTiming(id);
    if (!task) { jsonRes(res, 404, { error: 'task not found or not timing' }); return; }
    jsonRes(res, 200, { ok: true, task: toPublic(task) });
    return true;
  }

  // POST /tasks/reorder
  if (req.method === 'POST' && urlPath === '/tasks/reorder') {
    readJsonBody(req, (err, data) => {
      if (err) { jsonRes(res, 400, { error: 'invalid JSON' }); return; }
      const { from_idx, to_idx } = data || {};
      if (typeof from_idx !== 'number' || typeof to_idx !== 'number') {
        jsonRes(res, 400, { error: 'from_idx and to_idx are required' }); return;
      }
      if (!reorderTask(from_idx, to_idx)) {
        jsonRes(res, 400, { error: 'invalid indices' }); return;
      }
      jsonRes(res, 200, { ok: true, tasks: listTasks() });
    });
    return true;
  }

  return false;
}

// ==================== Exports ====================

module.exports = {
  setBroadcast,
  handleTaskRoute,
  loadTasks,
  // Exposed for testing
  _tasks: tasks,
  _order: () => order,
  _timingId: () => timingId,
  _accumulated: accumulated,
  _createTask: createTask,
  _updateTask: updateTask,
  _deleteTask: deleteTask,
  _completeTask: completeTask,
  _startTiming: startTiming,
  _stopTiming: stopTiming,
  _listTasks: listTasks,
};
