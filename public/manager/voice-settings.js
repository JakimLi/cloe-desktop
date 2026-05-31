// ==================== Cloe Settings — Voice Input Tab ====================

const API_VOICE_BASE = 'http://127.0.0.1:19851';

let _voiceInitialized = false;
let _voiceModels = [];
let _voiceConfig = { engine: '', language: 'auto' };

// ── Helpers ──

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ── API Calls ──

async function loadVoiceConfig() {
  try {
    const res = await fetch(`${API_VOICE_BASE}/voice/config`);
    if (!res.ok) return;
    _voiceConfig = await res.json();
  } catch (_) {}
}

async function saveVoiceConfig(patch) {
  try {
    await fetch(`${API_VOICE_BASE}/voice/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch (_) {}
}

async function loadVoiceModels() {
  const listEl = document.getElementById('voice-model-list');
  if (!listEl) return;
  try {
    const res = await fetch(`${API_VOICE_BASE}/voice/models`);
    if (!res.ok) return;
    _voiceModels = await res.json();
    renderVoiceModels();
  } catch (_) {
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Failed to load models</div>';
  }
}

// ── Render Voice Models ──

function renderVoiceModels() {
  const listEl = document.getElementById('voice-model-list');
  if (!listEl) return;

  const activeEngine = _voiceConfig.engine || '';

  listEl.innerHTML = _voiceModels.map((m) => {
    const isCompatible = !activeEngine || m.engine === activeEngine;
    const dimmed = activeEngine && !isCompatible ? 'opacity:0.4;' : '';
    const statusHtml = m.downloaded
      ? `<span style="color:#4ade80;font-size:11px;">✓ ${window.I18n.t('prefs.voiceDownloaded')}</span>`
      : `<span style="color:var(--text-muted);font-size:11px;">${m.sizeLabel || formatBytes(m.size || 0)}</span>`;
    const actionsHtml = m.downloaded
      ? `<button type="button" class="btn btn-secondary btn-sm voice-model-delete" data-id="${m.id}" style="font-size:11px;padding:2px 8px;">${window.I18n.t('prefs.voiceDelete')}</button>`
      : `<button type="button" class="btn btn-primary btn-sm voice-model-download" data-id="${m.id}" style="font-size:11px;padding:2px 8px;">${window.I18n.t('prefs.voiceDownload')}</button>`;
    const typeTag = m.type === 'online' || m.type === 'streaming'
      ? '<span style="background:rgba(74,222,128,0.15);color:#4ade80;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:6px;">Streaming</span>'
      : '<span style="background:rgba(250,204,21,0.15);color:#fde68a;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:6px;">Batch</span>';

    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);${dimmed}">
      <div>
        <span style="font-size:12px;font-weight:500;color:var(--text);">${m.name}</span>${typeTag}
        <div style="margin-top:2px;">${statusHtml}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        ${actionsHtml}
      </div>
    </div>`;
  }).join('');

  // Bind download buttons
  listEl.querySelectorAll('.voice-model-download').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modelId = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = window.I18n.t('prefs.voiceDownloading');
      try {
        const res = await fetch(`${API_VOICE_BASE}/voice/models/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId }),
        });
        if (!res.ok) throw new Error('download failed');
        await loadVoiceModels();
      } catch (_) {
        btn.textContent = '✗ Error';
        btn.disabled = false;
      }
    });
  });

  // Bind delete buttons
  listEl.querySelectorAll('.voice-model-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const modelId = btn.dataset.id;
      if (!confirm(window.I18n.t('prefs.voiceDeleteConfirm'))) return;
      try {
        await fetch(`${API_VOICE_BASE}/voice/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
        await loadVoiceModels();
      } catch (_) {}
    });
  });
}

// ── Render Voice Status ──

