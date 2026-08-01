'use strict';

/**
 * Native Agent Tools — 内置工具定义
 *
 * 工具列表:
 *   terminal     — 执行 shell 命令
 *   file_read    — 读取文件
 *   file_write   — 写入文件
 *   file_search  — 搜索文件内容 (grep)
 *   web_search   — 网页搜索 (多 provider: zhipu_mcp / tavily / ddg / bing / serpapi)
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
const webSearch = require('./web-search');

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

// Helper: HTTP GET (kept for legacy/internal use)
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

// Helper: TTS via bridge POST /tts/generate
// The bridge reads ~/.cloe/tts-config.json, calls the TTS API (MOSI),
// converts WAV→MP3, saves to audio_cache, and triggers speak.
// No external scripts or Python dependency — fully self-contained.
function triggerTTS(text) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ text, speak: true });
    const req = http.request(
      { hostname: '127.0.0.1', port: 19851, path: '/tts/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 25000 },
      (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            if (result.ok) resolve('TTS played.');
            else resolve('TTS failed: ' + (result.error || 'unknown'));
          } catch {
            resolve('TTS played.');
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve('TTS timed out.'); });
    req.on('error', (e) => resolve('TTS error: ' + e.message));
    req.write(data);
    req.end();
  });
}

// Helper: resolve a path relative to home
function resolvePath(p) {
  if (!p) return p;
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  if (p.startsWith('/')) return p;
  return path.join(os.homedir(), p);
}

// Directories to exclude from list_files
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'release', '.vite', '__pycache__', '.DS_Store']);

/**
 * Apply text-based edits to a file (exact match replacement).
 * Each edit.oldText must match exactly once in the file.
 * @returns {{ applied: number, skipped: Array, summary: string }}
 */
function applyFileEdits(filePath, edits) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let applied = 0;
  const skipped = [];

  for (const edit of edits) {
    const { oldText, newText } = edit;
    if (!oldText) { skipped.push({ reason: 'empty oldText' }); continue; }

    // Count occurrences (normalize line endings for matching)
    const count = content.split(oldText).length - 1;
    if (count === 0) {
      skipped.push({ oldText: oldText.slice(0, 60), reason: 'not found' });
      continue;
    }
    if (count > 1) {
      skipped.push({ oldText: oldText.slice(0, 60), reason: `matched ${count} times — add more context for uniqueness` });
      continue;
    }
    content = content.replace(oldText, newText);
    applied++;
  }

  if (applied > 0) {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  const summary = `Applied ${applied} edit(s)${skipped.length ? `, skipped ${skipped.length}` : ''}.`;
  return { applied, skipped, summary };
}

/**
 * List files in a directory as a tree.
 * @param {string} dir - Directory path
 * @param {boolean} recursive - Include subdirectories
 * @param {number} maxDepth - Max depth
 * @param {number} currentDepth
 * @returns {string} Tree-formatted string
 */
function listFilesTree(dir, recursive, maxDepth, currentDepth = 0) {
  const indent = '  '.repeat(currentDepth);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return `${indent}(cannot read directory)`;
  }

  // Filter out excluded dirs/files
  entries = entries.filter(e => !EXCLUDED_DIRS.has(e.name) && !e.name.startsWith('.'));
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const lines = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      lines.push(`${indent}📁 ${entry.name}/`);
      if (recursive && currentDepth < maxDepth) {
        const sub = listFilesTree(fullPath, recursive, maxDepth, currentDepth + 1);
        if (sub) lines.push(sub);
      }
    } else {
      lines.push(`${indent}📄 ${entry.name}`);
    }
  }
  return lines.join('\n');
}

/**
 * Check JS/JSX/TS syntax after writing/editing.
 * @returns {string|null} error message or null if OK
 */
