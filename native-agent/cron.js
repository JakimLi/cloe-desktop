'use strict';

/**
 * Native Agent Cron — 定时任务调度
 *
 * 存储在 ~/.cloe/native-agent-cron.json
 *
 * 结构: [{
 *   id, name, schedule, prompt, channel, target,
 *   enabled, lastRun, nextRun, runCount
 * }]
 *
 * schedule 格式:
 *   - cron expression (standard 5-field): "30 9 * * *" (每天9:30)
 *   - interval: "5m", "2h", "30s"
 *   - ISO timestamp (one-shot): "2026-08-01T09:00:00"
 *
 * 每次 tick:
 *   1. 检查所有 enabled 的 job
 *   2. 如果 nextRun <= now → 执行 → 更新 lastRun/nextRun
 *   3. 执行 = 通过 channels.handleMessage() 以 job.prompt 作为用户消息
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CONFIG_DIR = path.join(os.homedir(), '.cloe');
const CRON_FILE = path.join(CONFIG_DIR, 'native-agent-cron.json');

let jobs = [];
let tickInterval = null;
let broadcastFn = null;

function loadJobs() {
  try {
    if (fs.existsSync(CRON_FILE)) {
      jobs = JSON.parse(fs.readFileSync(CRON_FILE, 'utf-8'));
    }
  } catch {
    jobs = [];
  }
  return jobs;
}

function saveJobs() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CRON_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
  } catch (e) {
    console.error('[NativeAgent Cron] Save failed:', e.message);
  }
}

function setBroadcast(fn) { broadcastFn = fn; }

function broadcast(msg) {
  if (broadcastFn) try { broadcastFn(msg); } catch {}
}

/**
 * Parse schedule string and compute next run time.
 * @param {string} schedule - cron expr | interval | ISO timestamp
 * @param {number} fromNow - base timestamp (default: Date.now())
 * @returns {number} next run timestamp (ms), or null if expired one-shot
 */
function computeNextRun(schedule, fromNow = Date.now()) {
  // Interval: "5m", "2h", "30s"
  const intervalMatch = schedule.match(/^(\d+)([smh])$/);
  if (intervalMatch) {
    const val = parseInt(intervalMatch[1]);
    const unit = intervalMatch[2];
    const ms = val * (unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000);
    return fromNow + ms;
  }
  
  // ISO timestamp (one-shot)
  if (schedule.includes('T')) {
    const ts = new Date(schedule).getTime();
    if (!isNaN(ts)) {
      return ts > fromNow ? ts : null;
    }
  }
  
  // Cron expression (5-field standard)
  // Simple implementation — supports: * specific numbers, */n, ranges, commas
  // For production reliability, we'll use a basic parser
  try {
    return parseCronNext(schedule, fromNow);
  } catch {
    console.warn(`[NativeAgent Cron] Cannot parse schedule: ${schedule}`);
    return null;
  }
}

/**
 * Minimal cron parser — 5-field format.
 * Supports: star, numbers, star-slash-n, ranges(A-B), lists(A,B,C)
 */
function parseCronNext(expr, fromNow) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron must have 5 fields');
  const [minute, hour, dom, month, dow] = parts;
  
  const now = new Date(fromNow);
  // Start from next minute
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  
  // Search up to 7 days ahead
  const maxDate = new Date(start.getTime() + 7 * 86400000);
  
  while (start < maxDate) {
    const m = start.getMinutes();
    const h = start.getHours();
    const d = start.getDate();
    const mo = start.getMonth() + 1;
    const dw = start.getDay();
    
    if (matchField(minute, m) && matchField(hour, h) && matchField(dom, d) &&
        matchField(month, mo) && matchField(dow, dw)) {
      return start.getTime();
    }
    start.setMinutes(start.getMinutes() + 1);
  }
  
  // No match in 7 days — search up to 365 days
  while (start < new Date(fromNow + 365 * 86400000)) {
    const m = start.getMinutes();
    const h = start.getHours();
    const d = start.getDate();
    const mo = start.getMonth() + 1;
    const dw = start.getDay();
    
    if (matchField(minute, m) && matchField(hour, h) && matchField(dom, d) &&
        matchField(month, mo) && matchField(dow, dw)) {
      return start.getTime();
    }
    start.setMinutes(start.getMinutes() + 1);
  }
  
  return null;
}