function renderVoiceStatus() {
  const statusEl = document.getElementById('voice-status');
  if (!statusEl) return;

  const engine = _voiceConfig.engine || '';
  const language = _voiceConfig.language || 'auto';
  const ready = engine !== '';

  const engineLabels = {
    '': window.I18n.t('prefs.voiceEngineNone'),
    whisper: 'Whisper.cpp (Offline)',
    macos: 'macOS 系统语音',
  };

  const langLabels = {
    auto: window.I18n.t('prefs.voiceLangAuto'),
    zh: '中文',
    en: 'English',
    ja: '日本語',
  };

  statusEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="width:8px;height:8px;border-radius:50%;background:${ready ? '#4ade80' : 'var(--text-muted)'};display:inline-block;"></span>
      <span style="font-size:12px;font-weight:500;color:var(--text);">${ready ? window.I18n.t('prefs.voiceEngine') + ': ' + (engineLabels[engine] || engine) : window.I18n.t('prefs.voiceEngineNone')}</span>
    </div>
    <div style="font-size:11px;color:var(--text-muted);">
      ${window.I18n.t('prefs.voiceLanguage')}: ${langLabels[language] || language}
    </div>
  `;
}

// ── Main Render ──

function renderVoiceSettings() {
  const container = document.getElementById('voice-content');
  if (!container) return;

  const engine = _voiceConfig.engine || '';
  const language = _voiceConfig.language || 'auto';

  container.innerHTML = `
    <div class="pref-section">
      <h2 class="pref-section-title">${window.I18n.t('prefs.voiceInput')}</h2>
      <div class="pref-desc" style="margin-bottom:16px;">${window.I18n.t('prefs.voiceModelManagementDesc')}</div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${window.I18n.t('prefs.voiceEngine')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${window.I18n.t('prefs.voiceEngine')}</div>
            <div class="pref-desc">${window.I18n.t('prefs.voiceEngineDesc')}</div>
          </div>
          <div class="pref-control">
            <select id="pref-voice-engine" class="form-input form-select" style="width:220px;">
              <option value="">${window.I18n.t('prefs.voiceEngineNone')}</option>
              <option value="whisper" ${engine === 'whisper' ? 'selected' : ''}>Whisper.cpp (Offline)</option>
              <option value="macos" ${engine === 'macos' ? 'selected' : ''}>macOS 系统语音</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${window.I18n.t('prefs.voiceLanguage')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${window.I18n.t('prefs.voiceLanguage')}</div>
            <div class="pref-desc">${window.I18n.t('prefs.voiceLanguageDesc')}</div>
          </div>
          <div class="pref-control">
            <select id="pref-voice-language" class="form-input form-select" style="width:220px;">
              <option value="auto" ${language === 'auto' ? 'selected' : ''}>${window.I18n.t('prefs.voiceLangAuto')}</option>
              <option value="zh" ${language === 'zh' ? 'selected' : ''}>中文</option>
              <option value="en" ${language === 'en' ? 'selected' : ''}>English</option>
              <option value="ja" ${language === 'ja' ? 'selected' : ''}>日本語</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${window.I18n.t('prefs.voiceModelManagement')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${window.I18n.t('prefs.voiceModelManagement')}</div>
            <div class="pref-desc">${window.I18n.t('prefs.voiceModelManagementDesc')}</div>
          </div>
          <div class="pref-control" style="width:100%;max-width:500px;">
            <div id="voice-model-list" style="display:flex;flex-direction:column;gap:8px;">
              <div style="color:var(--text-muted);font-size:12px;">${window.I18n.t('prefs.voiceLoading')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${window.I18n.t('prefs.about')}</h2>
      <div class="pref-group">
        <div id="voice-status" class="pref-item">
        </div>
      </div>
    </div>
  `;

  // ── Bind Engine Select ──
  const engineSelect = document.getElementById('pref-voice-engine');
  if (engineSelect) {
    engineSelect.addEventListener('change', () => {
      _voiceConfig.engine = engineSelect.value;
      saveVoiceConfig({ engine: engineSelect.value });
      renderVoiceModels();
      renderVoiceStatus();
    });
  }

  // ── Bind Language Select ──
  const languageSelect = document.getElementById('pref-voice-language');
  if (languageSelect) {
    languageSelect.addEventListener('change', () => {
      _voiceConfig.language = languageSelect.value;
      saveVoiceConfig({ language: languageSelect.value });
      renderVoiceStatus();
    });
  }
}

// ── Init (called once on first tab visit) ──

function initVoiceSettingsTab() {
  if (_voiceInitialized) return;
  _voiceInitialized = true;

  (async () => {
    await loadVoiceConfig();
    renderVoiceSettings();
    renderVoiceStatus();
    await loadVoiceModels();
  })();
}

// Expose on window for manager.js lazy-load
window.initVoiceSettingsTab = initVoiceSettingsTab;
