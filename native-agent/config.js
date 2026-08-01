'use strict';

/**
 * Native Agent Config — Provider 配置管理
 *
 * 配置文件: ~/.cloe/native-agent.json
 *
 * 结构:
 * {
 *   "enabled": false,           // 总开关
 *   "provider": "openai",       // 当前 provider (openai/anthropic/zhipu/deepseek/custom)
 *   "model": "glm-4-flash",    // 当前模型 ID
 *   "providers": {
 *     "openai": {
 *       "baseURL": "https://api.openai.com/v1",
 *       "apiKey": "sk-...",
 *       "models": ["gpt-4o", "gpt-4o-mini"]
 *     },
 *     "zhipu": {
 *       "baseURL": "https://open.bigmodel.cn/api/paas/v4",
 *       "apiKey": "...",
 *       "models": ["glm-4-flash", "glm-4-plus", "glm-4-long"]
 *     },
 *     ...
 *   }
 * }
 *
 * 所有 provider 统一走 OpenAI-compatible API 格式。
 */

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, CONFIG_FILE } = require('./paths');

const DEFAULT_CONFIG = {
  enabled: false,
  provider: 'zhipu',
  model: 'glm-4-flash',
  soulPath: '',  // empty = auto-resolve (~/.cloe/soul.md or ~/.hermes/soul.md)
  providers: {
    zhipu: {
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '',
      models: ['glm-4-flash', 'glm-4-plus', 'glm-4-long', 'glm-4-flashx'],
    },
    deepseek: {
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '',
      models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: '',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    },
    custom: {
      baseURL: '',
      apiKey: '',
      models: [],
    },
  },
};

let cached = null;

function loadConfig() {
  if (cached) return cached;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Deep-merge with defaults so new fields appear for old configs
      cached = { ...DEFAULT_CONFIG, ...parsed };
      cached.providers = { ...DEFAULT_CONFIG.providers, ...(parsed.providers || {}) };
    } else {
      cached = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  } catch (e) {
    console.error('[NativeAgent] Failed to load config:', e.message);
    cached = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  return cached;
}

function saveConfig(cfg) {
  cached = cfg;
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('[NativeAgent] Failed to save config:', e.message);
  }
}

function isEnabled() {
  return !!loadConfig().enabled;
}

function getProvider() {
  const cfg = loadConfig();
  const name = cfg.provider || 'zhipu';
  const provider = cfg.providers?.[name];
  if (!provider) return { name: '', baseURL: '', apiKey: '', models: [] };
  return { name, ...provider };
}

function getCurrentModel() {
  const cfg = loadConfig();
  return cfg.model || '';
}

module.exports = {
  CONFIG_FILE,
  loadConfig,
  saveConfig,
  isEnabled,
  getProvider,
  getCurrentModel,
};
