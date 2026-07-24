/**
 * Cloe Desktop — Weather Engine
 *
 * Fetches weather data from Open-Meteo (free, no key) or QWeather (和风天气).
 * Polls every 30 min, broadcasts weather updates via WebSocket.
 *
 * Used by: launcher.js
 * Config: ~/.cloe/weather.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// ==================== Config ====================

const CONFIG_FILE = path.join(os.homedir(), '.cloe', 'weather.json');

const DEFAULT_CONFIG = {
  enabled: false,
  showWeather: true,         // Independent toggle for weather canvas visibility
  provider: 'open-meteo',   // 'open-meteo' | 'qweather'
  apiKey: '',                // QWeather API key (not needed for open-meteo)
  city: 'auto',              // 'auto' (timezone detection) or explicit city name
  intervalMin: 30,
};

let configCache = null;

function _loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
    return Object.assign({}, DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function _saveConfig(cfg) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  configCache = cfg;
}

function getConfig() {
  if (!configCache) configCache = _loadConfig();
  return configCache;
}

function updateConfig(updates) {
  configCache = Object.assign({}, getConfig(), updates);
  _saveConfig(configCache);
  return configCache;
}

// ==================== Broadcast ====================

let broadcastFn = null;
function setBroadcast(fn) { broadcastFn = fn; }
function broadcast(msg) {
  if (broadcastFn) { try { broadcastFn(msg); } catch {} }
}

// ==================== State ====================

let cachedWeather = null;
let previewRestoreTimer = null;
let pollTimer = null;
let cityLocation = null;  // { lat, lon, name } resolved city coords

// ==================== City Detection ====================

const TIMEZONE_CITY_MAP = {
  'Asia/Shanghai': 'Shanghai',
  'Asia/Chongqing': 'Chongqing',
  'Asia/Chengdu': 'Chengdu',
  'Asia/Beijing': 'Beijing',
  'Asia/Guangzhou': 'Guangzhou',
  'Asia/Shenzhen': 'Shenzhen',
  'Asia/Hangzhou': 'Hangzhou',
  'Asia/Nanjing': 'Nanjing',
  'Asia/Wuhan': 'Wuhan',
  'Asia/Xi_an': "Xi'an",
  'Asia/Tianjin': 'Tianjin',
  'Asia/Harbin': 'Harbin',
  'Asia/Kunming': 'Kunming',
  'Asia/Urumqi': 'Urumqi',
  'Asia/Lhasa': 'Lhasa',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Taipei': 'Taipei',
  'Asia/Tokyo': 'Tokyo',
  'Asia/Seoul': 'Seoul',
  'Asia/Singapore': 'Singapore',
  'America/New_York': 'New York',
  'America/Los_Angeles': 'Los Angeles',
  'America/Chicago': 'Chicago',
  'Europe/London': 'London',
  'Europe/Paris': 'Paris',
  'Europe/Berlin': 'Berlin',
};

function detectCityFromTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TIMEZONE_CITY_MAP[tz]) return TIMEZONE_CITY_MAP[tz];
    // Fallback: last segment of timezone
    if (tz) {
      const last = tz.split('/').pop().replace(/_/g, ' ');
      return last;
    }
  } catch {}
  return 'Shanghai'; // default fallback
}

// ==================== HTTP Helper ====================

function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ==================== Geocoding ====================

async function geocodeCity(cityName) {
  if (cityName === 'auto') {
    cityName = detectCityFromTimezone();
  }

  // Open-Meteo Geocoding API (free, no key)
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=zh`;
    const data = await httpGet(url);
    if (data.results && data.results.length > 0) {
      const r = data.results[0];
      return { lat: r.latitude, lon: r.longitude, name: r.name };
    }
  } catch (e) {
    console.error('[Weather] Geocoding failed:', e.message);
  }
  return null;
}

// ==================== Weather Providers ====================

/**
 * WMO Weather Code → normalized weather type
 * Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
 */
