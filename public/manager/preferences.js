// ==================== Cloe Settings — Preferences Tab ====================

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
              <button class="segment ${currentLocale === 'zh-CN' ? 'active' : ''}" data-locale="zh-CN">中文</button>
              <button class="segment ${currentLocale === 'en-US' ? 'active' : ''}" data-locale="en-US">English</button>
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
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('prefs.about')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">Cloe Desktop</div>
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
}

function updatePreferencesText() {
  renderPreferences();
}
