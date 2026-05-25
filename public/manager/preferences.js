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
            <div class="pref-label">${I18n.t('prefs.terminalShortcut')}</div>
            <div class="pref-desc">${I18n.t('prefs.terminalShortcutDesc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="text" id="pref-terminal-shortcut" class="form-input"
                style="width:160px;text-align:center;font-family:'SF Mono',monospace;font-size:13px;cursor:pointer;"
                placeholder="${I18n.t('prefs.terminalShortcutEmpty')}"
                readonly>
              <button type="button" class="btn btn-secondary btn-sm" id="pref-terminal-shortcut-clear">${I18n.t('prefs.terminalShortcutClear')}</button>
            </div>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.canvasShortcut')}</div>
            <div class="pref-desc">${I18n.t('prefs.canvasShortcutDesc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="text" id="pref-canvas-shortcut" class="form-input"
                style="width:160px;text-align:center;font-family:'SF Mono',monospace;font-size:13px;cursor:pointer;"
                placeholder="${I18n.t('prefs.canvasShortcutEmpty')}"
                readonly>
              <button type="button" class="btn btn-secondary btn-sm" id="pref-canvas-shortcut-clear">${I18n.t('prefs.canvasShortcutClear')}</button>
            </div>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.chatShortcut')}</div>
            <div class="pref-desc">${I18n.t('prefs.chatShortcutDesc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="text" id="pref-chat-shortcut" class="form-input"
                style="width:160px;text-align:center;font-family:'SF Mono',monospace;font-size:13px;cursor:pointer;"
                placeholder="${I18n.t('prefs.chatShortcutEmpty')}"
                readonly>
              <button type="button" class="btn btn-secondary btn-sm" id="pref-chat-shortcut-clear">${I18n.t('prefs.chatShortcutClear')}</button>
            </div>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.chatTransparencyShortcut')}</div>
            <div class="pref-desc">${I18n.t('prefs.chatTransparencyShortcutDesc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="text" id="pref-chat-transparency-shortcut" class="form-input"
                style="width:160px;text-align:center;font-family:'SF Mono',monospace;font-size:13px;cursor:pointer;"
                placeholder="${I18n.t('prefs.chatTransparencyShortcutEmpty')}"
                readonly>
              <button type="button" class="btn btn-secondary btn-sm" id="pref-chat-transparency-shortcut-clear">${I18n.t('prefs.chatTransparencyShortcutClear')}</button>
            </div>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.chatPinShortcut')}</div>
            <div class="pref-desc">${I18n.t('prefs.chatPinShortcutDesc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="text" id="pref-chat-pin-shortcut" class="form-input"
                style="width:160px;text-align:center;font-family:'SF Mono',monospace;font-size:13px;cursor:pointer;"
                placeholder="${I18n.t('prefs.chatPinShortcutEmpty')}"
                readonly>
              <button type="button" class="btn btn-secondary btn-sm" id="pref-chat-pin-shortcut-clear">${I18n.t('prefs.chatPinShortcutClear')}</button>
            </div>
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.chatFocusShortcut')}</div>
            <div class="pref-desc">${I18n.t('prefs.chatFocusShortcutDesc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="text" id="pref-chat-focus-shortcut" class="form-input"
                style="width:160px;text-align:center;font-family:'SF Mono',monospace;font-size:13px;cursor:pointer;"
                placeholder="${I18n.t('prefs.chatFocusShortcutEmpty')}"
                readonly>
              <button type="button" class="btn btn-secondary btn-sm" id="pref-chat-focus-shortcut-clear">${I18n.t('prefs.chatFocusShortcutClear')}</button>
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

  // Terminal toggle
  const terminalToggle = document.getElementById('pref-terminal-enabled');
  const savedTerminal = localStorage.getItem('cloe-terminal-visible') === 'true';
  terminalToggle.checked = savedTerminal;
  terminalToggle.addEventListener('change', () => {
    localStorage.setItem('cloe-terminal-visible', terminalToggle.checked);
  });

  // Terminal shortcut recorder
  const shortcutInput = document.getElementById('pref-terminal-shortcut');
  const shortcutClearBtn = document.getElementById('pref-terminal-shortcut-clear');
  let savedShortcut = localStorage.getItem('cloe-terminal-shortcut') || '';
  if (savedShortcut) shortcutInput.value = electronAcceleratorToDisplay(savedShortcut);

  shortcutInput.addEventListener('focus', () => {
    shortcutInput.value = I18n.t('prefs.terminalShortcutHint');
    shortcutInput.classList.add('shortcut-recording');
  });

  shortcutInput.addEventListener('blur', () => {
    shortcutInput.classList.remove('shortcut-recording');
    shortcutInput.value = savedShortcut ? electronAcceleratorToDisplay(savedShortcut) : '';
  });

  shortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accel = buildElectronAccelerator(e);
    if (!accel) return;
    savedShortcut = accel;
    localStorage.setItem('cloe-terminal-shortcut', accel);
    shortcutInput.value = electronAcceleratorToDisplay(accel);
    shortcutInput.blur();
  });

  shortcutClearBtn.addEventListener('click', () => {
    savedShortcut = '';
    localStorage.removeItem('cloe-terminal-shortcut');
    shortcutInput.value = '';
  });

  // Notify main process of current shortcut on load
  if (savedShortcut) {
    window.electronAPI?.setTerminalShortcut?.(savedShortcut);
  }

  // ── Canvas shortcut recorder ──
  const canvasShortcutInput = document.getElementById('pref-canvas-shortcut');
  const canvasShortcutClearBtn = document.getElementById('pref-canvas-shortcut-clear');
  let canvasSavedShortcut = localStorage.getItem('cloe-canvas-shortcut') || '';
  if (canvasSavedShortcut) canvasShortcutInput.value = electronAcceleratorToDisplay(canvasSavedShortcut);

  canvasShortcutInput.addEventListener('focus', () => {
    canvasShortcutInput.value = I18n.t('prefs.canvasShortcutHint');
    canvasShortcutInput.classList.add('shortcut-recording');
  });

  canvasShortcutInput.addEventListener('blur', () => {
    canvasShortcutInput.classList.remove('shortcut-recording');
    canvasShortcutInput.value = canvasSavedShortcut ? electronAcceleratorToDisplay(canvasSavedShortcut) : '';
  });

  canvasShortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accel = buildElectronAccelerator(e);
    if (!accel) return;
    canvasSavedShortcut = accel;
    localStorage.setItem('cloe-canvas-shortcut', accel);
    canvasShortcutInput.value = electronAcceleratorToDisplay(accel);
    canvasShortcutInput.blur();
  });

  canvasShortcutClearBtn.addEventListener('click', () => {
    canvasSavedShortcut = '';
    localStorage.removeItem('cloe-canvas-shortcut');
    canvasShortcutInput.value = '';
  });

  // ── Chat shortcut recorder ──
  const chatShortcutInput = document.getElementById('pref-chat-shortcut');
  const chatShortcutClearBtn = document.getElementById('pref-chat-shortcut-clear');
  let chatSavedShortcut = localStorage.getItem('cloe-chat-shortcut') || '';
  if (chatSavedShortcut) chatShortcutInput.value = electronAcceleratorToDisplay(chatSavedShortcut);

  chatShortcutInput.addEventListener('focus', () => {
    chatShortcutInput.value = I18n.t('prefs.chatShortcutHint');
    chatShortcutInput.classList.add('shortcut-recording');
  });

  chatShortcutInput.addEventListener('blur', () => {
    chatShortcutInput.classList.remove('shortcut-recording');
    chatShortcutInput.value = chatSavedShortcut ? electronAcceleratorToDisplay(chatSavedShortcut) : '';
  });

  chatShortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accel = buildElectronAccelerator(e);
    if (!accel) return;
    chatSavedShortcut = accel;
    localStorage.setItem('cloe-chat-shortcut', accel);
    chatShortcutInput.value = electronAcceleratorToDisplay(accel);
    chatShortcutInput.blur();
  });

  chatShortcutClearBtn.addEventListener('click', () => {
    chatSavedShortcut = '';
    localStorage.removeItem('cloe-chat-shortcut');
    chatShortcutInput.value = '';
  });

  // ── Chat transparency shortcut recorder ──
  const transShortcutInput = document.getElementById('pref-chat-transparency-shortcut');
  const transShortcutClearBtn = document.getElementById('pref-chat-transparency-shortcut-clear');
  let transSavedShortcut = localStorage.getItem('cloe-chat-transparency-shortcut') || '';
  if (transSavedShortcut) transShortcutInput.value = electronAcceleratorToDisplay(transSavedShortcut);

  transShortcutInput.addEventListener('focus', () => {
    transShortcutInput.value = I18n.t('prefs.chatTransparencyShortcutHint');
    transShortcutInput.classList.add('shortcut-recording');
  });

  transShortcutInput.addEventListener('blur', () => {
    transShortcutInput.classList.remove('shortcut-recording');
    transShortcutInput.value = transSavedShortcut ? electronAcceleratorToDisplay(transSavedShortcut) : '';
  });

  transShortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accel = buildElectronAccelerator(e);
    if (!accel) return;
    transSavedShortcut = accel;
    localStorage.setItem('cloe-chat-transparency-shortcut', accel);
    transShortcutInput.value = electronAcceleratorToDisplay(accel);
    transShortcutInput.blur();
  });

  transShortcutClearBtn.addEventListener('click', () => {
    transSavedShortcut = '';
    localStorage.removeItem('cloe-chat-transparency-shortcut');
    transShortcutInput.value = '';
  });

  // ── Chat pin shortcut recorder ──
  const pinShortcutInput = document.getElementById('pref-chat-pin-shortcut');
  const pinShortcutClearBtn = document.getElementById('pref-chat-pin-shortcut-clear');
  let pinSavedShortcut = localStorage.getItem('cloe-chat-pin-shortcut') || '';
  if (pinSavedShortcut) pinShortcutInput.value = electronAcceleratorToDisplay(pinSavedShortcut);

  pinShortcutInput.addEventListener('focus', () => {
    pinShortcutInput.value = I18n.t('prefs.chatPinShortcutHint');
    pinShortcutInput.classList.add('shortcut-recording');
  });

  pinShortcutInput.addEventListener('blur', () => {
    pinShortcutInput.classList.remove('shortcut-recording');
    pinShortcutInput.value = pinSavedShortcut ? electronAcceleratorToDisplay(pinSavedShortcut) : '';
  });

  pinShortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accel = buildElectronAccelerator(e);
    if (!accel) return;
    pinSavedShortcut = accel;
    localStorage.setItem('cloe-chat-pin-shortcut', accel);
    pinShortcutInput.value = electronAcceleratorToDisplay(accel);
    pinShortcutInput.blur();
  });

  pinShortcutClearBtn.addEventListener('click', () => {
    pinSavedShortcut = '';
    localStorage.removeItem('cloe-chat-pin-shortcut');
    pinShortcutInput.value = '';
  });

  // ── Chat focus input shortcut recorder ──
  const focusShortcutInput = document.getElementById('pref-chat-focus-shortcut');
  const focusShortcutClearBtn = document.getElementById('pref-chat-focus-shortcut-clear');
  let focusSavedShortcut = localStorage.getItem('cloe-chat-focus-shortcut') || '';
  if (focusSavedShortcut) focusShortcutInput.value = electronAcceleratorToDisplay(focusSavedShortcut);

  focusShortcutInput.addEventListener('focus', () => {
    focusShortcutInput.value = I18n.t('prefs.chatFocusShortcutHint');
    focusShortcutInput.classList.add('shortcut-recording');
  });

  focusShortcutInput.addEventListener('blur', () => {
    focusShortcutInput.classList.remove('shortcut-recording');
    focusShortcutInput.value = focusSavedShortcut ? electronAcceleratorToDisplay(focusSavedShortcut) : '';
  });

  focusShortcutInput.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accel = buildElectronAccelerator(e);
    if (!accel) return;
    focusSavedShortcut = accel;
    localStorage.setItem('cloe-chat-focus-shortcut', accel);
    focusShortcutInput.value = electronAcceleratorToDisplay(accel);
    focusShortcutInput.blur();
  });

  focusShortcutClearBtn.addEventListener('click', () => {
    focusSavedShortcut = '';
    localStorage.removeItem('cloe-chat-focus-shortcut');
    focusShortcutInput.value = '';
  });
}

/**
 * Build an Electron accelerator string from a KeyboardEvent.
 * Preserve all modifiers separately — don't collapse Ctrl+Cmd.
 */
function buildElectronAccelerator(e) {
  const parts = [];
  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  // Only register single letter keys or function keys
  if (/^F\d{1,2}$/.test(e.key)) {
    parts.push(e.key);
  } else if (e.key.length === 1) {
    parts.push(e.key.toUpperCase());
  } else {
    return null; // ignore modifier-only, arrows, etc.
  }
  return parts.join('+');
}

/**
 * Convert "Cmd+Control+T" → "⌘⌃T" for display.
 */
function electronAcceleratorToDisplay(accel) {
  return accel
    .replace(/CommandOrControl/g, '⌘')
    .replace(/Command/g, '⌘')
    .replace(/Cmd/g, '⌘')
    .replace(/Control/g, '⌃')
    .replace(/Ctrl/g, '⌃')
    .replace(/Alt/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, '');
}

function updatePreferencesText() {
  renderPreferences();
}
