// ==================== Cloe Settings — Native Agent Tab ====================

const API_NATIVE = 'http://127.0.0.1:19851';

let _nativeCfg = null;
let _nativeProvider = '';
let _nativeFetchedModels = [];
let _nativeInited = false;
let _wsProviders = null;       // web search provider metadata
let _wsCurrentProvider = '';   // current web search provider name
let _contextDefaults = {};     // built-in model→context-window table (from server)

function initNativeAgentTab() {
  if (_nativeInited) { renderNativeAgent(); return; }
  _nativeInited = true;
  loadNativeAgentConfig();
}

async function loadNativeAgentConfig() {
  const container = document.getElementById('native-agent-content');
  container.innerHTML = `<div class="loading"><div class="spinner"></div><p>${I18n.t('nativeAgent.loading')}</p></div>`;
  try {
    const resp = await fetch(`${API_NATIVE}/native-agent/config`);
    _nativeCfg = await resp.json();
    // Pop read-only helper: built-in context-window table (don't persist on save).
    _contextDefaults = _nativeCfg._contextDefaults || {};
    delete _nativeCfg._contextDefaults;
    _nativeProvider = _nativeCfg.provider || Object.keys(_nativeCfg.providers || {})[0] || '';
    _nativeFetchedModels = _nativeCfg.providers?.[_nativeProvider]?.models || [];

    // Load web search provider metadata
    try {
      const wsResp = await fetch(`${API_NATIVE}/native-agent/web-search/providers`);
      _wsProviders = await wsResp.json();
    } catch { _wsProviders = {}; }
    // Ensure webSearch exists in config
    if (!_nativeCfg.webSearch) {
      _nativeCfg.webSearch = { provider: 'zhipu_mcp', providers: {} };
    }
    _wsCurrentProvider = _nativeCfg.webSearch.provider || 'zhipu_mcp';

    renderNativeAgent();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>${I18n.t('nativeAgent.loadFailed')}</p><p class="sub">${e.message}</p></div>`;
  }
}

/**
 * Resolve a model's context window for display.
 * Priority: user override (cfg.contextWindows) > built-in table > 128000 fallback.
 */
function resolveContextWindow(modelId) {
  if (!modelId) return 128000;
  const overrides = _nativeCfg.contextWindows || {};
  if (typeof overrides[modelId] === 'number' && overrides[modelId] > 0) return overrides[modelId];
  if (_contextDefaults[modelId]) return _contextDefaults[modelId];
  return 128000;
}

/** Update the context-window input to reflect a newly selected model. */
function refreshContextWindowInput(modelId) {
  const input = document.getElementById('na-context-window');
  if (input) input.value = resolveContextWindow(modelId);
}

function renderNativeAgent() {
  const container = document.getElementById('native-agent-content');
  if (!_nativeCfg) return;
  const providerNames = Object.keys(_nativeCfg.providers || {});
  const p = _nativeCfg.providers?.[_nativeProvider] || { baseURL: '', apiKey: '', models: [] };
  const currentModel = _nativeCfg.model || '';

  // Merge fetched models + stored models + current
  const allModels = [...new Set([..._nativeFetchedModels, ...(p.models || []), currentModel].filter(Boolean))].sort();

  // ── Web Search section data ──
  const wsProviderKeys = Object.keys(_wsProviders || {});
  const wsP = _nativeCfg.webSearch?.providers?.[_wsCurrentProvider] || {};

  container.innerHTML = `
    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('nativeAgent.title')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('nativeAgent.provider')}</div>
            <div class="pref-desc">${I18n.t('nativeAgent.providerDesc')}</div>
          </div>
          <div class="pref-control">
            <select id="na-provider" class="form-select" style="min-width:180px;">
              ${providerNames.map(n => `<option value="${n}" ${n === _nativeProvider ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('nativeAgent.baseURL')}</div>
            <div class="pref-desc">${I18n.t('nativeAgent.baseURLDesc')}</div>
          </div>
          <div class="pref-control">
            <input id="na-base-url" type="text" class="form-input" style="min-width:280px;" value="${p.baseURL || ''}" placeholder="${I18n.t('nativeAgent.baseURLPlaceholder')}" autocomplete="off" spellcheck="false">
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('nativeAgent.apiKey')}</div>
            <div class="pref-desc">${I18n.t('nativeAgent.apiKeyDesc')}</div>
          </div>
          <div class="pref-control">
            <div class="pref-api-key-wrap">
              <input id="na-api-key" type="password" class="form-input" style="min-width:280px;" value="${p.apiKey || ''}" placeholder="${I18n.t('nativeAgent.apiKeyPlaceholder')}" autocomplete="off" spellcheck="false">
              <button type="button" class="btn-icon btn-icon-sm" id="na-key-toggle" title="${I18n.t('nativeAgent.keyToggle')}">👁</button>
            </div>
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('nativeAgent.model')}</div>
            <div class="pref-desc">${I18n.t('nativeAgent.modelDesc')}</div>
          </div>
          <div class="pref-control" style="min-width:280px;">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
              <select id="na-model-select" class="form-select" style="flex:1;">
                ${allModels.map(m => `<option value="${m}" ${m === currentModel ? 'selected' : ''}>${m}</option>`).join('')}
                ${currentModel && !allModels.includes(currentModel) ? `<option value="${currentModel}" selected>${currentModel}</option>` : ''}
              </select>
              <input id="na-model-input" type="text" class="form-input" style="flex:1;" value="${currentModel}" placeholder="${I18n.t('nativeAgent.modelInputPlaceholder')}">
            </div>
            <button type="button" class="btn btn-secondary btn-sm" id="na-fetch-btn">${I18n.t('nativeAgent.fetchModels')}</button>
            <span id="na-fetch-status" style="font-size:11px;margin-left:8px;"></span>
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('nativeAgent.contextWindow')}</div>
            <div class="pref-desc">${I18n.t('nativeAgent.contextWindowDesc')}</div>
          </div>
          <div class="pref-control">
            <input id="na-context-window" type="number" min="1000" step="1000" class="form-input" style="min-width:200px;" value="${resolveContextWindow(currentModel)}" placeholder="${I18n.t('nativeAgent.contextWindowPlaceholder')}" autocomplete="off">
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('nativeAgent.soulPath')}</div>
            <div class="pref-desc">${I18n.t('nativeAgent.soulPathDesc')}</div>
          </div>
          <div class="pref-control">
            <input id="na-soul-path" type="text" class="form-input" style="min-width:280px;" value="${_nativeCfg.soulPath || ''}" placeholder="${I18n.t('nativeAgent.soulPathPlaceholder')}" autocomplete="off" spellcheck="false">
          </div>
        </div>
      </div>
    </div>

    <div class="pref-section">
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label"></div>
          </div>
          <div class="pref-control">
            <button type="button" class="btn btn-primary btn-sm" id="na-save-btn">${I18n.t('nativeAgent.save')}</button>
            <span id="na-save-status" style="font-size:12px;margin-left:8px;"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Web Search Configuration ═══ -->
    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('nativeAgent.webSearchTitle')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('nativeAgent.wsProvider')}</div>
            <div class="pref-desc">${I18n.t('nativeAgent.wsProviderDesc')}</div>
          </div>
          <div class="pref-control">
            <select id="ws-provider" class="form-select" style="min-width:200px;">
              ${wsProviderKeys.map(k => {
                const meta = _wsProviders[k] || {};
                const label = meta.label || k;
                const note = meta.needsApiKey ? '' : ' ' + I18n.t('nativeAgent.wsFree');
                return `<option value="${k}" ${k === _wsCurrentProvider ? 'selected' : ''}>${label}${note}</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <div id="ws-provider-config">
          ${renderWsProviderConfig(_wsCurrentProvider, wsP)}
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('nativeAgent.wsTest')}</div>
            <div class="pref-desc">${I18n.t('nativeAgent.wsTestDesc')}</div>
          </div>
          <div class="pref-control" style="min-width:280px;">
            <div style="display:flex;gap:8px;align-items:center;">
              <input id="ws-test-query" type="text" class="form-input" style="flex:1;" placeholder="${I18n.t('nativeAgent.wsTestPlaceholder')}" value="${I18n.t('nativeAgent.wsTestDefault')}">
              <button type="button" class="btn btn-secondary btn-sm" id="ws-test-btn">${I18n.t('nativeAgent.wsTestBtn')}</button>
            </div>
            <div id="ws-test-result" style="margin-top:8px;font-size:12px;display:none;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // ── Bind LLM provider events ──

  document.getElementById('na-provider').addEventListener('change', (e) => {
    _nativeProvider = e.target.value;
    const newP = _nativeCfg.providers?.[_nativeProvider] || {};
    _nativeFetchedModels = newP.models || [];
    renderNativeAgent();
  });

  document.getElementById('na-model-select').addEventListener('change', (e) => {
    document.getElementById('na-model-input').value = e.target.value;
    refreshContextWindowInput(e.target.value);
  });

  document.getElementById('na-model-input').addEventListener('input', (e) => {
    const val = e.target.value;
    const sel = document.getElementById('na-model-select');
    const exists = [...sel.options].some(o => o.value === val);
    if (!exists && val) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = val;
      sel.appendChild(opt);
    }
    sel.value = val;
    refreshContextWindowInput(val);
  });

  document.getElementById('na-key-toggle').addEventListener('click', () => {
    const input = document.getElementById('na-api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('na-fetch-btn').addEventListener('click', async () => {
    const btn = document.getElementById('na-fetch-btn');
    const status = document.getElementById('na-fetch-status');
    const baseURL = document.getElementById('na-base-url').value.trim();
    const apiKey = document.getElementById('na-api-key').value.trim();
    if (!baseURL) { status.textContent = I18n.t('nativeAgent.needBaseURL'); status.style.color = 'var(--danger)'; return; }
    btn.disabled = true; btn.textContent = I18n.t('nativeAgent.fetching'); status.textContent = '';
    try {
      const resp = await fetch(`${API_NATIVE}/native-agent/fetch-models`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseURL, apiKey }),
      });
      const data = await resp.json();
      if (data.models && data.models.length > 0) {
        _nativeFetchedModels = data.models;
        if (!_nativeCfg.providers[_nativeProvider]) _nativeCfg.providers[_nativeProvider] = {};
        _nativeCfg.providers[_nativeProvider].models = data.models;
        status.textContent = I18n.t('nativeAgent.modelsFound', { count: data.models.length }); status.style.color = 'var(--accent)';
        renderNativeAgent();
      } else {
        status.textContent = data.error || I18n.t('nativeAgent.noModels'); status.style.color = 'var(--danger)';
        btn.disabled = false; btn.textContent = I18n.t('nativeAgent.fetchModels');
      }
    } catch (e) {
      status.textContent = e.message; status.style.color = 'var(--danger)';
      btn.disabled = false; btn.textContent = I18n.t('nativeAgent.fetchModels');
    }
  });

  document.getElementById('na-save-btn').addEventListener('click', async () => {
    const btn = document.getElementById('na-save-btn');
    const status = document.getElementById('na-save-status');
    btn.disabled = true; btn.textContent = I18n.t('nativeAgent.saving');

    const baseURL = document.getElementById('na-base-url').value.trim();
    const apiKey = document.getElementById('na-api-key').value.trim();
    const modelVal = document.getElementById('na-model-input').value.trim()
      || document.getElementById('na-model-select').value;
    const soulPath = document.getElementById('na-soul-path').value.trim();
    const ctxWinRaw = document.getElementById('na-context-window').value.trim();
    const ctxWin = parseInt(ctxWinRaw, 10);

    // Update config object — LLM provider
    _nativeCfg.provider = _nativeProvider;
    _nativeCfg.model = modelVal;
    _nativeCfg.soulPath = soulPath;
    // Persist per-model context window override (only when valid & differs from default)
    if (modelVal && Number.isFinite(ctxWin) && ctxWin > 0) {
      if (!_nativeCfg.contextWindows) _nativeCfg.contextWindows = {};
      // Drop the override if it matches the built-in default (keep config clean)
      if (_contextDefaults[modelVal] === ctxWin) {
        delete _nativeCfg.contextWindows[modelVal];
      } else {
        _nativeCfg.contextWindows[modelVal] = ctxWin;
      }
    }
    if (!_nativeCfg.providers[_nativeProvider]) _nativeCfg.providers[_nativeProvider] = {};
    _nativeCfg.providers[_nativeProvider].baseURL = baseURL;
    _nativeCfg.providers[_nativeProvider].apiKey = apiKey;
    const stored = _nativeCfg.providers[_nativeProvider].models || _nativeFetchedModels || [];
    if (modelVal && !stored.includes(modelVal)) stored.push(modelVal);
    _nativeCfg.providers[_nativeProvider].models = stored;

    // Update config object — Web Search
    collectWsConfig();

    try {
      await fetch(`${API_NATIVE}/native-agent/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_nativeCfg),
      });
      status.textContent = I18n.t('nativeAgent.saved'); status.style.color = 'var(--accent)';
      btn.disabled = false; btn.textContent = I18n.t('nativeAgent.save');
      setTimeout(() => { status.textContent = ''; }, 2500);
    } catch (e) {
      status.textContent = e.message; status.style.color = 'var(--danger)';
      btn.disabled = false; btn.textContent = I18n.t('nativeAgent.save');
    }
  });

  // ── Bind Web Search events ──

  document.getElementById('ws-provider').addEventListener('change', (e) => {
    _wsCurrentProvider = e.target.value;
    const wsP = _nativeCfg.webSearch?.providers?.[_wsCurrentProvider] || {};
    // Re-render just the provider config section
    const configDiv = document.getElementById('ws-provider-config');
    configDiv.innerHTML = renderWsProviderConfig(_wsCurrentProvider, wsP);
    bindWsKeyToggle();
  });

  bindWsKeyToggle();

  document.getElementById('ws-test-btn').addEventListener('click', async () => {
    const btn = document.getElementById('ws-test-btn');
    const resultDiv = document.getElementById('ws-test-result');
    const query = document.getElementById('ws-test-query').value.trim() || 'test';

    // Collect current config and save first (so server uses latest)
    collectWsConfig();
    _nativeCfg.webSearch.provider = _wsCurrentProvider;

    btn.disabled = true; btn.textContent = I18n.t('nativeAgent.wsTesting');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `<span style="color:var(--text-dim)">${I18n.t('nativeAgent.wsTestingHint')}</span>`;

    // Save config first
    try {
      await fetch(`${API_NATIVE}/native-agent/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_nativeCfg),
      });
    } catch {}

    try {
      const resp = await fetch(`${API_NATIVE}/native-agent/web-search/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await resp.json();
      if (data.ok && data.results) {
        resultDiv.innerHTML = `<span style="color:var(--accent)">✓ ${I18n.t('nativeAgent.wsTestOk', { count: data.count })}</span>` +
          data.results.slice(0, 3).map(r =>
            `<div style="margin-top:4px;padding-left:12px;border-left:2px solid var(--border);">` +
            `<span style="color:var(--text)">${escapeHtml(r.title || '(no title)')}</span><br>` +
            `<span style="color:var(--text-dim);font-size:11px;">${escapeHtml((r.snippet || '').slice(0, 120))}...</span>` +
            `</div>`
          ).join('');
      } else {
        resultDiv.innerHTML = `<span style="color:var(--danger)">✗ ${escapeHtml(data.error || 'Unknown error')}</span>`;
      }
    } catch (e) {
      resultDiv.innerHTML = `<span style="color:var(--danger)">✗ ${escapeHtml(e.message)}</span>`;
    }
    btn.disabled = false; btn.textContent = I18n.t('nativeAgent.wsTestBtn');
  });
}

// ── Helper: render provider-specific config fields ──
function renderWsProviderConfig(providerKey, pConfig) {
  const meta = _wsProviders?.[providerKey] || {};
  const needsKey = meta.needsApiKey;
  const keyLabel = meta.apiKeyLabel || 'API Key';

  let html = '';

  if (needsKey) {
    const apiKey = pConfig.apiKey || '';
    // For zhipu_mcp, show a hint about inheriting
    const inheritHint = providerKey === 'zhipu_mcp'
      ? `<div class="pref-desc">${I18n.t('nativeAgent.wsZhipuHint')}</div>`
      : '';
    html += `
      <div class="pref-item">
        <div class="pref-info">
          <div class="pref-label">${escapeHtml(keyLabel)}</div>
          ${inheritHint}
        </div>
        <div class="pref-control">
          <div class="pref-api-key-wrap">
            <input id="ws-api-key" type="password" class="form-input" style="min-width:280px;" value="${escapeHtml(apiKey)}" placeholder="${I18n.t('nativeAgent.apiKeyPlaceholder')}" autocomplete="off" spellcheck="false">
            <button type="button" class="btn-icon btn-icon-sm" id="ws-key-toggle" title="${I18n.t('nativeAgent.keyToggle')}">👁</button>
          </div>
        </div>
      </div>`;
  }

  // Extra fields per provider
  const extra = meta.extra || {};
  for (const [field, label] of Object.entries(extra)) {
    const val = pConfig[field] || '';
    html += `
      <div class="pref-item">
        <div class="pref-info">
          <div class="pref-label">${escapeHtml(label)}</div>
        </div>
        <div class="pref-control">
          <input id="ws-extra-${field}" type="text" class="form-input" style="min-width:280px;" value="${escapeHtml(val)}" autocomplete="off" spellcheck="false">
        </div>
      </div>`;
  }

  // zhipu_mcp has custom URLs
  if (providerKey === 'zhipu_mcp') {
    const searchURL = pConfig.searchURL || 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp';
    const readerURL = pConfig.readerURL || 'https://open.bigmodel.cn/api/mcp/web_reader/mcp';
    html += `
      <div class="pref-item">
        <div class="pref-info">
          <div class="pref-label">${I18n.t('nativeAgent.wsSearchURL')}</div>
          <div class="pref-desc">${I18n.t('nativeAgent.wsSearchURLDesc')}</div>
        </div>
        <div class="pref-control">
          <input id="ws-extra-searchURL" type="text" class="form-input" style="min-width:380px;" value="${escapeHtml(searchURL)}" autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div class="pref-item">
        <div class="pref-info">
          <div class="pref-label">${I18n.t('nativeAgent.wsReaderURL')}</div>
          <div class="pref-desc">${I18n.t('nativeAgent.wsReaderURLDesc')}</div>
        </div>
        <div class="pref-control">
          <input id="ws-extra-readerURL" type="text" class="form-input" style="min-width:380px;" value="${escapeHtml(readerURL)}" autocomplete="off" spellcheck="false">
        </div>
      </div>`;
  }

  if (!html) {
    html = `<div class="pref-item"><div class="pref-info"><div class="pref-desc">${I18n.t('nativeAgent.wsNoConfig')}</div></div></div>`;
  }

  return html;
}

// ── Helper: collect web search config from UI into _nativeCfg ──
function collectWsConfig() {
  if (!_nativeCfg.webSearch) _nativeCfg.webSearch = { provider: _wsCurrentProvider, providers: {} };
  _nativeCfg.webSearch.provider = _wsCurrentProvider;

  if (!_nativeCfg.webSearch.providers) _nativeCfg.webSearch.providers = {};
  if (!_nativeCfg.webSearch.providers[_wsCurrentProvider]) _nativeCfg.webSearch.providers[_wsCurrentProvider] = {};

  const wsCfg = _nativeCfg.webSearch.providers[_wsCurrentProvider];

  // API Key
  const apiKeyEl = document.getElementById('ws-api-key');
  if (apiKeyEl) wsCfg.apiKey = apiKeyEl.value.trim();

  // Extra fields
  const meta = _wsProviders?.[_wsCurrentProvider] || {};
  for (const field of Object.keys(meta.extra || {})) {
    const el = document.getElementById(`ws-extra-${field}`);
    if (el) wsCfg[field] = el.value.trim();
  }

  // zhipu_mcp URLs
  if (_wsCurrentProvider === 'zhipu_mcp') {
    const searchURLEl = document.getElementById('ws-extra-searchURL');
    const readerURLEl = document.getElementById('ws-extra-readerURL');
    if (searchURLEl) wsCfg.searchURL = searchURLEl.value.trim();
    if (readerURLEl) wsCfg.readerURL = readerURLEl.value.trim();
  }
}

// ── Helper: bind key toggle ──
function bindWsKeyToggle() {
  const toggle = document.getElementById('ws-key-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const input = document.getElementById('ws-api-key');
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    });
  }
}

// ── Helper: escape HTML ──
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateNativeAgentText() {
  if (_nativeCfg) renderNativeAgent();
}
