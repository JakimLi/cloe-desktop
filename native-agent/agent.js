'use strict';

/**
 * Native Agent — 基于 Pi (pi-agent-core) 的 Agent Loop
 *
 * 用 Pi 框架的 Agent 类替代原来手写的 SSE 解析 + 工具循环。
 * Pi 提供成熟的 streaming / tool-calling / abort / state / retry 能力。
 *
 * 对外保持原有接口不变(native-proxy.js / channels.js 无需改动):
 *   new AgentSession(sessionId, { history })
 *   session.addUserMessage(text)
 *   session.run({ onDelta, onTool, onError, onEnd }, signal)
 *   session.abort()
 *   session.reset()
 *
 * 事件映射:
 *   Pi message_update(text_delta)   → onDelta(text)
 *   Pi tool_execution_start         → onTool({ tool, emoji, label })
 *   Pi agent_end                    → onEnd(fullText, toolCalls)
 *   Pi 错误                          → onError(message)
 *
 * Session 持久化:
 *   AgentSession 在构造时可接收 history (来自 cloe-sessions 持久化存储)。
 *   这些历史消息会在 Pi Agent 构造时注入到 state.messages，
 *   让 LLM 拥有完整的上下文。
 *
 * 上下文管理:
 *   - 加载历史时: 如果消息过多(超过 contextWindow 的 60%)，自动截断旧消息
 *   - 运行时: 通过 transformContext hook 在每次 LLM 调用前检查并截断
 *   - 截断策略: 保留最近的消息，丢弃最早的，不做摘要(快速、无额外 API 调用)
 */

const fs = require('fs');
const path = require('path');

const config = require('./config');
const soul = require('./soul');
const memory = require('./memory');
const skills = require('./skills');
const { buildPiTools, getToolEmoji, formatToolLabel } = require('./tools');
const os = require('os');

// ── Debug file logging ──
const DEBUG_LOG = path.join(os.homedir(), '.cloe-desktop', 'native-agent-debug.log');
function debugLog(msg) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG, `[${ts}] ${msg}\n`);
  } catch {}
}

// ── 上下文管理常量 ──
// 保守估算: ~4 chars ≈ 1 token (中英混合)
const CHARS_PER_TOKEN = 4;
// 默认 context window（如果 model 定义里没有）
const DEFAULT_CONTEXT_WINDOW = 128000;
// 安全阈值: 当估算 token 数超过 contextWindow 的此比例时触发截断
const CONTEXT_THRESHOLD = 0.6;
// 最少保留的消息轮数（截断时的下限）
const MIN_KEEP_TURNS = 6;
// 估算单条消息的 token 数
function estimateMessageTokens(msg) {
  if (!msg?.content) return 0;
  if (typeof msg.content === 'string') return Math.ceil(msg.content.length / CHARS_PER_TOKEN);
  if (Array.isArray(msg.content)) {
    let chars = 0;
    for (const part of msg.content) {
      if (part?.text) chars += part.text.length;
      if (part?.type === 'image') chars += 4800; // 图片估算
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }
  return 100; // fallback
}

/**
 * Truncate message list to fit within a token budget.
 * Strategy: keep the most recent messages, drop the oldest.
 * Always keeps complete user-assistant turns (never splits a pair).
 *
 * @param {Array} messages - Pi AgentMessage array
 * @param {number} maxTokens - Maximum tokens to keep
 * @returns {{ messages: Array, dropped: number, droppedTokens: number }}
 */
function truncateToFit(messages, maxTokens) {
  if (!messages.length) return { messages, dropped: 0, droppedTokens: 0 };

  // Calculate total tokens
  let totalTokens = 0;
  const msgTokens = messages.map(m => {
    const t = estimateMessageTokens(m);
    totalTokens += t;
    return t;
  });

  if (totalTokens <= maxTokens) {
    return { messages, dropped: 0, droppedTokens: 0 };
  }

  // Need to truncate — drop messages from the front
  // But keep at least MIN_KEEP_TURNS messages (3 user-assistant pairs)
  const minKeep = MIN_KEEP_TURNS;
  let cutIndex = 0;
  let retainedTokens = totalTokens;

  for (let i = 0; i < messages.length - minKeep; i++) {
    retainedTokens -= msgTokens[i];
    cutIndex = i + 1;
    if (retainedTokens <= maxTokens) break;
  }

  // Align cutIndex to start of a turn (don't start with an assistant message)
  while (cutIndex < messages.length - minKeep && messages[cutIndex]?.role === 'assistant') {
    retainedTokens -= msgTokens[cutIndex];
    cutIndex++;
  }

  const dropped = cutIndex;
  const droppedTokens = totalTokens - retainedTokens;
  const result = messages.slice(cutIndex);

  // Prepend a system note about truncated context
  if (dropped > 0) {
    result.unshift({
      role: 'user',
      content: [{ type: 'text', text: `[Earlier in this conversation, ${dropped} messages were truncated to fit the context window.]` }],
      timestamp: Date.now(),
    });
  }

  return { messages: result, dropped, droppedTokens };
}

// ── Pi 模块懒加载缓存 ──
let _piCache = null;

async function loadPi() {
  if (_piCache) return _piCache;
  const { Agent } = await import('@earendil-works/pi-agent-core');
  const piAi = await import('@earendil-works/pi-ai');
  const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');

  const zaiJsonPath = path.join(
    __dirname, '..', 'node_modules', '@earendil-works', 'pi-ai',
    'dist', 'providers', 'data', 'zai.json'
  );
  let zaiModelDefs = {};
  try {
    const zaiData = JSON.parse(fs.readFileSync(zaiJsonPath, 'utf-8'));
    zaiModelDefs = zaiData['openai-completions'] || {};
  } catch (e) {
    console.error('[NativeAgent] Failed to read zai.json:', e.message);
  }

  _piCache = { Agent, piAi, openAICompletionsApi, zaiModelDefs };
  return _piCache;
}

function preloadPi() {
  loadPi().catch(e => console.error('[NativeAgent] preload failed:', e.message));
}

// ── Provider / Model 构造 ──
function buildProviderAndModel(pi, cfg) {
  const { piAi, openAICompletionsApi, zaiModelDefs } = pi;
  const providerInfo = config.getProvider();
  const modelId = config.getCurrentModel();

  if (!providerInfo.baseURL || !providerInfo.apiKey) {
    throw new Error(`Provider "${providerInfo.name}" not configured. Set baseURL and apiKey in ~/.cloe/native-agent.json`);
  }

  const PROVIDER_ID = 'cloe-zai';
  const targetBase = providerInfo.baseURL.replace(/\/+$/, '');

  const buildModel = (id) => {
    const def = zaiModelDefs[id];
    if (def) return { ...def, baseUrl: targetBase, provider: PROVIDER_ID };
    return {
      id, name: id, api: 'openai-completions', provider: PROVIDER_ID,
      baseUrl: targetBase,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsStore: false, supportsDeveloperRole: false,
        supportsReasoningEffort: false, maxTokensField: 'max_tokens',
      },
      contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: 8192,
    };
  };

  const modelsList = Object.keys(zaiModelDefs).map(id => buildModel(id));
  if (!modelsList.some(m => m.id === modelId)) {
    modelsList.push(buildModel(modelId));
  }

  const provider = piAi.createProvider({
    id: PROVIDER_ID,
    name: 'Cloe (Z.AI)',
    baseUrl: targetBase,
    auth: {
      apiKey: {
        name: 'Cloe API Key',
        resolve: async () => ({ auth: { apiKey: providerInfo.apiKey }, source: 'config' }),
      },
    },
    models: modelsList,
    api: openAICompletionsApi(),
  });

  const models = piAi.createModels();
  models.setProvider(provider);
  const targetModel = models.getModel(PROVIDER_ID, modelId) || models.getModel(PROVIDER_ID, modelsList[0]?.id);

  return { models, targetModel };
}

