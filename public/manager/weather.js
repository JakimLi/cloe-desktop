// ==================== Cloe Settings — Weather Tab ====================

const API_WEATHER_BASE = 'http://127.0.0.1:19851';

function initWeatherTab() {
  renderWeather();
}

function renderWeather() {
  const container = document.getElementById('weather-content');
  if (!container) return;

  const isZh = (typeof I18n !== 'undefined' && I18n.getLocale()?.startsWith('zh')) || document.documentElement.lang?.startsWith('zh');
  const t = (zh, en) => (isZh ? zh : en);

  container.innerHTML = `
    <div class="pref-section">
      <h2 class="pref-section-title">${t('天气特效', 'Weather Effects')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${t('启用天气特效', 'Enable Weather Effects')}</div>
            <div class="pref-desc">${t('根据当前天气在桌面显示雨雪等动态特效', 'Show dynamic particle effects based on current weather')}</div>
          </div>
          <div class="pref-control">
            <label class="toggle">
              <input type="checkbox" id="weather-enabled">
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${t('数据源', 'Provider')}</div>
            <div class="pref-desc">${t('选择天气数据提供商', 'Choose weather data provider')}</div>
          </div>
          <div class="pref-control">
            <select id="weather-provider" class="form-input form-select" style="width:220px;">
              <option value="open-meteo">Open-Meteo (${t('免费无需Key', 'Free, no key')})</option>
              <option value="qweather">${t('和风天气', 'QWeather')} (${t('需API Key', 'requires key')})</option>
            </select>
          </div>
        </div>

        <div class="pref-item" id="weather-apikey-row" style="display:none;">
          <div class="pref-info">
            <div class="pref-label">${t('API Key', 'API Key')}</div>
            <div class="pref-desc">${t('和风天气API Key', 'QWeather API Key')}</div>
          </div>
          <div class="pref-control">
            <div class="pref-api-key-wrap">
              <input type="password" id="weather-apikey" class="form-input" placeholder="${t('输入API Key', 'Enter API Key')}" autocomplete="off" spellcheck="false">
              <button type="button" class="btn-icon btn-icon-sm" id="weather-apikey-toggle" title="${t('显示/隐藏', 'Show/Hide')}">👁</button>
            </div>
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${t('城市', 'City')}</div>
            <div class="pref-desc">${t('留空或填auto自动检测，也可手动指定城市名', 'Leave empty or "auto" for auto-detect, or specify a city name')}</div>
          </div>
          <div class="pref-control">
            <input type="text" id="weather-city" class="form-input" style="width:220px;" placeholder="${t('auto / 成都 / Chengdu', 'auto / Chengdu')}">
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${t('刷新间隔', 'Refresh Interval')}</div>
            <div class="pref-desc">${t('天气数据刷新频率', 'How often to refresh weather data')}</div>
          </div>
          <div class="pref-control">
            <select id="weather-interval" class="form-input form-select" style="width:120px;">
              <option value="5">5 ${t('分钟', 'min')}</option>
              <option value="15">15 ${t('分钟', 'min')}</option>
              <option value="30" selected>30 ${t('分钟', 'min')}</option>
              <option value="60">60 ${t('分钟', 'min')}</option>
            </select>
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${t('测试连接', 'Test Connection')}</div>
            <div class="pref-desc">${t('立即获取天气数据并显示效果', 'Fetch weather now and apply effects')}</div>
          </div>
          <div class="pref-control">
            <button type="button" class="btn btn-primary btn-sm" id="weather-test-btn">${t('测试', 'Test')}</button>
            <span id="weather-test-result" style="font-size:12px;margin-left:8px;"></span>
          </div>
        </div>

      </div>
    </div>
  `;

  // --- Load current config ---
  const enabledToggle = document.getElementById('weather-enabled');
  const providerSelect = document.getElementById('weather-provider');
  const apikeyRow = document.getElementById('weather-apikey-row');
  const apikeyInput = document.getElementById('weather-apikey');
  const apikeyToggle = document.getElementById('weather-apikey-toggle');
  const cityInput = document.getElementById('weather-city');
  const intervalSelect = document.getElementById('weather-interval');
  const testBtn = document.getElementById('weather-test-btn');
  const testResult = document.getElementById('weather-test-result');

  function updateApikeyVisibility() {
    apikeyRow.style.display = providerSelect.value === 'qweather' ? 'flex' : 'none';
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${API_WEATHER_BASE}/weather/config`);
      const cfg = await res.json();
      enabledToggle.checked = cfg.enabled || false;
      providerSelect.value = cfg.provider || 'open-meteo';
      apikeyInput.value = cfg.apiKey || '';
      cityInput.value = cfg.city === 'auto' ? '' : (cfg.city || '');
      intervalSelect.value = String(cfg.intervalMin || 30);
      updateApikeyVisibility();
    } catch (e) {
      // bridge offline
    }
  }

  function saveConfig() {
    const payload = {
      enabled: enabledToggle.checked,
      provider: providerSelect.value,
      apiKey: apikeyInput.value.trim(),
      city: cityInput.value.trim() || 'auto',
      intervalMin: parseInt(intervalSelect.value),
    };
    fetch(`${API_WEATHER_BASE}/weather/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  // --- Bind events ---
  enabledToggle.addEventListener('change', saveConfig);
  providerSelect.addEventListener('change', () => { updateApikeyVisibility(); saveConfig(); });
  cityInput.addEventListener('change', saveConfig);
  intervalSelect.addEventListener('change', saveConfig);

  apikeyToggle.addEventListener('click', () => {
    apikeyInput.type = apikeyInput.type === 'password' ? 'text' : 'password';
  });
  apikeyInput.addEventListener('change', saveConfig);

  testBtn.addEventListener('click', async () => {
    saveConfig();
    testBtn.disabled = true;
    testResult.textContent = t('测试中…', 'Testing…');
    testResult.style.color = '';
    try {
      const res = await fetch(`${API_WEATHER_BASE}/weather/test`, { method: 'POST' });
      const data = await res.json();
      if (data.weather) {
        const w = data.weather;
        testResult.textContent = `${w.city}: ${w.text} ${w.temp}°C`;
        testResult.style.color = 'var(--accent)';
      } else {
        testResult.textContent = t('未获取到天气数据', 'No weather data');
        testResult.style.color = 'var(--danger, #e57373)';
      }
    } catch (e) {
      testResult.textContent = t('连接失败', 'Failed');
      testResult.style.color = 'var(--danger, #e57373)';
    }
    testBtn.disabled = false;
  });

  loadConfig();
}

// Expose for manager.js tab switching
window.initWeatherTab = initWeatherTab;
