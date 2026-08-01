'use strict';

/**
 * Native Agent Paths — 统一路径管理
 *
 * Cloe Desktop 有自己的目录体系 (~/.cloe/)，
 * 当自有目录不存在时，兼容 fallback 到 Hermes (~/.hermes/)。
 * 这样 Cloe 可以脱离 Hermes 独立运行，过渡期无缝复用已有数据。
 *
 * 优先级:
 *   1. 用户在 config 中显式指定的路径
 *   2. ~/.cloe/ 下的自有路径（如果文件/目录存在）
 *   3. ~/.hermes/ 下的兼容路径（fallback）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLOE_HOME = path.join(os.homedir(), '.cloe');
const HERMES_HOME = path.join(os.homedir(), '.hermes');

// --- Config ---
const CONFIG_DIR = CLOE_HOME;
const CONFIG_FILE = path.join(CONFIG_DIR, 'native-agent.json');
const MEMORY_FILE = path.join(CONFIG_DIR, 'native-agent-memory.json');

// --- Skills ---
const CLOE_SKILLS_DIR = path.join(CLOE_HOME, 'skills');
const HERMES_SKILLS_DIR = path.join(HERMES_HOME, 'skills');

// --- Soul ---
const CLOE_SOUL_FILE = path.join(CLOE_HOME, 'soul.md');
const HERMES_SOUL_FILE = path.join(HERMES_HOME, 'soul.md');

/**
 * Resolve skills directory.
 * Prefers ~/.cloe/skills/ if it exists, otherwise falls back to ~/.hermes/skills/.
 */
function getSkillsDir() {
  if (fs.existsSync(CLOE_SKILLS_DIR)) return CLOE_SKILLS_DIR;
  return HERMES_SKILLS_DIR;
}

/**
 * Resolve soul file path.
 * Priority:
 *   1. User-configured soulPath in config
 *   2. ~/.cloe/soul.md if it exists
 *   3. ~/.hermes/soul.md (fallback)
 */
function getSoulPath(configuredPath) {
  if (configuredPath) {
    return configuredPath.replace(/^~/, os.homedir());
  }
  if (fs.existsSync(CLOE_SOUL_FILE)) return CLOE_SOUL_FILE;
  return HERMES_SOUL_FILE;
}

module.exports = {
  CLOE_HOME,
  HERMES_HOME,
  CONFIG_DIR,
  CONFIG_FILE,
  MEMORY_FILE,
  CLOE_SKILLS_DIR,
  HERMES_SKILLS_DIR,
  CLOE_SOUL_FILE,
  HERMES_SOUL_FILE,
  getSkillsDir,
  getSoulPath,
};
