'use strict';

/**
 * Web Search Engine — 多 Provider 搜索架构
 *
 * 支持的 Provider:
 *   1. zhipu_mcp  — 智谱 MCP Streamable HTTP (web_search_prime + web_reader)
 *   2. tavily     — Tavily Search API (国外，效果好)
 *   3. ddg        — DuckDuckGo HTML (免费兜底，无需 API Key)
 *   4. bing       — Bing Search API (Azure)
 *   5. serpapi    — SerpAPI (Google 代理)
 *
 * 所有 Provider 统一返回格式:
 *   search() → [{ title, url, snippet }]
 *   read()   → { title, content (markdown) }
 *
 * 配置在 ~/.cloe/native-agent.json → webSearch 段。
 */

const http = require('http');
const https = require('https');
const config = require('./config');

// ── HTTP helpers ──

function httpRequest(method, url, { headers = {}, body = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers },
      timeout: timeoutMs,
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);

    const req = lib.request(opts, (res) => {
      let data = '';
      // Follow redirects (up to 5)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        resolve(httpRequest(method, redirectUrl, { headers, body, timeoutMs }));
        return;
      }
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message, headers: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout', headers: {} }); });
    if (body) req.write(body);
    req.end();
  });
}

// ── 获取 webSearch 配置 ──
function getWebSearchConfig() {
  const cfg = config.loadConfig();
  return cfg.webSearch || { provider: 'zhipu_mcp', providers: {} };
}

// ── 提取 SSE event data ──
function parseSSE(rawText) {
  // SSE 格式: id:1\nevent:message\ndata:{...}\n\n
  const lines = rawText.split('\n');
  let dataLine = '';
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLine = line.slice(5);
    }
  }
  if (!dataLine) {
    // 可能不是 SSE，尝试直接 JSON parse
    try { return JSON.parse(rawText); } catch { return null; }
  }
  try { return JSON.parse(dataLine); } catch { return null; }
}

// ══════════════════════════════════════════════
// Provider 1: 智谱 MCP (web_search_prime + web_reader)
// ══════════════════════════════════════════════

const zhipuMcp = {
  async search(query, opts = {}) {
    const wsConfig = getWebSearchConfig();
    const pConfig = wsConfig.providers?.zhipu_mcp || {};
    const apiKey = pConfig.apiKey || config.loadConfig().providers?.zhipu?.apiKey || '';
    if (!apiKey) throw new Error('Zhipu MCP: apiKey not configured');

    const searchURL = pConfig.searchURL || 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp';

    // Step 1: Initialize MCP session
    const initResp = await httpRequest('POST', searchURL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2024-11-05',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cloe-desktop', version: '1.0' } },
        id: 1,
      }),
    });
    if (initResp.status === 0) throw new Error(`Zhipu MCP init failed: ${initResp.body}`);
    const sessionId = initResp.headers['mcp-session-id'];
    if (!sessionId) throw new Error('Zhipu MCP: no session id returned');

    // Step 2: Call web_search_prime
    const args = {
      search_query: query,
      content_size: opts.contentSize || 'medium',
      location: opts.location || 'cn',
    };
    if (opts.recency) args.search_recency_filter = opts.recency;

    const callResp = await httpRequest('POST', searchURL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2024-11-05',
        'MCP-Session-Id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'tools/call',
        params: { name: 'web_search_prime', arguments: args },
        id: 2,
      }),
    });

    if (callResp.status === 0) throw new Error(`Zhipu MCP call failed: ${callResp.body}`);
    const parsed = parseSSE(callResp.body);
    if (!parsed?.result?.content?.[0]?.text) throw new Error('Zhipu MCP: empty result');

    // Result text is double-encoded JSON: MCP text field → JSON string → array
    const rawText = parsed.result.content[0].text;
    let results;
    try {
      // First parse: unwrap the outer JSON string literal
      let unwrapped = JSON.parse(rawText);
      // If still a string, parse again
      if (typeof unwrapped === 'string') unwrapped = JSON.parse(unwrapped);
      results = Array.isArray(unwrapped) ? unwrapped : [unwrapped];
    } catch {
      return [{ title: 'Search Result', url: '', snippet: rawText.slice(0, 500) }];
    }

    return results.map(r => ({
      title: r.title || '',
      url: r.link || r.url || '',
      snippet: r.content || r.snippet || '',
    }));
  },

  async read(url, opts = {}) {
    const wsConfig = getWebSearchConfig();
    const pConfig = wsConfig.providers?.zhipu_mcp || {};
    const apiKey = pConfig.apiKey || config.loadConfig().providers?.zhipu?.apiKey || '';
    if (!apiKey) throw new Error('Zhipu MCP reader: apiKey not configured');

    const readerURL = pConfig.readerURL || 'https://open.bigmodel.cn/api/mcp/web_reader/mcp';

    // Initialize
    const initResp = await httpRequest('POST', readerURL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2024-11-05',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cloe-desktop', version: '1.0' } },
        id: 1,
      }),
    });
    if (initResp.status === 0) throw new Error(`Zhipu reader init failed: ${initResp.body}`);
    const sessionId = initResp.headers['mcp-session-id'];

    // Call webReader
    const args = {
      url,
      return_format: 'markdown',
      timeout: opts.timeout || 20,
    };

    const callResp = await httpRequest('POST', readerURL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2024-11-05',
        'MCP-Session-Id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'tools/call',
        params: { name: 'webReader', arguments: args },
        id: 2,
      }),
      timeoutMs: 30000,
    });

    if (callResp.status === 0) throw new Error(`Zhipu reader call failed: ${callResp.body}`);
    const parsed = parseSSE(callResp.body);
    if (!parsed?.result?.content?.[0]?.text) throw new Error('Zhipu reader: empty result');

    const rawText = parsed.result.content[0].text;
    // The reader may return a JSON object or plain text
    let title = '';
    let content = rawText;
    try {
      let unwrapped = JSON.parse(rawText);
      if (typeof unwrapped === 'string') unwrapped = JSON.parse(unwrapped);
      if (typeof unwrapped === 'object' && unwrapped !== null) {
        title = unwrapped.title || '';
        content = unwrapped.content || unwrapped.text || rawText;
      }
    } catch {
      // plain text, use as-is
    }
    return { title, content: content.slice(0, 8000) };
  },
};

