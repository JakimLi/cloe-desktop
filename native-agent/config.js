'use strict';

/**
 * Native Agent Config — Provider 配置管理
 *
 * 配置文件: ~/.cloe/native-agent.json
 *
 * 结构:
 * {
 *   "enabled": false,           // 总开关
 *   "provider": "zhipu",       // 当前 LLM provider
 *   "model": "glm-4-flash",    // 当前模型 ID
 *   "soulPath": "",            // 灵魂文件路径
 *   "providers": {             // LLM Provider 配置
 *     "zhipu": { "baseURL": "...", "apiKey": "...", "models": [...] },
 *     ...
 *   },
 *   "webSearch": {             // Web Search 配置
 *     "provider": "zhipu_mcp", // 当前搜索引擎 provider
 *     "providers": {
 *       "zhipu_mcp": { "apiKey": "...", "searchURL": "...", "readerURL": "..." },
 *       "tavily": { "apiKey": "..." },
 *       "bing": { "apiKey": "...", "endpoint": "..." },
 *       "serpapi": { "apiKey": "...", "engine": "google" },
 *       "ddg": {}              // 免费，无需配置
 *     }
 *   }
 * }
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
  thinkingLevel: 'medium',  // off | minimal | low | medium | high | xhigh | max
  webSearch: {
    provider: 'zhipu_mcp',
    providers: {
      zhipu_mcp: {
        apiKey: '',  // empty = inherit from LLM zhipu provider
        searchURL: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
        readerURL: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp',
      },
      tavily: {
        apiKey: '',
      },
      ddg: {},
      bing: {
        apiKey: '',
        endpoint: 'https://api.bing.microsoft.com/v7.0/search',
      },
      serpapi: {
        apiKey: '',
        engine: 'google',
      },
    },
  },
};

/**
 * Deep merge two objects (target wins over source for existing keys,
 * source fills in missing keys).
 */
function deepMerge(source, target) {
  if (typeof source !== 'object' || source === null) return target;
  if (typeof target !== 'object' || target === null) return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key in target) {
      if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key]) &&
          typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key])) {
        result[key] = deepMerge(source[key], target[key]);
      }
      // else: target wins
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

let cached = null;

function loadConfig() {
  if (cached) return cached;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Deep-merge with defaults so new fields appear for old configs
      cached = deepMerge(DEFAULT_CONFIG, parsed);
      // Ensure providers keys exist (shallow merge for user-added providers)
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

/**
 * Force reload config from disk (clears cache).
 * Called when config is saved via HTTP API.
 */
function reloadConfig() {
  cached = null;
  return loadConfig();
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
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  reloadConfig,
  isEnabled,
  getProvider,
  getCurrentModel,
};
