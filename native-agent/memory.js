'use strict';

/**
 * Native Agent Memory — 分层记忆 + 衰减遗忘 (v2)
 *
 * 存储在 ~/.cloe/native-agent-memory.json
 *
 * 分类策略:
 *   user_pref  — 用户偏好/个人信息(永不淘汰,上限 100 条,全量注入)
 *   project    — 项目相关知识(LRU 衰减,上限 100 条)
 *   tool       — 工具使用经验(LRU 衰减,上限 80 条)
 *   general    — 一般知识(LRU 衰减,上限 50 条)
 *
 * Trust 动态衰减:
 *   - 新记忆初始 trust = 0.5
 *   - 每次 render() 注入时 trust += 0.02(使用即强化)
 *   - 每次 search() 命中时 trust += 0.1
 *   - 每天按时间衰减,trust < 0.05 且非 user_pref → 自动淘汰
 *
 * 注入策略(预算 6000 字符):
 *   user_pref 全注入 → tool 按 trust 降序 → project 按 trust 降序 → general 按 trust 降序
 */

const fs = require('fs');
const crypto = require('crypto');
const { CONFIG_DIR, MEMORY_FILE } = require('./paths');

const SCHEMA_VERSION = 2;
const MAX_MEMORY_CHARS = 6000;   // 注入 system prompt 的最大字符数

// 每个分类的上限
const CATEGORY_LIMITS = {
  user_pref: 100,
  project: 100,
  tool: 80,
  general: 50,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DECAY_PER_DAY = 0.01;     // 每天衰减量
const MIN_TRUST = 0.1;          // trust 下限
const EVICT_THRESHOLD = 0.05;   // 低于此值且非 user_pref → 淘汰
const RENDER_BOOST = 0.02;      // render 命中时强化
const SEARCH_BOOST = 0.1;       // search 命中时强化
const DIRTY_THRESHOLD = 0.05;   // trust 变化超过此值才写入
const FLUSH_INTERVAL = 30000;   // 脏数据延迟写入间隔(30秒)

let store = null;         // { version, entries, last_decay }
let dirty = false;        // 是否有未写入的变更
let flushTimer = null;

// ── 加载 / 迁移 / 保存 ──

function loadStore() {
  if (store) return store;
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
      store = migrate(raw);
    } else {
      store = { version: SCHEMA_VERSION, entries: [], last_decay: Date.now() };
    }
  } catch {
    store = { version: SCHEMA_VERSION, entries: [], last_decay: Date.now() };
  }
  applyDecay();
  return store;
}

/**
 * Migrate v1 (plain array) → v2 ({ version, entries, last_decay }).
 */
function migrate(raw) {
  if (Array.isArray(raw)) {
    // v1: array of entries
    return {
      version: SCHEMA_VERSION,
      entries: raw.map(e => ({
        id: e.id || crypto.randomUUID(),
        content: e.content,
        category: e.category || 'general',
        tags: parseTags(e.tags),
        trust: typeof e.trust === 'number' ? e.trust : 0.5,
        created_at: e.created_at || Date.now(),
        last_used: e.last_used || 0,
        use_count: 0,
      })),
      last_decay: Date.now(),
    };
  }
  if (raw.version === SCHEMA_VERSION) return raw;
  // Unknown version — best effort
  return {
    version: SCHEMA_VERSION,
    entries: (raw.entries || []).map(e => ({ ...e, use_count: e.use_count || 0 })),
    last_decay: raw.last_decay || Date.now(),
  };
}

function markDirty() {
  dirty = true;
  if (!flushTimer) {
    flushTimer = setInterval(flush, FLUSH_INTERVAL);
    if (flushTimer.unref) flushTimer.unref();
  }
}

function flush() {
  if (!dirty || !store) return;
  dirty = false;
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('[NativeAgent] Failed to save memory:', e.message);
  }
}

/** Force immediate write (used on process exit / explicit save). */
function saveMemory() {
  if (!store) return;
  dirty = false;
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('[NativeAgent] Failed to save memory:', e.message);
  }
}

// ── Trust 衰减 ──

/**
 * Apply time-based trust decay + eviction.
 * Runs once per day (tracked by last_decay).
 */
function applyDecay() {
  if (!store) return;
  const now = Date.now();
  const elapsed = now - (store.last_decay || now);
  if (elapsed < DAY_MS) return;

  const days = Math.floor(elapsed / DAY_MS);
  const decay = days * DECAY_PER_DAY;

  store.entries = store.entries.filter(e => {
    if (e.category === 'user_pref') return true;  // 永不淘汰
    e.trust = Math.max(MIN_TRUST, e.trust - decay);
    return e.trust >= EVICT_THRESHOLD;
  });
  store.last_decay = now;
  markDirty();
}

