'use strict';

/**
 * Native Agent Memory — 持久化记忆
 *
 * 存储在 ~/.cloe/native-agent-memory.json
 *
 * 结构: [{ id, content, category, tags, trust, created_at, last_used }]
 *
 * 每次构建 system prompt 时注入。
 * 支持全文搜索 (简单 substring 匹配, 够用)。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG_DIR, MEMORY_FILE } = require('./paths');

const MAX_MEMORY_CHARS = 4000;   // 注入 system prompt 的最大字符数
const MAX_ENTRIES = 50;           // 最多条目数

let cached = null;

function loadMemory() {
  if (cached) return cached;
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      cached = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
    } else {
      cached = [];
    }
  } catch {
    cached = [];
  }
  return cached;
}

function saveMemory() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(cached, null, 2), 'utf-8');
  } catch (e) {
    console.error('[NativeAgent] Failed to save memory:', e.message);
  }
}

/**
 * Add a memory entry.
 * @param {string} content - The memory content
 * @param {string} category - 'user_pref' | 'project' | 'tool' | 'general'
 * @param {string} tags - Comma-separated tags
 */
function add(content, category = 'general', tags = '') {
  const entries = loadMemory();
  // Don't add duplicates
  const existing = entries.find(e => e.content === content);
  if (existing) return existing;
  
  const entry = {
    id: crypto.randomUUID(),
    content,
    category,
    tags,
    trust: 0.5,
    created_at: Date.now(),
    last_used: 0,
  };
  entries.push(entry);
  
  // Trim to MAX_ENTRIES, removing oldest/lowest-trust
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => (b.trust * (b.last_used || 1)) - (a.trust * (a.last_used || 1)));
    cached = entries.slice(0, MAX_ENTRIES);
  } else {
    cached = entries;
  }
  saveMemory();
  return entry;
}

/**
 * Remove a memory by id or content substring.
 */
function remove(idOrContent) {
  const entries = loadMemory();
  const before = entries.length;
  cached = entries.filter(e => e.id !== idOrContent && !e.content.includes(idOrContent));
  if (cached.length !== before) saveMemory();
  return before - cached.length;
}

/**
 * Search memory by keyword.
 */
function search(query) {
  const entries = loadMemory();
  const q = query.toLowerCase();
  return entries
    .filter(e => e.content.toLowerCase().includes(q) || (e.tags || '').toLowerCase().includes(q))
    .sort((a, b) => b.trust - a.trust);
}

/**
 * Render memory as text for system prompt injection.
 * Respects MAX_MEMORY_CHARS.
 */
function render() {
  const entries = loadMemory();
  if (!entries.length) return '';
  
  const sorted = entries.slice().sort((a, b) => b.trust - a.trust);
  const lines = [];
  let total = 0;
  
  for (const e of sorted) {
    const line = `§ ${e.content}`;
    if (total + line.length > MAX_MEMORY_CHARS) break;
    lines.push(line);
    total += line.length;
    // Update last_used
    e.last_used = Date.now();
  }
  saveMemory();
  return lines.join('\n');
}

/**
 * Adjust trust for an entry.
 */
function setTrust(id, delta) {
  const entries = loadMemory();
  const e = entries.find(e => e.id === id);
  if (e) {
    e.trust = Math.max(0, Math.min(1, e.trust + delta));
    saveMemory();
  }
}

module.exports = {
  add,
  remove,
  search,
  render,
  setTrust,
  loadMemory,
};