/**
 * Convert cloe-sessions message format → Pi AgentMessage format.
 *
 * cloe-sessions stores messages as:
 *   { role: 'user'|'assistant', content: string, tools?: [...], parts?: [...] }
 *
 * Pi expects:
 *   { role: 'user'|'assistant', content: [{type:'text',text}], timestamp }
 *
 * We extract text content and skip tool-only entries to keep context clean.
 */
// Zero-value usage object matching Pi's Usage shape.
// Required on assistant messages: Pi's estimateContextTokens reads
// assistant.usage.totalTokens, which crashes if usage is undefined.
const ZERO_USAGE = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function convertHistoryToPiMessages(history) {
  if (!Array.isArray(history)) return [];
  const result = [];
  for (const msg of history) {
    if (!msg || !msg.role) continue;

    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.parts)) {
      text = msg.parts
        .filter(p => p.type === 'text' && p.text)
        .map(p => p.text)
        .join('\n');
    }

    if (msg.role === 'assistant' && !text.trim()) continue;

    const timestamp = msg.timestamp || Date.now();

    if (msg.role === 'assistant') {
      // Assistant messages need full Pi shape: api/provider/model/usage/stopReason.
      // Missing usage triggers "Cannot read properties of undefined (reading 'totalTokens')"
      // in Pi's estimateContextTokens.
      result.push({
        role: 'assistant',
        content: [{ type: 'text', text }],
        api: 'openai-completions',
        provider: 'cloe-zai',
        model: config.getCurrentModel(),
        usage: { ...ZERO_USAGE },
        stopReason: 'stop',
        timestamp,
      });
    } else {
      // User messages only need role/content/timestamp
      result.push({
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp,
      });
    }
  }
  return result;
}

/**
 * Agent session state.
 * Each chat session creates one of these.
 *
 * @param {string} sessionId - Cloe session ID
 * @param {object} options
 * @param {Array} options.history - Pre-loaded message history (from cloe-sessions)
 */