function mapWmoCode(code, temp, visibility, windSpeed, precipitation) {
  // Thunderstorm
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  // Rain
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'rain';
  // Freezing rain → icy
  if ([56, 57, 66, 67].includes(code)) return 'icy';
  // Snow
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    // If temp is very low, treat as icy instead of snow
    if (temp !== undefined && temp <= -5) return 'icy';
    return 'snow';
  }
  // Fog
  if ([45, 48].includes(code)) return 'fog';
  // Sandstorm
  if (visibility !== undefined && windSpeed !== undefined && precipitation !== undefined) {
    if (visibility < 2000 && windSpeed > 40 && precipitation < 1) return 'sandstorm';
  }
  // Cloudy (overcast / partly cloudy)
  if ([2, 3].includes(code)) return 'cloudy';
  // Clear (sunny)
  if ([0, 1].includes(code)) {
    // If very cold and clear, could be icy conditions
    if (temp !== undefined && temp <= -5) return 'icy';
    return 'clear';
  }
  return 'clear';
}

async function fetchOpenMeteo(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,rain,showers,snowfall,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,is_day` +
    `&timezone=auto`;

  const data = await httpGet(url);
  const c = data.current;
  if (!c) throw new Error('No current weather data');

  const code = c.weather_code ?? 0;
  const weatherType = mapWmoCode(
    code,
    c.temperature_2m,
    c.visibility ?? 10000,
    c.wind_speed_10m ?? 0,
    c.precipitation ?? 0
  );

  return {
    provider: 'open-meteo',
    city: cityLocation?.name || detectCityFromTimezone(),
    temp: Math.round(c.temperature_2m),
    feelsLike: Math.round(c.apparent_temperature ?? c.temperature_2m),
    humidity: c.relative_humidity_2m ?? 0,
    weatherCode: code,
    weatherType,                 // clear | cloudy | rain | snow | fog | thunderstorm | sandstorm
    text: describeWeather(weatherType, code),
    isDay: c.is_day === 1,
    windSpeed: c.wind_speed_10m ?? 0,
    windDir: c.wind_direction_10m ?? 0,
    windGusts: c.wind_gusts_10m ?? 0,
    cloudCover: c.cloud_cover ?? 0,
    visibility: c.visibility ?? 10000,
    rain: c.rain ?? 0,
    showers: c.showers ?? 0,
    snowfall: c.snowfall ?? 0,
    precipitation: c.precipitation ?? 0,
  };
}

/**
 * QWeather code → normalized weather type
 * Reference: https://dev.qweather.com/docs/resource/warning-and-info/info/
 */
function mapQWeatherCode(code) {
  const c = parseInt(code);
  if (!isNaN(c)) {
    if (c >= 100 && c <= 103) return 'clear';
    if (c >= 104 && c <= 154) return 'cloudy';
    if (c >= 300 && c <= 399) return 'rain';
    if (c >= 400 && c <= 499) return 'snow';
    if (c >= 500 && c <= 599) return 'fog';
    if (c >= 600 && c <= 699) return 'thunderstorm';
  }
  return 'clear';
}

async function fetchQWeather(lat, lon, apiKey) {
  // QWeather City Lookup is location-id based; use lat,lon directly
  const location = `${lon.toFixed(2)},${lat.toFixed(2)}`;
  const url = `https://devapi.qweather.com/v7/weather/now?location=${location}&key=${apiKey}`;
  const data = await httpGet(url);
  if (data.code !== '200') throw new Error(`QWeather error: ${data.code}`);

  const n = data.now;
  const weatherType = mapQWeatherCode(n.icon);
  return {
    provider: 'qweather',
    city: cityLocation?.name || detectCityFromTimezone(),
    temp: parseInt(n.temp) || 0,
    feelsLike: parseInt(n.feels) || 0,
    humidity: parseInt(n.humidity) || 0,
    weatherCode: n.icon,
    weatherType,
    text: n.text,
    isDay: true,
    windSpeed: parseFloat(n.windSpeed) || 0,
    windDir: parseFloat(n.wind360) || 0,
    windGusts: parseFloat(n.windSpeed) || 0,
    cloudCover: 0,
    visibility: parseFloat(n.vis) * 1000 || 10000,
    rain: 0,
    showers: 0,
    snowfall: 0,
    precipitation: parseFloat(n.precip) || 0,
  };
}

