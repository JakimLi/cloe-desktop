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
            <div class="pref-label">${I18n.t('prefs.contextBar')}</div>
            <div class="pref-desc">${I18n.t('prefs.contextBarDesc')}</div>
          </div>
          <div class="pref-control">
            <label class="toggle">
              <input type="checkbox" id="pref-context-bar">
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
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.windowScale')}</div>
            <div class="pref-desc">${I18n.t('prefs.windowScaleDesc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:10px;min-width:200px;">
              <input type="range" id="pref-window-scale" min="0.3" max="2.0" step="0.05" value="1.0"
                style="flex:1;accent-color:var(--accent);cursor:pointer;">
              <span id="pref-window-scale-value" style="font-size:13px;font-weight:600;min-width:36px;text-align:right;color:var(--text);">1.0×</span>
            </div>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.chatNickname')}</div>
            <div class="pref-desc">${I18n.t('prefs.chatNicknameDesc')}</div>
          </div>
          <div class="pref-control">
            <input type="text" id="pref-chat-nickname" class="form-input"
              style="width:180px;" placeholder="${I18n.t('prefs.chatNicknamePlaceholder')}"
              autocomplete="off" spellcheck="false" maxlength="20">
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.characterPosition')}</div>
            <div class="pref-desc">${I18n.t('prefs.characterPositionDesc')}</div>
          </div>
          <div class="pref-control">
            <div class="char-layout-control">
              <div class="char-layout-dpad">
                <div class="char-layout-dpad-row">
                  <button type="button" class="btn-icon char-layout-btn" data-dir="up" title="Up">▲</button>
                </div>
                <div class="char-layout-dpad-row">
                  <button type="button" class="btn-icon char-layout-btn" data-dir="left" title="Left">◀</button>
                  <button type="button" class="btn-icon char-layout-btn char-layout-btn-center" data-dir="reset" title="Reset">⊙</button>
                  <button type="button" class="btn-icon char-layout-btn" data-dir="right" title="Right">▶</button>
                </div>
                <div class="char-layout-dpad-row">
                  <button type="button" class="btn-icon char-layout-btn" data-dir="down" title="Down">▼</button>
                </div>
              </div>
              <span id="char-layout-pos-info" class="char-layout-info"></span>
            </div>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.characterScale')}</div>
            <div class="pref-desc">${I18n.t('prefs.characterScaleDesc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:10px;min-width:200px;">
              <button type="button" class="btn btn-secondary btn-sm" id="pref-char-scale-down" title="缩小">−</button>
              <input type="range" id="pref-char-scale" min="0.2" max="3.0" step="0.05" value="1.0"
                style="flex:1;accent-color:var(--accent);cursor:pointer;">
              <button type="button" class="btn btn-secondary btn-sm" id="pref-char-scale-up" title="放大">+</button>
              <span id="pref-char-scale-value" style="font-size:13px;font-weight:600;min-width:42px;text-align:right;color:var(--text);">1.00×</span>
            </div>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.terminal')}</div>
            <div class="pref-desc">${I18n.t('prefs.terminalDesc')}</div>
          </div>
          <div class="pref-control">
            <label class="toggle">
              <input type="checkbox" id="pref-terminal-enabled">
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.conditionalTTS')}</div>
            <div class="pref-desc">${I18n.t('prefs.conditionalTTSDesc')}</div>
          </div>
          <div class="pref-control">
            <label class="toggle">
              <input type="checkbox" id="pref-conditional-tts" checked>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.ttsDelay')}</div>
            <div class="pref-desc">${I18n.t('prefs.ttsDelayDesc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:10px;min-width:200px;">
              <input type="range" id="pref-tts-delay" min="0" max="10" step="1" value="3"
                style="flex:1;accent-color:var(--accent);cursor:pointer;">
              <span id="pref-tts-delay-value" style="font-size:13px;font-weight:600;min-width:36px;text-align:right;color:var(--text);">3s</span>
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

  // Context bar visibility toggle
  const contextBarToggle = document.getElementById('pref-context-bar');
  const savedContextBar = localStorage.getItem('cloe-context-bar-visible') !== 'false';
  contextBarToggle.checked = savedContextBar;
  contextBarToggle.addEventListener('change', () => {
    localStorage.setItem('cloe-context-bar-visible', contextBarToggle.checked);
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

  // Chat nickname
  const nicknameInput = document.getElementById('pref-chat-nickname');
  let nicknameDebounceTimer;

  nicknameInput.addEventListener('input', () => {
    clearTimeout(nicknameDebounceTimer);
    nicknameDebounceTimer = setTimeout(() => {
      fetch(`${API_CONFIG_BASE}/api-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatNickname: nicknameInput.value.trim() || '' }),
      }).catch(() => {});
    }, 300);
  });

  async function loadApiConfig() {
    try {
      const res = await fetch(`${API_CONFIG_BASE}/api-config`);
      if (!res.ok) return;
      const cfg = await res.json();
      nicknameInput.value = cfg.chatNickname || '';
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

  // Window scale slider
  const scaleSlider = document.getElementById('pref-window-scale');
  const scaleValue = document.getElementById('pref-window-scale-value');
  let scaleDebounceTimer;

  async function loadWindowScale() {
    try {
      const res = await fetch(`${API_CONFIG_BASE}/window-scale`);
      if (!res.ok) return;
      const data = await res.json();
      scaleSlider.value = data.scale;
      scaleValue.textContent = data.scale.toFixed(2) + '×';
    } catch (_) {}
  }

  scaleSlider.addEventListener('input', () => {
    const val = parseFloat(scaleSlider.value);
    scaleValue.textContent = val.toFixed(2) + '×';
    // Debounce API calls while dragging
    clearTimeout(scaleDebounceTimer);
    scaleDebounceTimer = setTimeout(async () => {
      try {
        await fetch(`${API_CONFIG_BASE}/window-scale`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scale: val }),
        });
      } catch (_) {}
    }, 100);
  });

  loadWindowScale();

  // ── Character Layout (position + scale) ──
  const charScaleSlider = document.getElementById('pref-char-scale');
  const charScaleValue = document.getElementById('pref-char-scale-value');
  const charScaleDown = document.getElementById('pref-char-scale-down');
  const charScaleUp = document.getElementById('pref-char-scale-up');
  const charPosInfo = document.getElementById('char-layout-pos-info');
  let charLayout = { position: { x: 0.5, y: 1.0 }, size: { scale: 1.0 } };
  let charLayoutDebounce;

  function updateCharPosInfo() {
    if (!charPosInfo) return;
    const p = charLayout.position;
    charPosInfo.textContent = `X: ${(p.x * 100).toFixed(0)}%  Y: ${(p.y * 100).toFixed(0)}%`;
  }

  function saveCharLayoutDebounced() {
    clearTimeout(charLayoutDebounce);
    charLayoutDebounce = setTimeout(() => {
      fetch(`${API_CONFIG_BASE}/character-layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(charLayout),
      }).catch(() => {});
    }, 80);
  }

  async function loadCharLayout() {
    try {
      const res = await fetch(`${API_CONFIG_BASE}/character-layout`);
      if (!res.ok) return;
      charLayout = await res.json();
      charScaleSlider.value = charLayout.size.scale;
      charScaleValue.textContent = charLayout.size.scale.toFixed(2) + '×';
      updateCharPosInfo();
    } catch (_) {}
  }

  // D-pad buttons
  document.querySelectorAll('.char-layout-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.dir;
      const step = 0.05;
      if (dir === 'up') charLayout.position.y = Math.max(0, charLayout.position.y - step);
      else if (dir === 'down') charLayout.position.y = Math.min(1, charLayout.position.y + step);
      else if (dir === 'left') charLayout.position.x = Math.max(0, charLayout.position.x - step);
      else if (dir === 'right') charLayout.position.x = Math.min(1, charLayout.position.x + step);
      else if (dir === 'reset') charLayout.position = { x: 0.5, y: 1.0 };
      updateCharPosInfo();
      saveCharLayoutDebounced();
    });
  });

  // Scale slider
  charScaleSlider.addEventListener('input', () => {
    const val = parseFloat(charScaleSlider.value);
    charScaleValue.textContent = val.toFixed(2) + '×';
    charLayout.size.scale = val;
    saveCharLayoutDebounced();
  });

  // Scale +/- buttons
  charScaleDown.addEventListener('click', () => {
    let val = parseFloat(charScaleSlider.value) - 0.1;
    val = Math.max(0.2, Math.round(val * 100) / 100);
    charScaleSlider.value = val;
    charScaleValue.textContent = val.toFixed(2) + '×';
    charLayout.size.scale = val;
    saveCharLayoutDebounced();
  });

  charScaleUp.addEventListener('click', () => {
    let val = parseFloat(charScaleSlider.value) + 0.1;
    val = Math.min(3.0, Math.round(val * 100) / 100);
    charScaleSlider.value = val;
    charScaleValue.textContent = val.toFixed(2) + '×';
    charLayout.size.scale = val;
    saveCharLayoutDebounced();
  });

  loadCharLayout();

  // Terminal toggle
  const terminalToggle = document.getElementById('pref-terminal-enabled');
  const savedTerminal = localStorage.getItem('cloe-terminal-visible') === 'true';
  terminalToggle.checked = savedTerminal;
  terminalToggle.addEventListener('change', () => {
    localStorage.setItem('cloe-terminal-visible', terminalToggle.checked);
  });

  // ── Conditional TTS settings ──
  const conditionalTTSToggle = document.getElementById('pref-conditional-tts');
  const ttsDelaySlider = document.getElementById('pref-tts-delay');
  const ttsDelayValue = document.getElementById('pref-tts-delay-value');

  async function loadTTSSchedulerConfig() {
    try {
      const res = await fetch(`${API_CONFIG_BASE}/tts-scheduler/config`);
      if (!res.ok) return;
      const cfg = await res.json();
      conditionalTTSToggle.checked = cfg.conditional_tts !== false;
      const delaySec = Math.round((cfg.tts_delay || 3000) / 1000);
      ttsDelaySlider.value = delaySec;
      ttsDelayValue.textContent = delaySec + 's';
    } catch (_) {}
  }

  conditionalTTSToggle.addEventListener('change', () => {
    fetch(`${API_CONFIG_BASE}/tts-scheduler/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditional_tts: conditionalTTSToggle.checked }),
    }).catch(() => {});
  });

  let ttsDelayDebounce;
  ttsDelaySlider.addEventListener('input', () => {
    const val = parseInt(ttsDelaySlider.value, 10);
    ttsDelayValue.textContent = val + 's';
    clearTimeout(ttsDelayDebounce);
    ttsDelayDebounce = setTimeout(() => {
      fetch(`${API_CONFIG_BASE}/tts-scheduler/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tts_delay: val * 1000 }),
      }).catch(() => {});
    }, 200);
  });

  loadTTSSchedulerConfig();

}

function updatePreferencesText() {
  renderPreferences();
}
