// ==================== Cloe Settings — Native Agent Tab ====================

const API_NATIVE = 'http://127.0.0.1:19851';

let _nativeCfg = null;
let _nativeProvider = '';
let _nativeFetchedModels = [];
let _nativeInited = false;

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
    _nativeProvider = _nativeCfg.provider || Object.keys(_nativeCfg.providers || {})[0] || '';
    _nativeFetchedModels = _nativeCfg.providers?.[_nativeProvider]?.models || [];
    renderNativeAgent();
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>${I18n.t('nativeAgent.loadFailed')}</p><p class="sub">${e.message}</p></div>`;
  }
}

function renderNativeAgent() {
  const container = document.getElementById('native-agent-content');
  if (!_nativeCfg) return;

  const providerNames = Object.keys(_nativeCfg.providers || {});
  const p = _nativeCfg.providers?.[_nativeProvider] || { baseURL: '', apiKey: '', models: [] };
  const currentModel = _nativeCfg.model || '';

  // Merge fetched models + stored models + current
  const allModels = [...new Set([..._nativeFetchedModels, ...(p.models || []), currentModel].filter(Boolean))].sort();

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
  `;

  // ── Bind events ──

  document.getElementById('na-provider').addEventListener('change', (e) => {
    _nativeProvider = e.target.value;
    const newP = _nativeCfg.providers?.[_nativeProvider] || {};
    _nativeFetchedModels = newP.models || [];
    renderNativeAgent();
  });

  document.getElementById('na-model-select').addEventListener('change', (e) => {
    document.getElementById('na-model-input').value = e.target.value;
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
        // Persist into config object
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

    // Update config object
    _nativeCfg.provider = _nativeProvider;
    _nativeCfg.model = modelVal;
    _nativeCfg.soulPath = soulPath;
    if (!_nativeCfg.providers[_nativeProvider]) _nativeCfg.providers[_nativeProvider] = {};
    _nativeCfg.providers[_nativeProvider].baseURL = baseURL;
    _nativeCfg.providers[_nativeProvider].apiKey = apiKey;
    // Merge current model into stored list
    const stored = _nativeCfg.providers[_nativeProvider].models || _nativeFetchedModels || [];
    if (modelVal && !stored.includes(modelVal)) stored.push(modelVal);
    _nativeCfg.providers[_nativeProvider].models = stored;

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
}

function updateNativeAgentText() {
  if (_nativeCfg) renderNativeAgent();
}