function describeWeather(type, code) {
  const map = {
    clear: '晴', cloudy: '多云', rain: '雨', snow: '雪',
    fog: '雾', thunderstorm: '雷雨', sandstorm: '沙尘暴', icy: '结冰',
  };
  return map[type] || '晴';
}

// ==================== Core Fetch Cycle ====================

async function fetchWeatherOnce() {
  const cfg = getConfig();
  if (!cfg.enabled) return;

  // Resolve city location if not yet resolved or city changed
  if (!cityLocation) {
    cityLocation = await geocodeCity(cfg.city);
    if (!cityLocation) {
      console.error('[Weather] Could not resolve city:', cfg.city);
      return;
    }
    console.log('[Weather] City resolved:', cityLocation.name, cityLocation.lat, cityLocation.lon);
  }

  try {
    let weather;
    if (cfg.provider === 'qweather' && cfg.apiKey) {
      weather = await fetchQWeather(cityLocation.lat, cityLocation.lon, cfg.apiKey);
    } else {
      weather = await fetchOpenMeteo(cityLocation.lat, cityLocation.lon);
    }

    cachedWeather = weather;
    console.log(`[Weather] ${weather.city}: ${weather.text} ${weather.temp}°C (${weather.weatherType})`);

    broadcast({ type: 'weather-update', weather });
  } catch (e) {
    console.error('[Weather] Fetch failed:', e.message);
  }
}

