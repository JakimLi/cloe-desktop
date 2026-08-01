'use strict';

/**
 * Native Agent Soul — 灵魂文件加载
 *
 * 从 soul.md 加载角色设定，注入到 system prompt 中。
 *
 * 路径优先级:
 *   1. config 中用户指定的 soulPath
 *   2. ~/.cloe/soul.md（自有，如果存在）
 *   3. ~/.hermes/soul.md（fallback）
 *
 * 支持热重载: 文件变化时自动重新加载。
 */

const fs = require('fs');
const path = require('path');
const { getSoulPath } = require('./paths');

let cached = null;
let cachedMtime = 0;
let cachedPath = null;
let watcher = null;

/**
 * Resolve soul file path.
 * Uses paths.js fallback logic, plus config override.
 */
function getSoulPathResolved() {
  let configuredPath = '';
  try {
    const config = require('./config');
    const cfg = config.loadConfig();
    configuredPath = cfg.soulPath || '';
  } catch {}
  return getSoulPath(configuredPath);
}

/**
 * Read the soul file, caching by mtime + path.
 * Returns empty string if not found.
 */
function loadSoul() {
  const soulPath = getSoulPathResolved();
  
  // Cache invalidated if path changed
  if (cached && cachedPath === soulPath) {
    try {
      const stat = fs.statSync(soulPath);
      if (stat.mtimeMs === cachedMtime) return cached;
    } catch {
      return '';
    }
  }
  
  try {
    const stat = fs.statSync(soulPath);
    cached = fs.readFileSync(soulPath, 'utf-8');
    cachedMtime = stat.mtimeMs;
    cachedPath = soulPath;
    console.log(`[NativeAgent] Soul loaded from ${soulPath} (${cached.length} chars)`);
    return cached;
  } catch {
    return '';
  }
}

/**
 * Watch the soul file for changes and invalidate cache.
 * Re-checks path periodically so config changes are picked up.
 */
function watchSoul() {
  // Poll every 30s for path changes + mtime changes
  // More reliable than fs.watch across platforms
  setInterval(() => {
    const soulPath = getSoulPathResolved();
    if (soulPath !== cachedPath) {
      cached = null;
      cachedMtime = 0;
      return;
    }
    try {
      const stat = fs.statSync(soulPath);
      if (stat.mtimeMs !== cachedMtime) {
        cached = null;
        cachedMtime = 0;
        console.log('[NativeAgent] Soul file changed, cache invalidated');
      }
    } catch {}
  }, 30000);
  // Don't block exit
  if (setInterval.unref) {}
}

/**
 * Build the full system prompt with soul + memory + active skills.
 */
function buildSystemPrompt({ soul = '', memory = '', skillsHint = '' } = {}) {
  const parts = [];
  
  if (soul) {
    parts.push(soul);
  }
  
  if (memory) {
    parts.push(`\n--- MEMORY ---\n${memory}`);
  }
  
  if (skillsHint) {
    parts.push(`\n--- AVAILABLE SKILLS ---\n${skillsHint}`);
  }
  
  // Core behavioral instructions (minimal, complements soul)
  parts.push(`
--- NATIVE AGENT RUNTIME ---
You are running inside Cloe Desktop's native agent runtime.
You have tools available: terminal (run shell commands), file_read, file_write, file_edit (precise text replacement), file_search, list_files (directory tree), web_search, web_read, load_skill, memory, cloe_action (trigger desktop animations), cloe_tts (text-to-speech).
Use tools naturally — when you need information or want to take action, just call the tool.
When you want to express yourself visually, use cloe_action. When you want to speak, use cloe_tts.

CODING — for code modifications, prefer file_edit over file_write. file_edit does exact text matching: provide oldText with enough surrounding context to be unique in the file. Use list_files to understand project structure before editing. Syntax is auto-checked after writes to .js/.jsx/.ts files.

MEMORY MANAGEMENT — you are responsible for maintaining your own memory:
- When the user states a preference, correction, or personal detail → IMMEDIATELY call memory(action: "add", content: "...", category: "user_pref")
- When you learn a stable fact about the environment, tools, or workflow → call memory(action: "add", content: "...", category: "tool" or "general")
- When you discover something that would prevent you from having to ask the user again → remember it
- Do NOT remember task progress, completed work logs, or temporary state
- Review your memories with memory(action: "render") if you need to recall context
- Your memory persists across conversations. If you say "I'll remember that", you MUST actually call the memory tool — words alone mean nothing.

Be proactive, be yourself.`);

  return parts.join('\n');
}

module.exports = {
  loadSoul,
  watchSoul,
  buildSystemPrompt,
};
