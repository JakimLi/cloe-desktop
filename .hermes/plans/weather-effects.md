# Weather Effects — Implementation Plan

## Overview
4 new files + 5 minimal integration touches. Zero logic changes to existing files.

## Architecture

```
┌─ launcher.js ────────────────────────────────┐
│  require('./weather-engine')                  │
│  weatherEngine.setBroadcast(broadcastToClients)│
│  HTTP routes: /weather/config, /weather/now    │
│  Config stored in ~/.cloe/weather.json         │
└───────────────────────────────────────────────┘
         │ WS broadcast: { type: 'weather-update', weather }
         ▼
┌─ renderer.js (existing WS handler) ───────────┐
│  Forward weather-update to window event       │
│  +1 line: weather-canvas listens              │
└───────────────────────────────────────────────┘
         │
         ▼
┌─ weather-canvas.js (new, loaded in index.html)┐
│  Canvas#weather-canvas (z-index:2, behind char)│
│  Particle effects: rain/snow/clouds/lightning  │
│  Auto-hides when overlay is opaque             │
└───────────────────────────────────────────────┘
```

## New Files

### 1. `weather-engine.js` (backend Node module)
- **Providers**: pluggable architecture
  - `qweather` (和风天气) — needs API key
  - `open-meteo` (免费无需key, open-meteo.com) — default, no key needed
- **City detection**:
  1. Config override (`city` field in weather.json)
  2. Timezone → city mapping (`Asia/Shanghai` → `Shanghai`)
  3. Open-Meteo geocoding API (city name → lat/lon)
- **Polling**: every 30 min (configurable)
- **Normalized output**: `{ provider, city, temp, text, code, weatherType }`
  - `weatherType`: one of `clear | cloudy | rain | snow | fog | thunderstorm`
- **Config**: `~/.cloe/weather.json`
  ```json
  { "enabled": true, "provider": "open-meteo", "apiKey": "", "city": "auto", "intervalMin": 30 }
  ```
- **HTTP routes** (added to launcher.js):
  - `GET /weather/config` → return config
  - `POST /weather/config` → update config
  - `GET /weather/now` → return current cached weather
- Exports: `{ init, setBroadcast, handleWeatherRoute, getConfig, updateConfig }`

### 2. `src/weather-canvas.js` (frontend, Vanilla JS IIFE)
- Creates `<canvas id="weather-canvas">` dynamically
- CSS: `position:fixed; inset:0; z-index:2; pointer-events:none;`
- Listens for WS `weather-update` via custom event from renderer.js
- Particle system per weather type:
  - **rain**: semi-transparent vertical lines, wind drift, splash at bottom
  - **snow**: white circles, sinusoidal horizontal sway, slow fall
  - **cloudy**: subtle moving gray gradient bands
  - **fog**: horizontal semi-transparent streaks drifting slowly
  - **thunderstorm**: rain + random screen flash (white overlay, 1 frame)
  - **clear**: nothing (or very subtle floating light motes)
- requestAnimationFrame loop, ~30fps target (skip frames)
- Canvas resize on window resize
- **Visibility logic**:
  - Watch `#react-root .terminal-overlay` class changes via MutationObserver
  - If `overlay-opaque` → `canvas.style.opacity = 0`
  - Otherwise → `canvas.style.opacity = 1`
  - Also check on init: if no terminal visible, always show

### 3. `public/manager/weather.js` (settings page tab)
- New sidebar item: Weather (cloud icon)
- Fields:
  - Enable toggle
  - Provider select: Open-Meteo (Free) / QWeather (和风天气)
  - API Key input (shown only when provider = qweather, hidden for open-meteo)
  - City input (default: auto-detect)
  - Test button → fetches weather and shows result
- Saves via `POST /weather/config`
- Loads via `GET /weather/config`

### 4. CSS additions
- `src/style.css`: `#weather-canvas` rule (5 lines)
- `public/manager/manager.css`: weather tab styling (reuse existing patterns)

## Integration Points (minimal touches)

