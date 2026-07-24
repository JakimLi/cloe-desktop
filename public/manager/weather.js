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
            <div class="pref-desc">${t('根据当前天气在桌面显示雨雪等动态特效，独立于窗口透明度', 'Show dynamic particle effects based on current weather, independent of window opacity')}</div>
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

    <div class="pref-section">
      <h2 class="pref-section-title">${t('特效预览', 'Effect Preview')}</h2>
      <div class="pref-group">
        <div class="pref-item" style="flex-direction:column;align-items:stretch;">
          <div class="pref-info" style="margin-bottom:10px;">
            <div class="pref-label">${t('点击预览天气特效', 'Click to preview weather effects')}</div>
            <div class="pref-desc">${t('选择白天或夜晚，点击天气类型预览。点击「结束预览」恢复真实天气', 'Choose day or night, click a weather type to preview. Click "End Preview" to restore real weather')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;">
              <input type="radio" name="preview-time" value="day" checked> ${t('☀️ 白天', '☀️ Day')}
            </label>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;">
              <input type="radio" name="preview-time" value="night"> ${t('🌙 夜晚', '🌙 Night')}
            </label>
          </div>
          <div id="weather-preview-grid" style="display:flex;flex-wrap:wrap;gap:8px;padding-left:0;margin-bottom:12px;">
            ${[
              ['clear', '☀️ ' + t('晴天', 'Clear')],
              ['cloudy', '☁️ ' + t('多云', 'Cloudy')],
              ['rain', '🌧️ ' + t('雨', 'Rain')],
              ['snow', '❄️ ' + t('雪', 'Snow')],
              ['fog', '🌫️ ' + t('雾', 'Fog')],
              ['thunderstorm', '⛈️ ' + t('雷暴', 'Thunderstorm')],
              ['icy', '🧊 ' + t('结冰', 'Icy')],
            ].map(([wt, label]) => `<button type="button" class="btn btn-secondary btn-sm weather-preview-btn" data-wt="${wt}">${label}</button>`).join('')}
          </div>
        </div>

        <div class="pref-item" style="flex-direction:column;align-items:stretch;">
          <div class="pref-info" style="margin-bottom:10px;">
            <div class="pref-label">${t('特殊天象', 'Special Phenomena')}</div>
            <div class="pref-desc">${t('罕见的天气奇观，叠加在当前预览的天气之上', 'Rare weather phenomena, overlaid on current preview weather')}</div>
          </div>
          <div id="weather-special-grid" style="display:flex;flex-wrap:wrap;gap:8px;padding-left:0;margin-bottom:12px;">
            ${[
              ['meteor', '🌠 ' + t('流星雨', 'Meteor Shower')],
              ['fireball', '🔥 ' + t('火流星', 'Fireball')],
              ['aurora', '🌌 ' + t('极光', 'Aurora')],
              ['rainbow', '🌈 ' + t('彩虹', 'Rainbow')],
              ['sundog', '☀️ ' + t('日晕', 'Sundog')],
            ].map(([st, label]) => `<button type="button" class="btn btn-secondary btn-sm weather-special-btn" data-st="${st}">${label}</button>`).join('')}
          </div>
        </div>

        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${t('结束预览', 'End Preview')}</div>
            <div class="pref-desc">${t('恢复当前真实天气', 'Restore current real weather')}</div>
          </div>
          <div class="pref-control">
            <button type="button" class="btn btn-primary btn-sm" id="weather-preview-end-btn">${t('结束预览', 'End Preview')}</button>
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

  // --- Preview buttons ---
  function getPreviewIsNight() {
    const checked = document.querySelector('input[name="preview-time"]:checked');
    return checked ? checked.value === 'night' : false;
  }

  document.querySelectorAll('.weather-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wt = btn.dataset.wt;
      const isNight = getPreviewIsNight();
      fetch(`${API_WEATHER_BASE}/weather/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weatherType: wt, isNight }),
      }).catch(() => {});
    });
  });

  // --- Special phenomena preview ---
  // Special phenomena need matching conditions, so we pick the right weather backdrop
  const SPECIAL_BACKDROP = {
    meteor: 'clear',
    fireball: 'clear',
    aurora: 'clear',
    rainbow: 'rain',
    sundog: 'clear',
  };
  document.querySelectorAll('.weather-special-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const st = btn.dataset.st;
      const isNight = getPreviewIsNight();
      // Some specials only make sense at night, override isNight for those
      const forceNight = st === 'meteor' || st === 'fireball' || st === 'aurora';
      const actualNight = forceNight ? true : isNight;
      const backdrop = SPECIAL_BACKDROP[st] || 'clear';
      fetch(`${API_WEATHER_BASE}/weather/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weatherType: backdrop, specialType: st, isNight: actualNight }),
      }).catch(() => {});
    });
  });

  // --- End preview button ---
  document.getElementById('weather-preview-end-btn').addEventListener('click', () => {
    fetch(`${API_WEATHER_BASE}/weather/preview-end`, { method: 'POST' }).catch(() => {});
  });

  loadConfig();
}

// Expose for manager.js tab switching
window.initWeatherTab = initWeatherTab;
