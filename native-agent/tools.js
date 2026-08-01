'use strict';

/**
 * Native Agent Tools — 内置工具定义
 *
 * 工具列表:
 *   terminal     — 执行 shell 命令
 *   file_read    — 读取文件
 *   file_write   — 写入文件
 *   file_search  — 搜索文件内容 (grep)
 *   web_search   — 网页搜索
 *   web_read     — 读取网页内容
 *   load_skill   — 加载 skill 全文
 *   memory_op    — 记忆操作 (add/remove/search)
 *   cloe_action  — 触发桌面动作 (smile/blink/kiss...)
 *   cloe_tts     — 文字转语音
 *
 * 工具定义格式兼容 OpenAI function calling:
 * { name, description, parameters, execute }
 *
 * execute 返回 string (会被包进 tool result message)。
 */

const { execFile, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

// Import sibling modules
const skills = require('./skills');
const memory = require('./memory');

// Helper: run shell command and return stdout
function runShell(cmd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 5, cwd: os.homedir() }, (err, stdout, stderr) => {
      if (err) {
        resolve(`Exit code ${err.code}\nSTDOUT: ${stdout || ''}\nSTDERR: ${stderr || err.message}`);
      } else {
        resolve(stdout || stderr || '(no output)');
      }
    });
  });
}

// Helper: HTTP GET
function httpGet(url, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'GET', headers, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}

// Helper: trigger Cloe Desktop action via bridge HTTP API
function triggerCloeAction(action, options = {}) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ action, ...options });
    const req = http.request(
      { hostname: '127.0.0.1', port: 19851, path: '/action', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 5000 },
      (res) => { let b=''; res.on('data', c=>b+=c); res.on('end', ()=>resolve(b)); }
    );
    req.on('error', () => resolve('action sent (no response)'));
    req.write(data);
    req.end();
  });
}

// Helper: TTS via bridge
function triggerTTS(text) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ action: 'speak', text });
    const req = http.request(
      { hostname: '127.0.0.1', port: 19851, path: '/action', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 10000 },
      (res) => { let b=''; res.on('data', c=>b+=c); res.on('end', ()=>resolve(b)); }
    );
    req.on('error', () => resolve('tts sent (no response)'));
    req.write(data);
    req.end();
  });
}

/**
 * Build the tool definitions array.
 * Returns OpenAI function-calling format.
 */
function buildToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'terminal',
        description: 'Execute a shell command. Returns stdout/stderr. Working directory is home.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            timeout: { type: 'integer', description: 'Timeout in seconds (default 30)', default: 30 },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_read',
        description: 'Read a text file. Returns content with line numbers.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative (to home) path' },
            offset: { type: 'integer', description: 'Start line (1-indexed)', default: 1 },
            limit: { type: 'integer', description: 'Max lines to read', default: 500 },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_write',
        description: 'Write content to a file. Overwrites existing.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
            content: { type: 'string', description: 'File content' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_search',
        description: 'Search file contents with regex (like grep). Returns matching lines.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regex pattern' },
            path: { type: 'string', description: 'Directory to search in', default: '.' },
            glob: { type: 'string', description: 'File glob filter (e.g. *.py)', default: '' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web. Returns top results with title/url/summary.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_read',
        description: 'Fetch and read a web page. Returns markdown content.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'load_skill',
        description: 'Load full instructions for a skill by name. Use when a skill matches the task.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Skill name (from the available skills list)' },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory',
        description: 'Store or recall durable facts. action: add/remove/search/render.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'remove', 'search', 'render'], description: 'Memory operation' },
            content: { type: 'string', description: 'For add: the fact to remember' },
            query: { type: 'string', description: 'For search: keyword' },
            category: { type: 'string', description: 'For add: user_pref/project/tool/general', default: 'general' },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cloe_action',
        description: 'Trigger a desktop character animation. Actions: smile, blink, kiss, nod, wave, think, tease, speak, shake_head, working, clap, shy, yawn, laugh, heart, pout, sigh.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'Action name' },
          },
          required: ['action'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cloe_tts',
        description: 'Convert text to speech and play it through the desktop character.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to speak' },
          },
          required: ['text'],
        },
      },
    },
  ];
}