// ══════════════════════════════════════════════
// Provider 2: Tavily Search API
// ══════════════════════════════════════════════

const tavily = {
  async search(query, opts = {}) {
    const wsConfig = getWebSearchConfig();
    const pConfig = wsConfig.providers?.tavily || {};
    const apiKey = pConfig.apiKey || '';
    if (!apiKey) throw new Error('Tavily: apiKey not configured');

    const resp = await httpRequest('POST', 'https://api.tavily.com/search', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: opts.maxResults || 5,
        search_depth: opts.searchDepth || 'basic',
        include_answer: true,
      }),
    });

    if (resp.status !== 200) throw new Error(`Tavily error: ${resp.status} ${resp.body}`);
    const data = JSON.parse(resp.body);

    const results = [];
    if (data.answer) results.push({ title: 'AI Answer', url: '', snippet: data.answer });
    for (const r of data.results || []) {
      results.push({ title: r.title || '', url: r.url || '', snippet: r.content || '' });
    }
    return results;
  },

  async read(url) {
    // Tavily extract API
    const wsConfig = getWebSearchConfig();
    const pConfig = wsConfig.providers?.tavily || {};
    const apiKey = pConfig.apiKey || '';
    if (!apiKey) throw new Error('Tavily: apiKey not configured');

    const resp = await httpRequest('POST', 'https://api.tavily.com/extract', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, urls: [url] }),
    });
    if (resp.status !== 200) throw new Error(`Tavily extract error: ${resp.status}`);
    const data = JSON.parse(resp.body);
    const result = data.results?.[0];
    return { title: result?.title || '', content: (result?.raw_content || result?.text || '').slice(0, 8000) };
  },
};

// ══════════════════════════════════════════════
// Provider 3: DuckDuckGo HTML (免费，无需 API Key)
// ══════════════════════════════════════════════

