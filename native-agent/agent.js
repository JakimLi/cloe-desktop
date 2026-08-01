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

const config = require('./config');
const soul = require('./soul');
const memory = require('./memory');
const skills = require('./skills');
const { buildPiTools, getToolEmoji, formatToolLabel } = require('./tools');

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

  _piCache = { Agent, piAi, openAICompletionsApi };
  return _piCache;
}

function preloadPi() {
  loadPi().catch(e => console.error('[NativeAgent] preload failed:', e.message));
}

// ── Provider / Model 构造 ──
// Per-provider compat hints for reasoning/thinking to work correctly.
// Keyed by the config provider name (zhipu / deepseek / openai / custom / ...).
// These mirror the compat fields in pi-ai's built-in model definitions.
const PROVIDER_COMPAT = {
  zhipu: { thinkingFormat: 'zai', zaiToolStream: true },
  deepseek: { thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true },
};

function buildProviderAndModel(pi, cfg) {
  const { piAi, openAICompletionsApi } = pi;
  const providerInfo = config.getProvider();
  const modelId = config.getCurrentModel();

  if (!providerInfo.baseURL || !providerInfo.apiKey) {
    throw new Error(`Provider "${providerInfo.name}" not configured. Set baseURL and apiKey in ~/.cloe/native-agent.json`);
  }

  const PROVIDER_ID = 'cloe-' + (providerInfo.name || 'custom');
  const targetBase = providerInfo.baseURL.replace(/\/+$/, '');
  const providerCompat = PROVIDER_COMPAT[providerInfo.name];

  // Build model definitions entirely from config — no dependency on pi-ai JSON files.
  const thinkingLevel = cfg.thinkingLevel || 'medium';
  const enableReasoning = thinkingLevel !== 'off';
  const buildModel = (id) => {
    const model = {
      id,
      name: id,
      api: 'openai-completions',
      provider: PROVIDER_ID,
      baseUrl: targetBase,
      reasoning: enableReasoning,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: enableReasoning && !!providerCompat,
        maxTokensField: 'max_tokens',
        ...(providerCompat || {}),
      },
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: 8192,
    };
    return model;
  };

  // Model list comes straight from the user's config (set in the settings page).
  const configModels = providerInfo.models || [];
  const modelsList = configModels.map(id => buildModel(id));
  // Ensure the currently selected model is in the list
  if (modelId && !modelsList.some(m => m.id === modelId)) {
    modelsList.push(buildModel(modelId));
  }
  if (modelsList.length === 0) {
    modelsList.push(buildModel(modelId || 'default'));
  }

  const provider = piAi.createProvider({
    id: PROVIDER_ID,
    name: 'Cloe (' + (providerInfo.name || 'custom') + ')',
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

  return { models, targetModel, providerId: PROVIDER_ID };
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

function convertHistoryToPiMessages(history, providerId) {
  if (!Array.isArray(history)) return [];
  const result = [];
  const pid = providerId || 'cloe-custom';
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
        provider: pid,
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
    this._contextWindow = DEFAULT_CONTEXT_WINDOW;

    // Sub-agent mode: focused task agent, no soul/memory/skills, no spawn tools
    this._subAgent = options.subAgent || false;
    this._taskPrompt = options.taskPrompt || '';
  }

  setHistory(history) {
    this._history = Array.isArray(history) ? history : [];
    if (this._piAgent) {
      this._piAgent = null;
    }
  }

  /**
   * Change thinking level at runtime (requires agent rebuild).
   * @param {string} level - off | minimal | low | medium | high | xhigh | max
   */
  setThinkingLevel(level) {
    const cfg = config.loadConfig();
    cfg.thinkingLevel = level;
    config.saveConfig(cfg);
    // Force rebuild on next message
    if (this._piAgent) {
      this._piAgent = null;
    }
    console.log(`[NativeAgent] Thinking level changed to: ${level}`);
  }

  getThinkingLevel() {
    return config.loadConfig().thinkingLevel || 'medium';
  }

  async _ensureAgent() {
    if (this._piAgent) return this._piAgent;

    const pi = await loadPi();
    const { models, targetModel, providerId } = buildProviderAndModel(pi, config.loadConfig());
    // Build tools — sub-agents get basic tools only (no spawn_agent/check_task)
    const tools = await buildPiTools({
      excludeSpawnTools: this._subAgent,
      cloeSessionId: this._subAgent ? null : this.sessionId,
    });
    this._providerId = providerId;

    // Record context window from model definition
    this._contextWindow = targetModel?.contextWindow || DEFAULT_CONTEXT_WINDOW;

    let systemPrompt;
    if (this._subAgent) {
      // Sub-agent: minimal task-focused system prompt, no personality
      systemPrompt = [
        'You are a focused task-execution agent. You have been assigned a specific task by the parent agent.',
        '',
        'Guidelines:',
        '- Complete the task thoroughly using available tools',
        '- Your final response is a clear, structured summary of findings/results',
        '- Do NOT include conversational filler, greetings, or personality',
        '- Focus purely on the task: investigate, analyze, and report',
        '- If you encounter errors, report them clearly and suggest alternatives',
        '- Keep your final output concise but complete — the parent agent will relay it to the user',
        '- Do not use cloe_action or cloe_tts tools',
      ].join('\n');
    } else {
      // Main agent: full system prompt with soul/memory/skills
      systemPrompt = soul.buildSystemPrompt({
        soul: soul.loadSoul(),
        memory: memory.render(),
        skillsHint: skills.renderIndex(),
      });
    }
    this._systemPrompt = systemPrompt;

    // Max tokens for conversation history (leave room for system prompt + response)
    const maxHistoryTokens = Math.floor(this._contextWindow * CONTEXT_THRESHOLD);

    const thinkingLevel = config.loadConfig().thinkingLevel || 'medium';
    this._piAgent = new pi.Agent({
      streamFn: (m, ctx, opts) => models.streamSimple(m, ctx, opts),
      initialState: {
        systemPrompt,
        model: targetModel,
        tools,
        thinkingLevel: thinkingLevel !== 'off' ? thinkingLevel : undefined,
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
    const piHistory = convertHistoryToPiMessages(this._history, this._providerId);

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

  /**
   * Check if an error is transient (worth retrying).
   * Network timeouts, rate limits, and 5xx server errors are transient.
   * Abort, auth errors, and content policy are not.
   */
  static isTransientError(msg) {
    if (!msg) return false;
    const m = msg.toLowerCase();
    // Abort — never retry
    if (m.includes('abort')) return false;
    // Auth / config errors — won't fix with retry
    if (m.includes('unauthorized') || m.includes('invalid api key') || m.includes('401') || m.includes('403')) return false;
    // Content policy — retrying won't help
    if (m.includes('content') && (m.includes('policy') || m.includes('filter'))) return false;
    // Transient: timeout, connection, rate limit, 5xx, ECONNRESET, etc.
    return true;
  }

  static sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async run(callbacks, signal) {
    const { onDelta, onTool, onError, onEnd, onRetry } = callbacks;
    this.isRunning = true;

    let fullText = '';
    const allToolCalls = [];
    let lastErrorMessage = '';
    let lastRealUsage = null;

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [2000, 4000, 8000]; // 2s, 4s, 8s backoff

    let attempt = 0;
    let succeeded = false;

    while (attempt <= MAX_RETRIES && !succeeded) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
        console.log(`[NativeAgent] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms (previous error: ${lastErrorMessage})`);
        // Notify UI to clear its stream buffer so the retried response doesn't
        // append on top of the failed attempt's partial output (causes duplication).
        onRetry?.({ attempt, maxRetries: MAX_RETRIES, delayMs: delay, error: lastErrorMessage });
        await AgentSession.sleep(delay);
      }

      // Reset per-attempt state
      fullText = '';
      lastErrorMessage = '';
      // Keep allToolCalls across retries (cumulative log)

      try {
        const agent = await this._ensureAgent();

        const unsubscribe = agent.subscribe((event) => {
          switch (event.type) {
            case 'message_update': {
              const ame = event.assistantMessageEvent;
              if (ame?.type === 'thinking_delta' && ame.delta) {
                onDelta?.(ame.delta, 'thinking');
              } else if (ame?.type === 'text_delta' && ame.delta) {
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
              // Capture real token usage from the API response for context %
              if (lastMsg?.usage) {
                lastRealUsage = lastMsg.usage;
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

        // Only attach abort listener on first attempt
        if (signal && attempt === 0) {
          signal.addEventListener('abort', () => agent.abort());
        }

        await agent.prompt(promptText);
        unsubscribe();

        if (lastErrorMessage) {
          // Agent-level error (stopReason=error)
          if (AgentSession.isTransientError(lastErrorMessage) && attempt < MAX_RETRIES) {
            attempt++;
            continue; // retry
          }
          onError?.(lastErrorMessage);
        }
        succeeded = true;
      } catch (e) {
        if (e?.name === 'AbortError') {
          // User aborted — don't retry, don't error
          succeeded = true; // exit loop cleanly
          break;
        }
        lastErrorMessage = e.message;
        if (AgentSession.isTransientError(e.message) && attempt < MAX_RETRIES) {
          attempt++;
          continue; // retry
        }
        // Non-transient or exhausted retries
        onError?.(e.message);
        succeeded = true; // exit loop
      }
    }

    this.isRunning = false;
    const ctxUsage = this.getContextUsage(lastRealUsage);
    onEnd?.(fullText, allToolCalls, ctxUsage);
  }

  /**
   * Calculate current context window usage percentage.
   * Prefers real usage from the API response (input = prompt tokens = actual
   * context consumption), falls back to estimating from message history.
   * @param {object} realUsage - Usage object from Pi's agent_end event
   * @returns {{ usagePct: number, promptTokens: number, contextWindow: number }}
   */
  getContextUsage(realUsage) {
    const contextWindow = this._contextWindow || DEFAULT_CONTEXT_WINDOW;

    // Prefer real usage from the API response.
    // Context window consumption = everything sent as prompt to the API:
    //   input (new tokens) + cacheRead (cached history) + cacheWrite (new cache writes)
    // This is the true context window occupancy.
    // Note: totalTokens includes output/completion tokens — not what we want here.
    if (realUsage) {
      const promptTokens = (realUsage.input || 0)
        + (realUsage.cacheRead || 0)
        + (realUsage.cacheWrite || 0);
      if (promptTokens > 0) {
        const usagePct = contextWindow > 0 ? Math.min(100, (promptTokens / contextWindow) * 100) : 0;
        return { usagePct, promptTokens, contextWindow };
      }

      // Fallback: totalTokens
      if (typeof realUsage.totalTokens === 'number' && realUsage.totalTokens > 0) {
        const usagePct = contextWindow > 0 ? Math.min(100, (realUsage.totalTokens / contextWindow) * 100) : 0;
        return { usagePct, promptTokens: realUsage.totalTokens, contextWindow };
      }
    }

    // Last resort: estimate from messages + system prompt
    let estTokens = 0;
    if (this._systemPrompt) {
      estTokens += Math.ceil(this._systemPrompt.length / CHARS_PER_TOKEN);
    }
    if (this._piAgent) {
      const msgs = this._piAgent.state.messages;
      for (const m of msgs) {
        if (typeof m.content === 'string') {
          estTokens += Math.ceil(m.content.length / CHARS_PER_TOKEN);
        } else if (Array.isArray(m.content)) {
          for (const part of m.content) {
            if (part.text) estTokens += Math.ceil(part.text.length / CHARS_PER_TOKEN);
          }
        }
      }
    }
    const usagePct = contextWindow > 0 ? Math.min(100, (estTokens / contextWindow) * 100) : 0;
    return { usagePct, promptTokens: estTokens, contextWindow };
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