function matchField(spec, value) {
  if (spec === '*') return true;
  
  // */n
  const stepMatch = spec.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[1]);
    return value % step === 0;
  }
  
  // Comma-separated
  for (const part of spec.split(',')) {
    // Range A-B
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]);
      const hi = parseInt(rangeMatch[2]);
      if (value >= lo && value <= hi) return true;
      continue;
    }
    // Exact
    if (parseInt(part) === value) return true;
  }
  
  return false;
}

/**
 * Create a new cron job.
 */
function create(data) {
  const job = {
    id: data.id || crypto.randomUUID(),
    name: data.name || 'Untitled',
    schedule: data.schedule,
    prompt: data.prompt,
    channel: data.channel || 'desktop',
    target: data.target || '',
    enabled: data.enabled !== false,
    runCount: 0,
    lastRun: 0,
    nextRun: 0,
  };
  
  job.nextRun = computeNextRun(job.schedule) || 0;
  
  jobs.push(job);
  saveJobs();
  broadcast({ type: 'native-cron-updated', jobs });
  return job;
}

/**
 * Update a cron job.
 */
function update(id, changes) {
  const job = jobs.find(j => j.id === id);
  if (!job) return null;
  Object.assign(job, changes);
  if (changes.schedule) {
    job.nextRun = computeNextRun(changes.schedule) || 0;
  }
  saveJobs();
  broadcast({ type: 'native-cron-updated', jobs });
  return job;
}

/**
 * Remove a cron job.
 */
function remove(id) {
  const before = jobs.length;
  jobs = jobs.filter(j => j.id !== id);
  if (jobs.length !== before) {
    saveJobs();
    broadcast({ type: 'native-cron-updated', jobs });
  }
  return before - jobs.length;
}

/**
 * List all cron jobs.
 */
function list() {
  return jobs;
}

/**
 * Start the scheduler tick.
 * @param {function} onTrigger - (job) => called when a job fires
 */
function start(onTrigger) {
  if (tickInterval) return;
  
  loadJobs();
  // Recompute nextRun for interval jobs on startup (they should fire relative to now)
  for (const job of jobs) {
    if (job.enabled && (job.schedule.match(/^\d+[smh]$/))) {
      job.nextRun = computeNextRun(job.schedule) || 0;
    }
  }
  
  console.log(`[NativeAgent Cron] Started with ${jobs.length} jobs`);
  
  tickInterval = setInterval(async () => {
    const now = Date.now();
    
    for (const job of jobs) {
      if (!job.enabled || !job.nextRun || job.nextRun > now) continue;
      if (job.isRunning) continue;
      
      console.log(`[NativeAgent Cron] Firing: ${job.name}`);
      job.isRunning = true;
      job.lastRun = now;
      job.runCount++;
      
      // Compute next run before executing
      job.nextRun = computeNextRun(job.schedule, now) || 0;
      
      // For one-shot jobs (ISO timestamp), disable after firing
      if (job.schedule.includes('T') && !job.schedule.match(/^(\d+)[smh]$/)) {
        job.enabled = false;
      }
      
      saveJobs();
      broadcast({ type: 'native-cron-fired', job });
      
      try {
        await onTrigger(job);
      } catch (e) {
        console.error(`[NativeAgent Cron] Job "${job.name}" failed:`, e.message);
      }
      
      job.isRunning = false;
      saveJobs();
    }
  }, 10000); // Check every 10 seconds
  
  // Don't block exit
  if (tickInterval.unref) tickInterval.unref();
}

/**
 * Stop the scheduler.
 */
function stop() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

module.exports = {
  loadJobs,
  saveJobs,
  create,
  update,
  remove,
  list,
  start,
  stop,
  setBroadcast,
  computeNextRun,
};