function startPolling() {
  const cfg = getConfig();
  if (pollTimer) clearInterval(pollTimer);
  if (!cfg.enabled) return;

  // Initial fetch
  fetchWeatherOnce();

  // Poll interval
  const intervalMs = Math.max(5, cfg.intervalMin || 30) * 60 * 1000;
  pollTimer = setInterval(fetchWeatherOnce, intervalMs);
  console.log(`[Weather] Polling every ${cfg.intervalMin}min via ${cfg.provider}`);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/** Called when config changes — re-resolve city and restart polling */
function onConfigChanged() {
  cityLocation = null; // force re-resolve
  stopPolling();
  startPolling();
}

/** Force a re-fetch now (e.g. "test" button in settings) */
async function testFetch() {
  cityLocation = null;
  await fetchWeatherOnce();
  return cachedWeather;
}

// ==================== HTTP Routes ====================

function handleWeatherRoute(req, res) {
  const urlPath = (req.url || '').split('?')[0];

  // GET /weather/config
  if (req.method === 'GET' && urlPath === '/weather/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getConfig()));
    return true;
  }

  // POST /weather/config — update config
  if (req.method === 'POST' && urlPath === '/weather/config') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const updates = {};
        if (data.enabled !== undefined) updates.enabled = !!data.enabled;
        if (data.showWeather !== undefined) updates.showWeather = !!data.showWeather;
        if (data.provider !== undefined) updates.provider = data.provider;
        if (data.apiKey !== undefined) updates.apiKey = String(data.apiKey || '');
        if (data.city !== undefined) updates.city = String(data.city || 'auto');
        if (data.intervalMin !== undefined) updates.intervalMin = Math.max(5, parseInt(data.intervalMin) || 30);
        const cfg = updateConfig(updates);

        // Restart polling with new config
        onConfigChanged();

        broadcast({ type: 'weather-config-changed', config: cfg });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cfg));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
    });
    return true;
  }

  // POST /weather/toggle — flip enabled state
  if (req.method === 'POST' && urlPath === '/weather/toggle') {
    const cfg = getConfig();
    const newCfg = updateConfig({ enabled: !cfg.enabled });
    onConfigChanged();
    broadcast({ type: 'weather-config-changed', config: newCfg });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(newCfg));
    return true;
  }

  // POST /weather/preview — preview a specific weather type (no auto-restore)
  if (req.method === 'POST' && urlPath === '/weather/preview') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const wt = data.weatherType || 'rain';
        const specialType = data.specialType || null;
        const isNight = data.isNight === true;

        // Cancel any previous restore timer
        if (previewRestoreTimer) { clearTimeout(previewRestoreTimer); previewRestoreTimer = null; }

        // Build base weather from type
        const baseTemplates = {
          rain: { weatherCode: 61, weatherType: 'rain', text: '预览-雨', temp: isNight ? 18 : 20, rain: 5, precipitation: 5, cloudCover: 80, visibility: 5000, windSpeed: 10, windDir: 90, humidity: 85 },
          snow: { weatherCode: 71, weatherType: 'snow', text: '预览-雪', temp: isNight ? -5 : -3, snowfall: 3, precipitation: 3, cloudCover: 90, visibility: 3000, windSpeed: 5, windDir: 0, humidity: 75 },
          fog: { weatherCode: 45, weatherType: 'fog', text: '预览-雾', temp: 10, cloudCover: 100, visibility: 500, windSpeed: 2, windDir: 0, humidity: 95 },
          thunderstorm: { weatherCode: 95, weatherType: 'thunderstorm', text: '预览-雷暴', temp: 22, rain: 15, precipitation: 15, cloudCover: 95, visibility: 2000, windSpeed: 20, windDir: 180, humidity: 90 },
          clear: { weatherCode: 0, weatherType: 'clear', text: '晴', temp: isNight ? 20 : 25, cloudCover: 5, visibility: 20000, windSpeed: isNight ? 2 : 3, windDir: 45, humidity: isNight ? 50 : 40 },
          cloudy: { weatherCode: 3, weatherType: 'cloudy', text: '多云', temp: isNight ? 15 : 18, cloudCover: 75, visibility: 12000, windSpeed: isNight ? 5 : 8, windDir: 90, humidity: 60 },
          icy: { weatherCode: 77, weatherType: 'icy', text: '预览-结冰', temp: -8, snowfall: 0, precipitation: 0, cloudCover: 60, visibility: 8000, windSpeed: 6, windDir: 0, humidity: 85 },
        };

        const base = baseTemplates[wt] || baseTemplates.rain;
        const w = { provider: 'preview', city: '预览', feelsLike: base.temp, windGusts: base.windSpeed * 2, showers: 0, snowfall: base.snowfall || 0, ...base, isDay: !isNight };
        cachedWeather = w;
        broadcast({ type: 'weather-update', weather: w });

        // If special type requested, tell the canvas to show it immediately
        if (specialType) {
          broadcast({ type: 'weather-special-preview', specialType });
        } else {
          broadcast({ type: 'weather-special-preview', specialType: null });
        }

        console.log(`[Weather] Preview: ${wt}${specialType ? '+' + specialType : ''} ${isNight ? '(night)' : '(day)'}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // POST /weather/preview-end — end preview, restore real weather
  if (req.method === 'POST' && urlPath === '/weather/preview-end') {
    if (previewRestoreTimer) { clearTimeout(previewRestoreTimer); previewRestoreTimer = null; }
    broadcast({ type: 'weather-special-preview', specialType: null });
    testFetch().then(realW => {
      broadcast({ type: 'weather-update', weather: realW });
    }).catch(() => {});
    console.log('[Weather] Preview ended, restoring real weather');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // GET /weather/now — get current cached weather
  if (req.method === 'GET' && urlPath === '/weather/now') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ weather: cachedWeather }));
    return true;
  }

  // POST /weather/test — force fetch
  if (req.method === 'POST' && urlPath === '/weather/test') {
    testFetch()
      .then((w) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ weather: w }));
      })
      .catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
    return true;
  }

  // POST /weather/inject — inject fake weather for testing
  if (req.method === 'POST' && urlPath === '/weather/inject') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const wt = data.weatherType || 'rain';
        const templates = {
          rain: { weatherCode: 61, weatherType: 'rain', text: '测试-雨', temp: 20, rain: 5, precipitation: 5, cloudCover: 80, visibility: 5000, windSpeed: 10, windDir: 90, humidity: 85, isDay: true },
          snow: { weatherCode: 71, weatherType: 'snow', text: '测试-雪', temp: -3, snowfall: 3, precipitation: 3, cloudCover: 90, visibility: 3000, windSpeed: 5, windDir: 0, humidity: 75, isDay: true },
          fog: { weatherCode: 45, weatherType: 'fog', text: '测试-雾', temp: 10, cloudCover: 100, visibility: 500, windSpeed: 2, windDir: 0, humidity: 95, isDay: true },
          thunderstorm: { weatherCode: 95, weatherType: 'thunderstorm', text: '测试-雷暴', temp: 22, rain: 15, precipitation: 15, cloudCover: 95, visibility: 2000, windSpeed: 20, windDir: 180, humidity: 90, isDay: true },
          clear: { weatherCode: 0, weatherType: 'clear', text: '晴', temp: 25, cloudCover: 5, visibility: 20000, windSpeed: 3, windDir: 45, humidity: 40, isDay: true },
          cloudy: { weatherCode: 3, weatherType: 'cloudy', text: '多云', temp: 18, cloudCover: 75, visibility: 12000, windSpeed: 8, windDir: 90, humidity: 60, isDay: true },
          icy: { weatherCode: 77, weatherType: 'icy', text: '测试-结冰', temp: -8, snowfall: 0, precipitation: 0, cloudCover: 60, visibility: 8000, windSpeed: 6, windDir: 0, humidity: 85, isDay: true },
          // Night variants
          'clear-night': { weatherCode: 0, weatherType: 'clear', text: '晴(夜)', temp: 20, cloudCover: 5, visibility: 20000, windSpeed: 2, windDir: 0, humidity: 50, isDay: false },
          'cloudy-night': { weatherCode: 3, weatherType: 'cloudy', text: '多云(夜)', temp: 15, cloudCover: 75, visibility: 12000, windSpeed: 5, windDir: 90, humidity: 60, isDay: false },
          'rain-night': { weatherCode: 61, weatherType: 'rain', text: '雨(夜)', temp: 18, rain: 5, precipitation: 5, cloudCover: 85, visibility: 5000, windSpeed: 10, windDir: 90, humidity: 85, isDay: false },
          'snow-night': { weatherCode: 71, weatherType: 'snow', text: '雪(夜)', temp: -3, snowfall: 3, precipitation: 3, cloudCover: 90, visibility: 3000, windSpeed: 5, windDir: 0, humidity: 75, isDay: false },
        };
        const fake = templates[wt] || templates.rain;
        const w = { provider: 'inject', city: '测试', feelsLike: fake.temp, windGusts: fake.windSpeed * 2, showers: 0, snowfall: fake.snowfall || 0, ...fake };
        cachedWeather = w;
        broadcast({ type: 'weather-update', weather: w });
        console.log(`[Weather] Injected: ${wt}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ weather: w }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  return false;
}

// ==================== Init ====================

function init() {
  const cfg = getConfig();
  if (cfg.enabled) {
    startPolling();
  } else {
    console.log('[Weather] Disabled (enable in settings)');
  }
}

// ==================== Exports ====================

module.exports = {
  init,
  setBroadcast,
  getConfig,
  updateConfig,
  handleWeatherRoute,
  startPolling,
  stopPolling,
  onConfigChanged,
  testFetch,
};