async function checkSyntax(filePath) {
  if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(filePath)) return null;
  const result = await runShell(`node -c "${filePath}"`, 10000);
  if (/SyntaxError|Unexpected token/i.test(result)) {
    return result.split('\n').slice(0, 3).join('\n');
  }
  return null;
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
        description: 'Write content to a file. Overwrites existing. Use file_edit for partial changes.',
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
        name: 'file_edit',
        description: 'Edit a file by replacing exact text matches. Each edit must match uniquely in the file. Returns a diff summary. Prefer this over file_write for targeted changes.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
            edits: {
              type: 'array',
              description: 'List of text replacements to apply',
              items: {
                type: 'object',
                properties: {
                  oldText: { type: 'string', description: 'Exact text to find (include enough context lines for uniqueness)' },
                  newText: { type: 'string', description: 'Replacement text' },
                },
                required: ['oldText', 'newText'],
              },
            },
          },
          required: ['path', 'edits'],
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
        name: 'list_files',
        description: 'List files in a directory. Returns a tree structure. Excludes node_modules/.git/dist.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path (default ~)', default: '~' },
            recursive: { type: 'boolean', description: 'Include subdirectories', default: false },
            maxDepth: { type: 'integer', description: 'Max depth when recursive (default 2)', default: 2 },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web. Returns top results with title/url/snippet.',
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
        description: 'Store or recall durable facts. action: add/remove/search/render. Categories: user_pref (never forget), project, tool, general.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'remove', 'search', 'render'], description: 'Memory operation' },
            content: { type: 'string', description: 'For add: the fact to remember' },
            query: { type: 'string', description: 'For search: keyword' },
            category: { type: 'string', enum: ['user_pref', 'project', 'tool', 'general'], description: 'For add: memory category', default: 'general' },
            tags: { type: 'string', description: 'For add: comma-separated tags (e.g. "name,personal")', default: '' },
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
        const p = resolvePath(args.path);
        const content = fs.readFileSync(p, 'utf-8');
        const lines = content.split('\n');
        const offset = Math.max(1, args.offset || 1);
        const limit = args.limit || 500;
        const sliced = lines.slice(offset - 1, offset - 1 + limit);
        const result = sliced.map((line, i) => `${offset + i}|${line}`).join('\n');
        // If there are more lines beyond what we returned, hint the LLM
        const remaining = lines.length - (offset - 1 + sliced.length);
        if (remaining > 0) {
          return result + `\n\n... (${remaining} more lines, use offset=${offset + sliced.length} to read more)`;
        }
        return result;
      } catch (e) {
        return `Error: ${e.message}`;
      }
    }
    case 'file_write': {
      try {
        const p = resolvePath(args.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, args.content, 'utf-8');
        let result = `Wrote ${args.content.length} chars to ${p}`;
        // Auto syntax check for JS/TS files
        const syntaxErr = await checkSyntax(p);
        if (syntaxErr) result += `\n\n⚠️ Syntax check failed:\n${syntaxErr}`;
        return result;
      } catch (e) {
        return `Error: ${e.message}`;
      }
    }
    case 'file_edit': {
      try {
        const p = resolvePath(args.path);
        const edits = Array.isArray(args.edits) ? args.edits : [];
        const { applied, skipped, summary } = applyFileEdits(p, edits);
        let result = summary;
        if (skipped.length > 0) {
          result += '\nSkipped edits:\n' + skipped.map(s =>
            `  - "${s.oldText || '?'}": ${s.reason}`
          ).join('\n');
        }
        // Auto syntax check if any edit was applied
        if (applied > 0) {
          const syntaxErr = await checkSyntax(p);
          if (syntaxErr) result += `\n\n⚠️ Syntax check failed:\n${syntaxErr}`;
        }
        return result;
      } catch (e) {
        return `Error: ${e.message}`;
      }
    }
    case 'file_search': {
      const cmd = `grep -rn --include='${args.glob || '*'}' '${args.pattern.replace(/'/g, "'\\''")}' '${args.path || '.'}' 2>/dev/null | head -50`;
      return await runShell(cmd, 15000);
    }
    case 'list_files': {
      try {
        const dir = resolvePath(args.path || '~');
        const recursive = args.recursive !== false;
        const maxDepth = args.maxDepth || 2;
        const tree = listFilesTree(dir, recursive, maxDepth);
        return tree || '(empty directory)';
      } catch (e) {
        return `Error: ${e.message}`;
      }
    }
    case 'web_search': {
      try {
        const results = await webSearch.search(args.query, {
          maxResults: 5,
          contentSize: 'medium',
        });
        if (!results || results.length === 0) return 'No results found.';
        return results.map((r, i) =>
          `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`
        ).join('\n\n');
      } catch (e) {
        return `Web search failed: ${e.message}`;
      }
    }
    case 'web_read': {
      try {
        const result = await webSearch.read(args.url);
        const header = result.title ? `# ${result.title}\n\n` : '';
        return header + result.content;
      } catch (e) {
        return `Web read failed: ${e.message}`;
      }
    }
    case 'load_skill': {
      const body = skills.loadSkillBody(args.name);
      return body || `Skill "${args.name}" not found.`;
    }
    case 'memory': {
      switch (args.action) {
        case 'add': {
          const entry = memory.add(args.content, args.category || 'general', args.tags || '');
          return `Remembered [${entry.category}]${entry.tags?.length ? ' #' + entry.tags.join(' #') : ''}: ${entry.content.slice(0, 80)}`;
        }
        case 'remove': return `Removed ${memory.remove(args.content || args.query || '')} entries.`;
        case 'search': {
          const results = memory.search(args.query || '');
          if (!results.length) return 'No matching memories.';
          return results.map(e => `[${e.category}] (trust:${e.trust.toFixed(2)}) ${e.content}`).join('\n');
        }
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
    description: 'Write content to a file. Overwrites existing. Use file_edit for partial changes.',
    params: (T) => T.Object({
      path: T.String({ description: 'File path' }),
      content: T.String({ description: 'File content' }),
    }),
  },
  file_edit: {
    label: 'Edit File',
    description: 'Edit a file by replacing exact text matches. Each edit must match uniquely in the file. Returns a diff summary. Prefer this over file_write for targeted changes.',
    params: (T) => T.Object({
      path: T.String({ description: 'File path' }),
      edits: T.Array(T.Object({
        oldText: T.String({ description: 'Exact text to find (include enough context lines for uniqueness)' }),
        newText: T.String({ description: 'Replacement text' }),
      })),
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
  list_files: {
    label: 'List Files',
    description: 'List files in a directory. Returns a tree structure. Excludes node_modules/.git/dist.',
    params: (T) => T.Object({
      path: T.Optional(T.String({ description: 'Directory path (default ~)' })),
      recursive: T.Optional(T.Boolean({ description: 'Include subdirectories' })),
      maxDepth: T.Optional(T.Integer({ description: 'Max depth when recursive (default 2)' })),
    }),
  },
  web_search: {
    label: 'Web Search',
    description: 'Search the web using the configured provider (zhipu_mcp/tavily/ddg/bing/serpapi). Returns top results with title/url/snippet.',
    params: (T) => T.Object({
      query: T.String({ description: 'Search query' }),
    }),
  },
  web_read: {
    label: 'Read Web Page',
    description: 'Fetch and read a web page. Returns markdown content via the configured provider.',
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
    description: 'Store or recall durable facts. action: add/remove/search/render. Categories: user_pref (never forget), project, tool, general.',
    params: (T) => T.Object({
      action: T.Enum({ add: 'add', remove: 'remove', search: 'search', render: 'render' }, { description: 'Memory operation' }),
      content: T.Optional(T.String({ description: 'For add: the fact to remember' })),
      query: T.Optional(T.String({ description: 'For search: keyword' })),
      category: T.Optional(T.Enum({ user_pref: 'user_pref', project: 'project', tool: 'tool', general: 'general' }, { description: 'For add: memory category' })),
      tags: T.Optional(T.String({ description: 'For add: comma-separated tags' })),
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
    file_edit: '📝',
    file_search: '🔍',
    list_files: '📂',
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
    case 'file_edit': return `${args.path || ''} (${Array.isArray(args.edits) ? args.edits.length : 0} edits)`;
    case 'file_search': return args.pattern || '';
    case 'list_files': return args.path || '~';
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
  TOOL_META,
};