class AgentSession {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.isRunning = false;
    this._piAgent = null;
    this._pendingUserMessages = [];
    this._history = options.history || [];
    debugLog(`AgentSession.constructor: sessionId=${sessionId}, history.length=${this._history.length}`);
    this._contextWindow = DEFAULT_CONTEXT_WINDOW;
  }

  setHistory(history) {
    this._history = Array.isArray(history) ? history : [];
    debugLog(`AgentSession.setHistory: sessionId=${this.sessionId}, history.length=${this._history.length}`);
    if (this._piAgent) {
      this._piAgent = null;
    }
  }

  async _ensureAgent() {
    debugLog(`_ensureAgent: sessionId=${this.sessionId}, _piAgent=${!!this._piAgent}, _history.length=${this._history.length}, _pending=${this._pendingUserMessages.length}`);
    if (this._piAgent) return this._piAgent;

    const pi = await loadPi();
    const { models, targetModel } = buildProviderAndModel(pi, config.loadConfig());
    const tools = await buildPiTools();

    // Record context window from model definition
    this._contextWindow = targetModel?.contextWindow || DEFAULT_CONTEXT_WINDOW;

    const systemPrompt = soul.buildSystemPrompt({
      soul: soul.loadSoul(),
      memory: memory.render(),
      skillsHint: skills.renderIndex(),
    });

    // Max tokens for conversation history (leave room for system prompt + response)
    const maxHistoryTokens = Math.floor(this._contextWindow * CONTEXT_THRESHOLD);

    this._piAgent = new pi.Agent({
      streamFn: (m, ctx, opts) => models.streamSimple(m, ctx, opts),
      initialState: {
        systemPrompt,
        model: targetModel,
        tools,
      },
      // transformContext: called before each LLM call.
      // Truncate if messages exceed the token budget.
      transformContext: async (messages) => {
        const result = truncateToFit(messages, maxHistoryTokens);
        if (result.dropped > 0) {
          console.log(`[NativeAgent] Context truncated: dropped ${result.dropped} messages (${result.droppedTokens} est. tokens) to fit ${maxHistoryTokens} token budget`);
        }
        return result.messages;
      },
    });

    // Inject persisted history into Pi Agent's message list
    const piHistory = convertHistoryToPiMessages(this._history);

    // Pre-truncate the history before injection (avoid loading 100k tokens on init)
    const truncated = truncateToFit(piHistory, maxHistoryTokens);
    for (const msg of truncated.messages) {
      this._piAgent.state.messages.push(msg);
    }

    // Flush any messages queued before construction
    for (const text of this._pendingUserMessages) {
      this._piAgent.state.messages.push({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
    }
    this._pendingUserMessages = [];

    debugLog(`_ensureAgent: piHistory=${piHistory.length}, truncated=${truncated.messages.length}, dropped=${truncated.dropped}, agent.messages=${this._piAgent.state.messages.length}`);
    if (piHistory.length > 0) {
      console.log(`[NativeAgent] Session ${this.sessionId}: restored ${piHistory.length} messages (truncated to ${truncated.messages.length}, dropped ${truncated.dropped})`);
    }

    return this._piAgent;
  }

  addUserMessage(text) {
    if (this._piAgent) {
      this._piAgent.state.messages.push({
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: Date.now(),
      });
    } else {
      this._pendingUserMessages.push(text);
    }
  }

  async run(callbacks, signal) {
    const { onDelta, onTool, onError, onEnd } = callbacks;
    this.isRunning = true;

    let fullText = '';
    const allToolCalls = [];
    let lastErrorMessage = '';

    try {
      const agent = await this._ensureAgent();

      const unsubscribe = agent.subscribe((event) => {
        switch (event.type) {
          case 'message_update': {
            const ame = event.assistantMessageEvent;
            if (ame?.type === 'text_delta' && ame.delta) {
              fullText += ame.delta;
              onDelta?.(ame.delta);
            }
            break;
          }
          case 'tool_execution_start': {
            const toolInfo = {
              tool: event.toolName,
              emoji: getToolEmoji(event.toolName),
              label: formatToolLabel(event.toolName, event.args),
            };
            allToolCalls.push(toolInfo);
            onTool?.(toolInfo);
            break;
          }
          case 'agent_end': {
            const lastMsg = event.messages[event.messages.length - 1];
            if (lastMsg?.stopReason === 'error' && lastMsg.errorMessage) {
              lastErrorMessage = lastMsg.errorMessage;
            }
            break;
          }
        }
      });

      const messages = agent.state.messages;
      const lastUser = messages[messages.length - 1];
      const promptText = lastUser?.content?.[0]?.text || '';
      if (lastUser?.role === 'user') {
        messages.pop();
      }

      if (signal) {
        signal.addEventListener('abort', () => agent.abort());
      }

      await agent.prompt(promptText);
      unsubscribe();

      if (lastErrorMessage) {
        onError?.(lastErrorMessage);
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        onError?.(e.message);
      }
    } finally {
      this.isRunning = false;
      onEnd?.(fullText, allToolCalls);
    }
  }

  abort() {
    if (this._piAgent) {
      this._piAgent.abort();
    }
  }

  reset() {
    if (this._piAgent) {
      this._piAgent.reset();
    }
    this._pendingUserMessages = [];
    this._history = [];
  }
}

module.exports = { AgentSession, preloadPi };