// ── 分类上限管理 ──

function enforceCategoryLimit(entries, category) {
  const limit = CATEGORY_LIMITS[category] || 50;
  const inCat = entries.filter(e => e.category === category);
  if (inCat.length <= limit) return;

  // 淘汰 trust 最低且最久未使用的
  inCat.sort((a, b) =>
    (b.trust * (b.last_used || 1)) - (a.trust * (a.last_used || 1))
  );
  const toRemove = new Set(inCat.slice(limit).map(e => e.id));
  return entries.filter(e => !toRemove.has(e.id));
}

// ── Tags 工具 ──

function parseTags(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  if (typeof tags === 'string' && tags.trim()) {
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

// ── 公共 API ──

/**
 * Add a memory entry.
 * @param {string} content - The memory content
 * @param {string} category - 'user_pref' | 'project' | 'tool' | 'general'
 * @param {string|string[]} tags - Tags (comma-separated string or array)
 * @returns {object} The added/existing entry
 */
function add(content, category = 'general', tags = '') {
  const s = loadStore();
  // Don't add duplicates (same content)
  const existing = s.entries.find(e => e.content === content);
  if (existing) return existing;

  const entry = {
    id: crypto.randomUUID(),
    content,
    category: CATEGORY_LIMITS[category] ? category : 'general',
    tags: parseTags(tags),
    trust: 0.5,
    created_at: Date.now(),
    last_used: 0,
    use_count: 0,
  };
  s.entries.push(entry);
  s.entries = enforceCategoryLimit(s.entries, entry.category) || s.entries;
  saveMemory();
  return entry;
}

/**
 * Remove memory entries by id or content substring.
 * @returns {number} count removed
 */
function remove(idOrContent) {
  const s = loadStore();
  const before = s.entries.length;
  s.entries = s.entries.filter(e => e.id !== idOrContent && !e.content.includes(idOrContent));
  if (s.entries.length !== before) saveMemory();
  return before - s.entries.length;
}

/**
 * Search memory by keyword (content substring or tag match).
 * Strengthens trust of matched entries.
 * @returns {Array} matched entries sorted by trust + recency
 */
function search(query) {
  const s = loadStore();
  if (!query) return [];
  const q = query.toLowerCase();
  const matched = s.entries.filter(e =>
    e.content.toLowerCase().includes(q) ||
    (e.tags || []).some(t => t.toLowerCase().includes(q))
  );
  // Boost trust on hit + update usage
  for (const e of matched) {
    e.trust = Math.min(1, e.trust + SEARCH_BOOST);
    e.last_used = Date.now();
    e.use_count = (e.use_count || 0) + 1;
  }
  if (matched.length > 0) markDirty();
  return matched.sort((a, b) =>
    (b.trust * (b.last_used || 1)) - (a.trust * (a.last_used || 1))
  );
}

/**
 * Render memory as text for system prompt injection.
 * Injection priority: user_pref (all) → tool → project → general, by trust desc.
 * Respects MAX_MEMORY_CHARS budget.
 * @returns {string}
 */
function render() {
  const s = loadStore();
  if (!s.entries.length) return '';

  const byCategory = { user_pref: [], tool: [], project: [], general: [] };
  for (const e of s.entries) {
    const cat = byCategory[e.category] ? e.category : 'general';
    byCategory[cat].push(e);
  }

  // Sort each category by trust desc
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => b.trust - a.trust);
  }

  const lines = [];
  let total = 0;
  let boosted = false;

  // Inject in priority order
  for (const cat of ['user_pref', 'tool', 'project', 'general']) {
    for (const e of byCategory[cat]) {
      const line = `§ ${e.content}`;
      if (total + line.length > MAX_MEMORY_CHARS) continue;  // skip but keep going (shorter ones may fit)
      lines.push(line);
      total += line.length;
      // Strengthen trust on injection
      e.trust = Math.min(1, e.trust + RENDER_BOOST);
      e.last_used = Date.now();
      boosted = true;
    }
  }

  if (boosted) markDirty();
  return lines.join('\n');
}

/**
 * Adjust trust for an entry.
 */
function setTrust(id, delta) {
  const s = loadStore();
  const e = s.entries.find(e => e.id === id);
  if (e) {
    e.trust = Math.max(MIN_TRUST, Math.min(1, e.trust + delta));
    saveMemory();
  }
}

/** Backward compat: return entries array. */
function loadMemory() {
  return loadStore().entries;
}

module.exports = {
  add,
  remove,
  search,
  render,
  setTrust,
  loadMemory,
  saveMemory,
  flush,
};