const ddg = {
  async search(query, opts = {}) {
    const region = opts.location === 'us' ? 'us-en' : 'cn-zh';
    const resp = await httpRequest('GET',
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${region}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
    );
    if (resp.status === 0) throw new Error(`DuckDuckGo failed: ${resp.body}`);

    const html = resp.body;
    const results = [];
    // Parse DuckDuckGo HTML results
    const linkRegex = /class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
    const snippetRegex = /class="result__snippet"[^>]*>(.*?)<\/(?:a|td|div)>/gs;
    const links = [...html.matchAll(linkRegex)];
    const snippets = [...html.matchAll(snippetRegex)];

    for (let i = 0; i < Math.min(links.length, opts.maxResults || 5); i++) {
      const title = links[i][2].replace(/<[^>]+>/g, '').trim();
      // DDG wraps URLs in a redirect
      let url = links[i][1];
      const uddgMatch = url.match(/uddg=([^&]+)/);
      if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
      const snippet = (snippets[i]?.[1] || '').replace(/<[^>]+>/g, '').trim();
      results.push({ title, url, snippet });
    }

    if (results.length === 0) throw new Error('DuckDuckGo: no results (may be rate-limited)');
    return results;
  },

  async read(url) {
    const resp = await httpRequest('GET', url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (resp.status === 0) throw new Error(`DuckDuckGo read failed: ${resp.body}`);
    const text = resp.body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    // Extract title
    const titleMatch = text.match(/^(.{0,100})/);
    return { title: titleMatch?.[0] || '', content: text.slice(0, 8000) };
  },
};

// ══════════════════════════════════════════════
// Provider 4: Bing Search API (Azure)
// ══════════════════════════════════════════════

const bing = {
  async search(query, opts = {}) {
    const wsConfig = getWebSearchConfig();
    const pConfig = wsConfig.providers?.bing || {};
    const apiKey = pConfig.apiKey || '';
    if (!apiKey) throw new Error('Bing: apiKey not configured');
    const endpoint = pConfig.endpoint || 'https://api.bing.microsoft.com/v7.0/search';

    const resp = await httpRequest('GET',
      `${endpoint}?q=${encodeURIComponent(query)}&count=${opts.maxResults || 5}&mkt=${opts.location === 'us' ? 'en-US' : 'zh-CN'}`,
      { headers: { 'Ocp-Apim-Subscription-Key': apiKey } }
    );
    if (resp.status !== 200) throw new Error(`Bing error: ${resp.status}`);
    const data = JSON.parse(resp.body);

    return (data.webPages?.value || []).map(r => ({
      title: r.name || '',
      url: r.url || '',
      snippet: r.snippet || '',
    }));
  },

  async read(url) {
    // Bing doesn't have a reader API, fall back to direct fetch
    return ddg.read(url);
  },
};

// ══════════════════════════════════════════════
// Provider 5: SerpAPI (Google 代理)
// ══════════════════════════════════════════════

const serpapi = {
  async search(query, opts = {}) {
    const wsConfig = getWebSearchConfig();
    const pConfig = wsConfig.providers?.serpapi || {};
    const apiKey = pConfig.apiKey || '';
    if (!apiKey) throw new Error('SerpAPI: apiKey not configured');

    const engine = pConfig.engine || 'google';
    const gl = opts.location === 'us' ? 'us' : 'cn';
    const hl = opts.location === 'us' ? 'en' : 'zh-cn';

    const resp = await httpRequest('GET',
      `https://serpapi.com/search.json?engine=${engine}&q=${encodeURIComponent(query)}&api_key=${apiKey}&gl=${gl}&hl=${hl}&num=${opts.maxResults || 5}`
    );
    if (resp.status !== 200) throw new Error(`SerpAPI error: ${resp.status}`);
    const data = JSON.parse(resp.body);

    return (data.organic_results || []).map(r => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
    }));
  },

  async read(url) {
    return ddg.read(url);
  },
};

// ══════════════════════════════════════════════
// Provider Registry
// ══════════════════════════════════════════════

const PROVIDERS = {
  zhipu_mcp: { name: '智谱 MCP (推荐)', ...zhipuMcp },
  tavily:    { name: 'Tavily', ...tavily },
  ddg:       { name: 'DuckDuckGo (免费)', ...ddg },
  bing:      { name: 'Bing API', ...bing },
  serpapi:   { name: 'SerpAPI (Google)', ...serpapi },
};

const PROVIDER_META = {
  zhipu_mcp: { label: '智谱 MCP', needsApiKey: true, apiKeyLabel: '智谱 API Key', extra: {} },
  tavily:    { label: 'Tavily', needsApiKey: true, apiKeyLabel: 'Tavily API Key', extra: {} },
  ddg:       { label: 'DuckDuckGo', needsApiKey: false, apiKeyLabel: '', extra: {} },
  bing:      { label: 'Bing API', needsApiKey: true, apiKeyLabel: 'Bing Subscription Key', extra: { endpoint: 'Bing Endpoint' } },
  serpapi:   { label: 'SerpAPI', needsApiKey: true, apiKeyLabel: 'SerpAPI Key', extra: { engine: '搜索引擎 (google/bing/baidu)' } },
};

// ══════════════════════════════════════════════
// Public API
// ══════════════════════════════════════════════

/**
 * Execute a web search using the configured provider.
 * @param {string} query - Search query
 * @param {object} opts - Options (contentSize, location, maxResults, etc.)
 * @returns {Promise<Array<{title,url,snippet}>>}
 */
async function search(query, opts = {}) {
  const wsConfig = getWebSearchConfig();
  const providerName = wsConfig.provider || 'zhipu_mcp';
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown web search provider: ${providerName}`);

  return provider.search(query, opts);
}

/**
 * Read a web page using the configured provider.
 * @param {string} url - URL to read
 * @param {object} opts - Options
 * @returns {Promise<{title,content}>}
 */
async function read(url, opts = {}) {
  const wsConfig = getWebSearchConfig();
  const providerName = wsConfig.provider || 'zhipu_mcp';
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown web search provider: ${providerName}`);

  return provider.read(url, opts);
}

/**
 * Get available providers metadata (for UI).
 */
function getProviders() {
  return PROVIDER_META;
}

module.exports = {
  search,
  read,
  getProviders,
  PROVIDER_META,
};
