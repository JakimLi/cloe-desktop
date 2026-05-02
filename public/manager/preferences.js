// ==================== Cloe Settings — Preferences Tab ====================

const API_CONFIG_BASE = 'http://127.0.0.1:19851';

function initPreferencesTab() {
  renderPreferences();
}

function renderPreferences() {
  const container = document.getElementById('preferences-content');
  const currentLocale = I18n.getLocale();

  container.innerHTML = `
    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('prefs.appearance')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.language')}</div>
            <div class="pref-desc">${I18n.t('prefs.languageDesc')}</div>
          </div>
          <div class="pref-control">
            <div class="segmented-control" id="lang-segments">
              <button class="segment ${currentLocale === 'zh-CN' ? 'active' : ''}" data-locale="zh-CN">${I18n.t('prefs.langZh')}</button>
              <button class="segment ${currentLocale === 'en-US' ? 'active' : ''}" data-locale="en-US">${I18n.t('prefs.langEn')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('prefs.general')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.autoStart')}</div>
            <div class="pref-desc">${I18n.t('prefs.autoStartDesc')}</div>
          </div>
          <div class="pref-control">
            <label class="toggle">
              <input type="checkbox" id="pref-auto-start">
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.minimizeToTray')}</div>
            <div class="pref-desc">${I18n.t('prefs.minimizeToTrayDesc')}</div>
          </div>
          <div class="pref-control">
            <label class="toggle">
              <input type="checkbox" id="pref-minimize-tray" checked>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.windowPosition')}</div>
            <div class="pref-desc">${I18n.t('prefs.windowPositionDesc')}</div>
          </div>
          <div class="pref-control">
            <div class="pref-window-pos-stack" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
              <div id="pref-window-pos-display" class="pref-desc" style="margin-top:0;text-align:right;"></div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;">
                <button type="button" class="btn btn-primary btn-sm" id="pref-window-pos-save">${I18n.t('prefs.windowPositionSave')}</button>
                <button type="button" class="btn btn-secondary btn-sm" id="pref-window-pos-clear">${I18n.t('prefs.windowPositionClear')}</button>
              </div>
              <span id="pref-window-pos-feedback" style="font-size:11px;color:var(--accent);min-height:14px;"></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('prefs.apiConfig')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.apiKey')}</div>
            <div class="pref-desc">${I18n.t('prefs.apiKeyDesc')}</div>
          </div>
          <div class="pref-control">
            <div class="pref-api-key-wrap">
              <input type="password" id="pref-dashscope-api-key" class="form-input" placeholder="${I18n.t('prefs.apiKeyPlaceholder')}" autocomplete="off" spellcheck="false">
              <button type="button" class="btn-icon btn-icon-sm" id="pref-api-key-toggle" title="${I18n.t('prefs.apiKeyToggle')}">👁</button>
            </div>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.videoModel')}</div>
            <div class="pref-desc">${I18n.t('prefs.videoModelDesc')}</div>
          </div>
          <div class="pref-control">
            <select id="pref-video-model" class="form-input form-select pref-video-model-select">
              <option value="wan2.7-i2v">wan2.7-i2v</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('prefs.about')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.appName')}</div>
            <div class="pref-desc">${I18n.t('prefs.aboutDesc')}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind language segmented control
  const segments = container.querySelectorAll('#lang-segments .segment');
  segments.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const locale = btn.dataset.locale;
      if (locale === I18n.getLocale()) return;
      await I18n.switchLocale(locale);
      // Notify parent to update all UI
      if (window.onLocaleChange) window.onLocaleChange();
    });
  });

  // Bind toggles (save to localStorage)
  const autoStartToggle = document.getElementById('pref-auto-start');
  const minimizeTrayToggle = document.getElementById('pref-minimize-tray');

  const savedAutoStart = localStorage.getItem('cloe-pref-auto-start') !== 'false';
  const savedMinimizeTray = localStorage.getItem('cloe-pref-minimize-tray') !== 'false';

  autoStartToggle.checked = savedAutoStart;
  minimizeTrayToggle.checked = savedMinimizeTray;

  autoStartToggle.addEventListener('change', () => {
    localStorage.setItem('cloe-pref-auto-start', autoStartToggle.checked);
  });
  minimizeTrayToggle.addEventListener('change', () => {
    localStorage.setItem('cloe-pref-minimize-tray', minimizeTrayToggle.checked);
  });

  const apiKeyInput = document.getElementById('pref-dashscope-api-key');
  const apiKeyToggle = document.getElementById('pref-api-key-toggle');
  const videoModelSelect = document.getElementById('pref-video-model');

  function postApiConfigPayload() {
    const payload = {
      dashscopeApiKey: apiKeyInput.value,
      videoModel: videoModelSelect.value,
    };
    return fetch(`${API_CONFIG_BASE}/api-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function loadApiConfig() {
    try {
      const res = await fetch(`${API_CONFIG_BASE}/api-config`);
      if (!res.ok) return;
      const cfg = await res.json();
      apiKeyInput.value = cfg.dashscopeApiKey != null ? String(cfg.dashscopeApiKey) : '';
      const vm = cfg.videoModel != null && cfg.videoModel !== '' ? cfg.videoModel : 'wan2.7-i2v';
      if ([...videoModelSelect.options].some((o) => o.value === vm)) {
        videoModelSelect.value = vm;
      } else {
        const opt = document.createElement('option');
        opt.value = vm;
        opt.textContent = vm;
        videoModelSelect.appendChild(opt);
        videoModelSelect.value = vm;
      }
    } catch (_) {
      /* bridge may be offline */
    }
  }

  apiKeyToggle.addEventListener('click', () => {
    const isPwd = apiKeyInput.type === 'password';
    apiKeyInput.type = isPwd ? 'text' : 'password';
  });

  apiKeyInput.addEventListener('change', () => {
    postApiConfigPayload().catch(() => {});
  });

  videoModelSelect.addEventListener('change', () => {
    postApiConfigPayload().catch(() => {});
  });

  loadApiConfig();

  const winPosDisplay = document.getElementById('pref-window-pos-display');
  const winPosFeedback = document.getElementById('pref-window-pos-feedback');
  let winPosFeedbackTimer;

  function showWindowPosFeedback(msg) {
    if (!winPosFeedback) return;
    winPosFeedback.textContent = msg || '';
    if (winPosFeedbackTimer) clearTimeout(winPosFeedbackTimer);
    if (msg) {
      winPosFeedbackTimer = setTimeout(() => {
        winPosFeedback.textContent = '';
      }, 2800);
    }
  }

  async function refreshWindowPositionUi() {
    if (!winPosDisplay) return;
    try {
      const res = await fetch(`${API_CONFIG_BASE}/window-position`);
      if (!res.ok) throw new Error('http');
      const data = await res.json();
      winPosDisplay.textContent = data.saved
        ? I18n.t('prefs.windowPositionSaved', { x: data.saved.x, y: data.saved.y })
        : I18n.t('prefs.windowPositionNotSet');
    } catch (_) {
      winPosDisplay.textContent = I18n.t('prefs.windowPositionDash');
    }
  }

  document.getElementById('pref-window-pos-save')?.addEventListener('click', async () => {
    showWindowPosFeedback('');
    try {
      const res = await fetch(`${API_CONFIG_BASE}/window-position`);
      if (!res.ok) throw new Error('http');
      const data = await res.json();
      if (!data.current) throw new Error('no window');
      const postRes = await fetch(`${API_CONFIG_BASE}/window-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: data.current.x, y: data.current.y }),
      });
      if (!postRes.ok) throw new Error('save');
      showWindowPosFeedback(I18n.t('prefs.windowPositionSaveSuccess'));
      await refreshWindowPositionUi();
    } catch (_) {
      showWindowPosFeedback('');
    }
  });

  document.getElementById('pref-window-pos-clear')?.addEventListener('click', async () => {
    showWindowPosFeedback('');
    try {
      const postRes = await fetch(`${API_CONFIG_BASE}/window-position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      });
      if (!postRes.ok) throw new Error('clear');
      showWindowPosFeedback(I18n.t('prefs.windowPositionClearSuccess'));
      await refreshWindowPositionUi();
    } catch (_) {
      showWindowPosFeedback('');
    }
  });

  refreshWindowPositionUi();
}

function updatePreferencesText() {
  renderPreferences();
}