/**
 * Execute a tool call by name.
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @returns {Promise<string>} Tool result text
 */
async function executeTool(name, args) {
  switch (name) {
    case 'terminal': {
      return await runShell(args.command, (args.timeout || 30) * 1000);
    }
    case 'file_read': {
      try {
        const p = args.path.startsWith('/') ? args.path : path.join(os.homedir(), args.path);
        const content = fs.readFileSync(p, 'utf-8');
        const lines = content.split('\n');
        const offset = Math.max(1, args.offset || 1);
        const limit = args.limit || 500;
        const sliced = lines.slice(offset - 1, offset - 1 + limit);
        return sliced.map((line, i) => `${offset + i}|${line}`).join('\n');
      } catch (e) {
        return `Error: ${e.message}`;
      }
    }
    case 'file_write': {
      try {
        const p = args.path.startsWith('/') ? args.path : path.join(os.homedir(), args.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, args.content, 'utf-8');
        return `Wrote ${args.content.length} chars to ${p}`;
      } catch (e) {
        return `Error: ${e.message}`;
      }
    }
    case 'file_search': {
      const cmd = `grep -rn --include='${args.glob || '*'}' '${args.pattern.replace(/'/g, "'\\''")}' '${args.path || '.'}' 2>/dev/null | head -50`;
      return await runShell(cmd, 15000);
    }
    case 'web_search': {
      // Use the MCP web search endpoint if available, otherwise fall back to a simple approach
      const result = await httpGet(
        `https://www.google.com/search?q=${encodeURIComponent(args.query)}&num=5`,
        { 'User-Agent': 'Mozilla/5.0' }
      );
      if (result.status === 0) return `Search failed: ${result.body}`;
      // Simple HTML → text extraction
      const text = result.body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                               .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                               .replace(/<[^>]+>/g, ' ')
                               .replace(/\s+/g, ' ')
                               .trim();
      return text.slice(0, 3000);
    }
    case 'web_read': {
      const result = await httpGet(args.url, { 'User-Agent': 'Mozilla/5.0' });
      if (result.status === 0) return `Fetch failed: ${result.body}`;
      const text = result.body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                               .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                               .replace(/<[^>]+>/g, ' ')
                               .replace(/\s+/g, ' ')
                               .trim();
      return text.slice(0, 5000);
    }
    case 'load_skill': {
      const body = skills.loadSkillBody(args.name);
      return body || `Skill "${args.name}" not found.`;
    }
    case 'memory': {
      switch (args.action) {
        case 'add': memory.add(args.content, args.category || 'general'); return 'Remembered.';
        case 'remove': return `Removed ${memory.remove(args.content || args.query || '')} entries.`;
        case 'search': return JSON.stringify(memory.search(args.query || ''), null, 2);
        case 'render': return memory.render() || '(no memories)';
        default: return `Unknown memory action: ${args.action}`;
      }
    }
    case 'cloe_action': {
      await triggerCloeAction(args.action);
      return `Action ${args.action} triggered.`;
    }
    case 'cloe_tts': {
      await triggerTTS(args.text);
      return 'TTS played.';
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Pi AgentTool 适配层 ──
// 把现有工具包装成 pi-agent-core 的 AgentTool 格式(TypeBox schema + execute)。
// 工具执行逻辑复用上面的 executeTool(),只改外层包装。

let _Type = null;
async function getType() {
  if (_Type) return _Type;
  const mod = await import('@earendil-works/pi-ai');
  _Type = mod.Type;
  return _Type;
}

// 工具的元信息(name/description/label/schema 定义),buildPiTools 和 buildToolDefinitions 共用
const TOOL_META = {
  terminal: {
    label: 'Terminal',
    description: 'Execute a shell command. Returns stdout/stderr. Working directory is home.',
    params: (T) => T.Object({
      command: T.String({ description: 'Shell command to execute' }),
      timeout: T.Optional(T.Integer({ description: 'Timeout in seconds (default 30)' })),
    }),
  },
  file_read: {
    label: 'Read File',
    description: 'Read a text file. Returns content with line numbers.',
    params: (T) => T.Object({
      path: T.String({ description: 'Absolute or relative (to home) path' }),
      offset: T.Optional(T.Integer({ description: 'Start line (1-indexed)' })),
      limit: T.Optional(T.Integer({ description: 'Max lines to read' })),
    }),
  },
  file_write: {
    label: 'Write File',
    description: 'Write content to a file. Overwrites existing.',
    params: (T) => T.Object({
      path: T.String({ description: 'File path' }),
      content: T.String({ description: 'File content' }),
    }),
  },
  file_search: {
    label: 'Search Files',
    description: 'Search file contents with regex (like grep). Returns matching lines.',
    params: (T) => T.Object({
      pattern: T.String({ description: 'Regex pattern' }),
      path: T.Optional(T.String({ description: 'Directory to search in' })),
      glob: T.Optional(T.String({ description: 'File glob filter (e.g. *.py)' })),
    }),
  },
  web_search: {
    label: 'Web Search',
    description: 'Search the web. Returns top results with title/url/summary.',
    params: (T) => T.Object({
      query: T.String({ description: 'Search query' }),
    }),
  },
  web_read: {
    label: 'Read Web Page',
    description: 'Fetch and read a web page. Returns text content.',
    params: (T) => T.Object({
      url: T.String({ description: 'URL to fetch' }),
    }),
  },
  load_skill: {
    label: 'Load Skill',
    description: 'Load full instructions for a skill by name. Use when a skill matches the task.',
    params: (T) => T.Object({
      name: T.String({ description: 'Skill name (from the available skills list)' }),
    }),
  },
  memory: {
    label: 'Memory',
    description: 'Store or recall durable facts. action: add/remove/search/render.',
    params: (T) => T.Object({
      action: T.Enum({ add: 'add', remove: 'remove', search: 'search', render: 'render' }, { description: 'Memory operation' }),
      content: T.Optional(T.String({ description: 'For add: the fact to remember' })),
      query: T.Optional(T.String({ description: 'For search: keyword' })),
      category: T.Optional(T.String({ description: 'For add: user_pref/project/tool/general' })),
    }),
  },
  cloe_action: {
    label: 'Cloe Action',
    description: 'Trigger a desktop character animation. Actions: smile, blink, kiss, nod, wave, think, tease, speak, shake_head, working, clap, shy, yawn, laugh, heart, pout, sigh.',
    params: (T) => T.Object({
      action: T.String({ description: 'Action name' }),
    }),
  },
  cloe_tts: {
    label: 'Cloe TTS',
    description: 'Convert text to speech and play it through the desktop character.',
    params: (T) => T.Object({
      text: T.String({ description: 'Text to speak' }),
    }),
  },
};

function getToolEmoji(toolName) {
  const map = {
    terminal: '💻',
    file_read: '📄',
    file_write: '✏️',
    file_search: '🔍',
    web_search: '🌐',
    web_read: '📖',
    load_skill: '📚',
    memory: '🧠',
    cloe_action: '✨',
    cloe_tts: '🔊',
  };
  return map[toolName] || '🔧';
}

function formatToolLabel(toolName, args = {}) {
  switch (toolName) {
    case 'terminal': return args.command || '';
    case 'file_read': return args.path || '';
    case 'file_write': return args.path || '';
    case 'file_search': return args.pattern || '';
    case 'web_search': return args.query || '';
    case 'web_read': return args.url || '';
    case 'load_skill': return args.name || '';
    case 'memory': return `${args.action || ''} ${args.content || args.query || ''}`.trim();
    case 'cloe_action': return args.action || '';
    case 'cloe_tts': return (args.text || '').slice(0, 40);
    default: return '';
  }
}

/**
 * Build tool definitions in Pi AgentTool format.
 * Returns a Promise (needs async TypeBox Type import).
 */
async function buildPiTools() {
  const T = await getType();
  const tools = [];
  for (const [name, meta] of Object.entries(TOOL_META)) {
    tools.push({
      name,
      label: meta.label,
      description: meta.description,
      parameters: meta.params(T),
      async execute(_toolCallId, args) {
        const result = await executeTool(name, args);
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
          details: { tool: name, args },
        };
      },
    });
  }
  return tools;
}

module.exports = {
  buildToolDefinitions,
  buildPiTools,
  executeTool,
  getToolEmoji,
  formatToolLabel,
};
