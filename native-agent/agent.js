'use strict';

/**
 * Native Agent — 基于 Pi (pi-agent-core) 的 Agent Loop
 *
 * 用 Pi 框架的 Agent 类替代原来手写的 SSE 解析 + 工具循环。
 * Pi 提供成熟的 streaming / tool-calling / abort / state / retry 能力。
 *
 * 对外保持原有接口不变(native-proxy.js / channels.js 无需改动):
 *   new AgentSession(sessionId)
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
 * 注意:Pi 的 ESM 包用了 import attributes 语法(`with { type: "json" }`),
 * Node 22+ 才支持,Electron 28 内部是 Node 18。因此:
 *   - 不能用内置的 zaiProvider()(它的 zai.models.js 用了新语法)
 *   - 改为直接读 zai.json 数据 + createProvider 构造 provider
 */

const fs = require('fs');
const path = require('path');

const config = require('./config');
const soul = require('./soul');
const memory = require('./memory');
const skills = require('./skills');
const { buildPiTools, getToolEmoji, formatToolLabel } = require('./tools');

// ── Pi 模块懒加载缓存 ──
// 动态 import 是异步的,缓存加载结果避免每次建 session 都 import
let _piCache = null;

async function loadPi() {
  if (_piCache) return _piCache;
  const { Agent } = await import('@earendil-works/pi-agent-core');
  const piAi = await import('@earendil-works/pi-ai');
  const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');

  // 直接读 zai.json(绕开有 import attributes 语法的 zai.models.js)
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

// 预加载(供 native-proxy.js init 时调用,提前 warm up)
function preloadPi() {
  loadPi().catch(e => console.error('[NativeAgent] preload failed:', e.message));
}

// ── Provider / Model 构造 ──
// 每次建 session 时根据当前 config 构造,确保 baseURL/apiKey/model 是最新的
function buildProviderAndModel(pi, cfg) {
  const { piAi, openAICompletionsApi, zaiModelDefs } = pi;
  const providerInfo = config.getProvider();
  const modelId = config.getCurrentModel();

  if (!providerInfo.baseURL || !providerInfo.apiKey) {
    throw new Error(`Provider "${providerInfo.name}" not configured. Set baseURL and apiKey in ~/.cloe/native-agent.json`);
  }

  const PROVIDER_ID = 'cloe-zai';
  const targetBase = providerInfo.baseURL.replace(/\/+$/, '');

  // 从内置 zai.json 取 model 定义,覆盖 baseUrl + provider id
  // 若用户配置的 model 不在 zai.json 里,造一个基本定义
  const buildModel = (id) => {
    const def = zaiModelDefs[id];
    if (def) return { ...def, baseUrl: targetBase, provider: PROVIDER_ID };
    // 未知 model — 给一个兼容智谱 OpenAI 接口的最小定义
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
      contextWindow: 128000, maxTokens: 8192,
    };
  };

  const modelsList = Object.keys(zaiModelDefs).map(id => buildModel(id));
  // 确保用户配置的 model 在列表里
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
 * Agent session state.
 * Each chat session creates one of these.
 */
class AgentSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.isRunning = false;
    this._piAgent = null;      // Pi Agent 实例(lazy 构造)
    this._pendingUserMessages = [];  // Pi Agent 构造前缓存的消息
  }

  /**
   * Lazy-construct the Pi Agent.
   * Must be async (dynamic import + provider build).
   */
  async _ensureAgent() {
    if (this._piAgent) return this._piAgent;

    const pi = await loadPi();
    const { models, targetModel } = buildProviderAndModel(pi, config.loadConfig());
    const tools = await buildPiTools();  // async (TypeBox import)

    const systemPrompt = soul.buildSystemPrompt({
      soul: soul.loadSoul(),
      memory: memory.render(),
      skillsHint: skills.renderIndex(),
    });

    this._piAgent = new pi.Agent({
      streamFn: (m, ctx, opts) => models.streamSimple(m, ctx, opts),
      initialState: {
        systemPrompt,
        model: targetModel,
        tools,
      },
    });

    // Flush any messages queued before construction
    for (const text of this._pendingUserMessages) {
      this._piAgent.state.messages.push({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
    }
    this._pendingUserMessages = [];

    return this._piAgent;
  }

  /**
   * Add a user message to the conversation.
   * If Pi Agent isn't constructed yet, queue for later.
   */
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

  /**
   * Run the agent loop.
   * @param {object} callbacks - Event callbacks
   * @param {function} callbacks.onDelta - (text) => called on text chunk
   * @param {function} callbacks.onTool - (toolInfo) => called on tool execution
   * @param {function} callbacks.onError - (errorMsg) => called on error
   * @param {function} callbacks.onEnd - (fullText, toolCalls) => called when loop finishes
   * @param {AbortSignal} signal - Optional abort signal
   */
  async run(callbacks, signal) {
    const { onDelta, onTool, onError, onEnd } = callbacks;
    this.isRunning = true;

    let fullText = '';
    const allToolCalls = [];
    let lastErrorMessage = '';

    try {
      const agent = await this._ensureAgent();

      // 订阅 Pi 事件 → 映射到原 callback 接口
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
            // 提取错误信息(如果有)
            const lastMsg = event.messages[event.messages.length - 1];
            if (lastMsg?.stopReason === 'error' && lastMsg.errorMessage) {
              lastErrorMessage = lastMsg.errorMessage;
            }
            break;
          }
        }
      });

      // 取出最后一条 user message 作为 prompt(Pi 的 prompt 会自己加 message)
      const messages = agent.state.messages;
      const lastUser = messages[messages.length - 1];
      const promptText = lastUser?.content?.[0]?.text || '';
      // 移除我们手动加的,让 Pi 的 prompt() 统一管理
      if (lastUser?.role === 'user') {
        messages.pop();
      }

      // 外部 abort signal → 调用 Pi Agent 内部的 abort()
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

  /**
   * Abort the current run.
   */
  abort() {
    if (this._piAgent) {
      this._piAgent.abort();
    }
  }

  /**
   * Reset conversation (clear transcript).
   */
  reset() {
    if (this._piAgent) {
      this._piAgent.reset();
    }
    this._pendingUserMessages = [];
  }
}

module.exports = { AgentSession, preloadPi };