### index.html (+2 lines)
```html
<!-- before react-root -->
<canvas id="weather-canvas"></canvas>
<!-- before main.jsx -->
<script type="module" src="/src/weather-canvas.js"></script>
```

### renderer.js (+3 lines)
In WS message handler, after reminder forwarding:
```js
if (msg.type === 'weather-update') {
  window.dispatchEvent(new CustomEvent('cloe-weather', { detail: msg }));
}
```

### launcher.js (+3 lines)
```js
const weatherEngine = require('./weather-engine');
// In init:
weatherEngine.setBroadcast(broadcastToClients);
weatherEngine.init();
// In HTTP router:
if (weatherEngine.handleWeatherRoute(req, res)) return;
```

### style.css (+5 lines)
```css
#weather-canvas {
  position: fixed; inset: 0; z-index: 2;
  pointer-events: none; transition: opacity 0.3s ease;
}
```

### manager/index.html (+2 lines)
- New sidebar button + tab panel div
- Script tag for weather.js

## Z-Index Stack (final)
```
z-10  ws-status, settings-btn, gif-container
z-5   react-root (terminal overlay)
z-3   reminder-overlay
z-2   weather-canvas (NEW — behind everything)
auto  gif-container (character, bottom layer)
```

Wait — gif-container has z-index auto (default). weather-canvas at z:2 would be ABOVE the character. Need to fix:
- weather-canvas should be z-index: 0 or use a negative z-index
- Or place it as a child of body before gif-container

Better approach: **weather-canvas z-index: 0** (below gif-container which is z-index auto but comes first in DOM). Actually, both are `position:fixed`/`position:absolute`, so z-index matters. gif-container doesn't set z-index explicitly, so it's `auto`. Setting weather-canvas to `z-index: -1` puts it behind everything including body background.

Actually looking at the CSS: `#gif-container` has no explicit z-index but `#react-root` has `z-index: 5`. Since gif-container is rendered first in DOM and has no z-index, it creates a stacking context at the default level. Setting weather-canvas to `z-index: -1` would put it behind the transparent background.

**Solution**: weather-canvas as `z-index: 1` and set gif-container to `z-index: 2` (small bump). This keeps weather behind character but above the transparent body background. Actually simplest: just put weather-canvas BEFORE gif-container in DOM with the same z-index level.

**Final decision**: Put `<canvas id="weather-canvas">` as the FIRST element in body, before gif-container. Give it `z-index: 1`. Give gif-container `position: relative; z-index: 2`. This way:
- weather canvas (z:1) — bottom
- character (z:2) — above weather
- terminal overlay (z:5) — above character
- When overlay is opaque (solid black bg), weather is hidden behind it

## Weather Type Mapping

### Open-Meteo WMO Weather Codes
| Code | Description | weatherType |
|------|------------|-------------|
| 0    | Clear sky | clear |
| 1-3  | Partly cloudy | clear |
| 45,48| Fog | fog |
| 51-57| Drizzle | rain |
| 61-67| Rain | rain |
| 71-77| Snow | snow |
| 80-82| Rain showers | rain |
| 85-86| Snow showers | snow |
| 95-99| Thunderstorm | thunderstorm |

### QWeather Codes
| Code | Description | weatherType |
|------|------------|-------------|
| 100-103| Clear/Partly cloudy | clear |
| 104   | Overcast | cloudy |
| 150-154| Cloudy | cloudy |
| 300-399| Rain variants | rain |
| 400-499| Snow variants | snow |
| 500-599| Fog/Haze | fog |
| 600-699| Thunderstorm | thunderstorm |

## Performance
- Canvas 2D, target 30fps (skip every other frame)
- Particle count adaptive: rain ~100, snow ~60, fog ~5 bands
- No DOM manipulation during animation (pure canvas)
- Canvas resizes on window resize (debounced)
- Animation pauses when weather is `clear` (no particles needed)

## Failure Modes
- API unreachable → keep last known weather, retry next interval
- Invalid config → no weather effects, silent
- Canvas not supported → no effects, no crash
