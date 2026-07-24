/**
 * Cloe Desktop — Weather Canvas (Particle Engine)
 *
 * Renders weather particle effects on a full-viewport canvas behind the character.
 * Supports: rain, snow, fog, thunderstorm (lightning), cloudy, clear.
 *
 * Architecture ported from greywen/web-weather (MIT) — SoA + Float32Array,
 * object pooling, batched draw, pre-rendered textures.
 * Converted from React/TypeScript to Vanilla JS IIFE.
 *
 * Loaded by index.html, listens for 'cloe-weather' custom events from WS.
 */

(function WeatherCanvas() {
  'use strict';

  // ==================== Canvas Setup ====================

  const canvas = document.createElement('canvas');
  canvas.id = 'weather-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;z-index:1;pointer-events:none;transition:opacity 0.3s ease;';
  document.body.insertBefore(canvas, document.body.firstChild);

  const ctx = canvas.getContext('2d');
  if (!ctx) { console.warn('[WeatherCanvas] No 2D context'); return; }

  let width = window.innerWidth;
  let height = window.innerHeight;
  let groundLevel = height - 4;
  canvas.width = width;
  canvas.height = height;

  // ==================== State ====================

  let weatherType = null;   // null = no weather / disabled
  let config = {
    particleCount: 200,
    speed: 1.0,
    wind: 0,
    intensity: 1.0,
    temperature: 15,
    thunder: false,
    cloudCover: 0,
    fogDensity: 0.5,
  };
  let visible = true;

  // ==================== Splash Particle Pool ====================

  const SPLASH_POOL_SIZE = 256;
  const splashPool = {
    x:    new Float32Array(SPLASH_POOL_SIZE),
    y:    new Float32Array(SPLASH_POOL_SIZE),
    vx:   new Float32Array(SPLASH_POOL_SIZE),
    vy:   new Float32Array(SPLASH_POOL_SIZE),
    life: new Float32Array(SPLASH_POOL_SIZE),
    count: 0,
    spawn(sx, sy) {
      if (this.count >= SPLASH_POOL_SIZE) return;
      const i = this.count++;
      this.x[i] = sx; this.y[i] = sy;
      this.vx[i] = (Math.random() - 0.5) * 4;
      this.vy[i] = -(Math.random() * 3 + 2);
      this.life[i] = 1.0;
    },
    update() {
      const gravity = 0.2;
      let i = 0;
      while (i < this.count) {
        this.vy[i] += gravity;
        this.x[i] += this.vx[i];
        this.y[i] += this.vy[i];
        this.life[i] -= 0.05;
        if (this.life[i] <= 0) {
          const last = this.count - 1;
          if (i < last) {
            this.x[i] = this.x[last]; this.y[i] = this.y[last];
            this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
            this.life[i] = this.life[last];
          }
          this.count--;
        } else { i++; }
      }
    },
    draw() {
      if (this.count === 0) return;
      ctx.fillStyle = 'rgba(200, 220, 255, 0.6)';
      ctx.beginPath();
      for (let i = 0; i < this.count; i++) {
        ctx.rect(this.x[i] - 1, this.y[i] - 1, 2, 2);
      }
      ctx.fill();
    },
    clear() { this.count = 0; }
  };

  // ==================== Rain (SoA + bin-grouped) ====================

  const MAX_RAIN = 600;
  const BIN_COUNT = 3;
  const binThresholds = [[0, 0.2], [0.2, 0.35], [0.35, 0.6]];
  const binFillStyles = binThresholds.map(([lo, hi]) => `rgba(180, 200, 235, ${((lo + hi) / 2).toFixed(2)})`);
  const binIndices = Array.from({ length: BIN_COUNT }, () => new Int16Array(MAX_RAIN));
  const binSizes = new Int32Array(BIN_COUNT);

  const rainData = {
    x:         new Float32Array(MAX_RAIN),
    y:         new Float32Array(MAX_RAIN),
    baseSpeed: new Float32Array(MAX_RAIN),
    length:    new Float32Array(MAX_RAIN),
    opacity:   new Float32Array(MAX_RAIN),
    count: 0,
    init(i) {
      this.x[i] = Math.random() * width;
      this.y[i] = Math.random() * height;
      this.baseSpeed[i] = Math.random() * 15 + 15;
      this.length[i] = Math.random() * 20 + 20;
      this.opacity[i] = Math.random() * 0.4 + 0.1;
    },
    setCount(n) {
      const target = Math.min(n, MAX_RAIN);
      while (this.count < target) { this.init(this.count); this.count++; }
      if (this.count > target) { this.count = target; this._rebuildBins(); }
    },
    _rebuildBins() {
      for (let b = 0; b < BIN_COUNT; b++) binSizes[b] = 0;
      for (let i = 0; i < this.count; i++) {
        const o = this.opacity[i];
        for (let b = 0; b < BIN_COUNT; b++) {
          if (o >= binThresholds[b][0] && o < binThresholds[b][1]) {
            binIndices[b][binSizes[b]++] = i; break;
          }
        }
      }
    },
    updateAll(windVal, speedMult) {
      for (let i = 0; i < this.count; i++) {
        const spd = this.baseSpeed[i] * speedMult;
        this.y[i] += spd;
        this.x[i] += windVal;
        if (this.y[i] > groundLevel && this.y[i] < groundLevel + spd) {
          if (splashPool.count < SPLASH_POOL_SIZE - 8) {
            const cnt = Math.floor(Math.random() * 2) + 1;
            for (let s = 0; s < cnt; s++) splashPool.spawn(this.x[i], groundLevel);
          }
          this.y[i] = -this.length[i];
          this.x[i] = Math.random() * width;
        } else if (this.y[i] > height || this.x[i] > width + 100 || this.x[i] < -100) {
          this.y[i] = -this.length[i];
          this.x[i] = windVal > 0
            ? Math.random() * (width + 200) - 200
            : Math.random() * (width + 200);
        }
      }
      this._rebuildBins();
    },
    drawAll(windVal) {
      if (this.count === 0) return;
      const windOffset = windVal * 2;
      const topHW = 0.3, botHW = 1.2;
      for (let b = 0; b < BIN_COUNT; b++) {
        const size = binSizes[b];
        if (size === 0) continue;
        ctx.fillStyle = binFillStyles[b];
        ctx.beginPath();
        const idx = binIndices[b];
        for (let j = 0; j < size; j++) {
          const i = idx[j];
          const tx = this.x[i], ty = this.y[i];
          const bx = tx + windOffset, by = ty + this.length[i];
          ctx.moveTo(tx - topHW, ty);
          ctx.lineTo(tx + topHW, ty);
          ctx.lineTo(bx + botHW, by);
          ctx.lineTo(bx - botHW, by);
        }
        ctx.fill();
      }
    },
    clear() { this.count = 0; for (let b = 0; b < BIN_COUNT; b++) binSizes[b] = 0; }
  };

  // ==================== Snow ====================

  const MAX_SNOW = 400;
  const snowData = {
    x:        new Float32Array(MAX_SNOW),
    y:        new Float32Array(MAX_SNOW),
    radius:   new Float32Array(MAX_SNOW),
    baseSpeed:new Float32Array(MAX_SNOW),
    baseWind: new Float32Array(MAX_SNOW),
    angle:    new Float32Array(MAX_SNOW),
    opacity:  new Float32Array(MAX_SNOW),
    count: 0,
    init(i) {
      this.x[i] = Math.random() * width;
      this.y[i] = Math.random() * height;
      this.radius[i] = Math.random() * 3 + 1;
      this.baseSpeed[i] = Math.random() * 1.5 + 0.5;
      this.baseWind[i] = (Math.random() - 0.5) * 0.5;
      this.angle[i] = Math.random() * Math.PI * 2;
      this.opacity[i] = Math.random() * 0.6 + 0.2;
    },
    setCount(n) {
      const target = Math.min(n, MAX_SNOW);
      while (this.count < target) { this.init(this.count); this.count++; }
      if (this.count > target) this.count = target;
    },
    update(windVal, speedMult) {
      for (let i = 0; i < this.count; i++) {
        this.y[i] += this.baseSpeed[i] * speedMult;
        this.x[i] += this.baseWind[i] + windVal + Math.sin(this.angle[i]) * 0.5;
        this.angle[i] += 0.05;
        if (this.y[i] > height) {
          this.y[i] = -10;
          this.x[i] = Math.random() * width;
        }
      }
    },
    draw() {
      if (this.count === 0) return;
      for (let i = 0; i < this.count; i++) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity[i]})`;
        ctx.arc(this.x[i], this.y[i], this.radius[i], 0, Math.PI * 2);
        ctx.fill();
      }
    },
    clear() { this.count = 0; }
  };

  // ==================== Fog (pre-rendered texture) ====================

  const FOG_TEX_SIZE = 256;
  let fogTexCanvas = null;

  function createFogTexture() {
    fogTexCanvas = document.createElement('canvas');
    fogTexCanvas.width = FOG_TEX_SIZE;
    fogTexCanvas.height = FOG_TEX_SIZE;
    const ftc = fogTexCanvas.getContext('2d');
    const cx = FOG_TEX_SIZE / 2;
    const g = ftc.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0, 'rgba(225, 235, 240, 1)');
    g.addColorStop(0.4, 'rgba(215, 225, 235, 0.8)');
    g.addColorStop(0.7, 'rgba(205, 220, 235, 0.3)');
    g.addColorStop(1, 'rgba(205, 220, 235, 0)');
    ftc.fillStyle = g;
    ftc.fillRect(0, 0, FOG_TEX_SIZE, FOG_TEX_SIZE);
  }

  const MAX_FOG = 12;
  const fogData = {
    x:        new Float32Array(MAX_FOG),
    y:        new Float32Array(MAX_FOG),
    radius:   new Float32Array(MAX_FOG),
    speed:    new Float32Array(MAX_FOG),
    opacity:  new Float32Array(MAX_FOG),
    oscOff:   new Float32Array(MAX_FOG),
    count: 0,
    init(i) {
      const minDim = Math.min(width, height);
      this.x[i] = Math.random() * (width + 400) - 200;
      this.y[i] = Math.random() * (height + 200) - 100;
      const z = Math.random();
      this.radius[i] = Math.min(minDim * (0.2 + z * 0.5), 400);
      this.speed[i] = (0.2 + z * 0.5) * (Math.random() > 0.5 ? 1 : -1);
      this.opacity[i] = 0.05 + Math.random() * 0.12;
      this.oscOff[i] = Math.random() * Math.PI * 2;
    },
    setCount(n) {
      const target = Math.min(n, MAX_FOG);
      while (this.count < target) { this.init(this.count); this.count++; }
      if (this.count > target) this.count = target;
    },
    update(windVal, now) {
      for (let i = 0; i < this.count; i++) {
        this.x[i] += this.speed[i] + windVal * 3.0;
        this.y[i] += Math.sin(now * 0.0008 + this.oscOff[i]) * 0.15;
        const b = this.radius[i] + 100;
        if (this.x[i] > width + b) { this.x[i] = -b; this.y[i] = Math.random() * height; }
        else if (this.x[i] < -b) { this.x[i] = width + b; this.y[i] = Math.random() * height; }
      }
    },
    draw(density) {
      if (!fogTexCanvas || this.count === 0) return;
      for (let i = 0; i < this.count; i++) {
        const op = this.opacity[i] * (0.6 + density * 0.8);
        if (op <= 0.01) continue;
        const diam = this.radius[i] * 2;
        ctx.globalAlpha = op;
        ctx.drawImage(fogTexCanvas, this.x[i] - this.radius[i], this.y[i] - this.radius[i], diam, diam);
      }
      ctx.globalAlpha = 1;
    },
    clear() { this.count = 0; }
  };

  // ==================== Lightning ====================

  let lightningBolts = [];
  let nextLightningAt = 0;
  let flashOpacity = 0;
  let lightningCount = 0;

  function getNextLightningDelay() {
    const extra = Math.min(lightningCount * 2000, 20000);
    lightningCount++;
    return 6000 + extra + Math.random() * 8000;
  }

  function createLightning() {
    const startX = Math.random() * width;
    const life = 15 + Math.random() * 10;
    const segments = [];

    function createBolt(sx, sy, targetY, maxOffset, depth) {
      let cx = sx, cy = sy;
      const path = [{ x: cx, y: cy }];
      let branchCount = 0;
      while (cy < targetY) {
        const stepY = Math.random() * 40 + 20;
        cy += stepY;
        cx += (Math.random() - 0.5) * maxOffset;
        path.push({ x: cx, y: cy });
        if (depth === 0 && Math.random() < 0.12 && targetY - cy > 150 && branchCount < 3) {
          const branchHeight = cy + Math.random() * 250 + 100;
          createBolt(cx, cy, branchHeight, maxOffset * 0.6, depth + 1);
          branchCount++;
        }
      }
      segments.push(path);
    }

    createBolt(startX, 0, height, 100, 0);
    return { life, alpha: 1, segments, update() { this.life--; } };
  }

  function drawLightning(bolt) {
    if (bolt.life <= 0) return;
    const flicker = Math.random();
    if (flicker > 0.8) return;
    let drawAlpha = bolt.alpha;
    if (bolt.life < 10) drawAlpha = bolt.life / 10;

    // Glow pass: thick semi-transparent
    ctx.strokeStyle = `rgba(180, 210, 255, ${drawAlpha * 0.3})`;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const path of bolt.segments) {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
      ctx.stroke();
    }
    // Core pass: thin bright
    ctx.strokeStyle = `rgba(255, 255, 255, ${drawAlpha})`;
    ctx.lineWidth = 2;
    for (const path of bolt.segments) {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
      ctx.stroke();
    }
  }

  // ==================== Config Mapping (weather data → particle params) ====================

  function applyWeatherData(weather) {
    const clamp = (v, mn, mx) => Math.min(mx, Math.max(mn, v));

    const windDir = weather.windDir;
    const windSign = (windDir >= 90 && windDir <= 270) ? 1 : -1;
    const windMag = clamp(weather.windSpeed / 25, 0, 2);
    const wind = windSign * windMag;

    const type = weather.weatherType;

    // Base config for all weather types
    config.wind = wind;
    config.temperature = weather.temp || 15;
    config.cloudCover = clamp((weather.cloudCover || 0) / 100, 0, 1);
    config.fogDensity = clamp(1 - (weather.visibility || 10000) / 10000, 0, 1);
    config.thunder = type === 'thunderstorm';

    // Weather-specific particle params
    if (type === 'rain' || type === 'thunderstorm') {
      const totalRain = (weather.rain || 0) + (weather.showers || 0) + (weather.precipitation || 0);
      config.particleCount = clamp(Math.round(totalRain * 60 + 50), 50, 500);
      config.speed = clamp(1 + totalRain * 0.3, 1, 3);
    } else if (type === 'snow') {
      const sf = weather.snowfall || weather.precipitation || 1;
      config.particleCount = clamp(Math.round(sf * 100 + 30), 40, 350);
      config.speed = clamp(0.5 + sf * 0.1, 0.3, 2);
    } else if (type === 'fog') {
      config.particleCount = 0;
      config.fogDensity = clamp(config.fogDensity + 0.2, 0.3, 0.8);
    } else if (type === 'cloudy') {
      config.particleCount = 0;
    } else {
      config.particleCount = 0; // clear
    }

    weatherType = type;
    initParticles();

    console.log('[WeatherCanvas] Applied:', type, 'particles:', config.particleCount, 'wind:', wind.toFixed(2));
  }

  // ==================== Particle Init ====================

  function initParticles() {
    rainData.clear();
    splashPool.clear();
    snowData.clear();
    fogData.clear();
    lightningBolts = [];
    flashOpacity = 0;
    lightningCount = 0;

    if (!weatherType || weatherType === 'clear') return;

    if (weatherType === 'rain' || weatherType === 'thunderstorm') {
      rainData.setCount(config.particleCount);
      nextLightningAt = performance.now() + getNextLightningDelay();
    } else if (weatherType === 'snow') {
      snowData.setCount(config.particleCount);
    } else if (weatherType === 'fog') {
      if (!fogTexCanvas) createFogTexture();
      fogData.setCount(10);
    }
  }

  // ==================== Animation Loop ====================

  let rafId = 0;

  function animate() {
    rafId = requestAnimationFrame(animate);

    if (!visible || !weatherType || weatherType === 'clear') {
      // Still clear once to remove residual
      if (ctx.canvas.width > 0) {
        ctx.clearRect(0, 0, width, height);
      }
      return;
    }

    ctx.clearRect(0, 0, width, height);
    const now = performance.now();

    // --- Thunder flash ---
    if (flashOpacity > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${flashOpacity})`;
      ctx.fillRect(0, 0, width, height);
      flashOpacity -= 0.05;
      if (flashOpacity < 0) flashOpacity = 0;
    }

    // --- Rain / Thunderstorm ---
    if (weatherType === 'rain' || weatherType === 'thunderstorm') {
      if (config.thunder && now >= nextLightningAt) {
        flashOpacity = 0.6 + Math.random() * 0.4;
        lightningBolts.push(createLightning());
        nextLightningAt = now + getNextLightningDelay();
      }

      // Draw + update lightning
      for (let i = lightningBolts.length - 1; i >= 0; i--) {
        const b = lightningBolts[i];
        b.update();
        drawLightning(b);
        if (b.life <= 0) lightningBolts.splice(i, 1);
      }

      rainData.updateAll(config.wind, config.speed);
      rainData.drawAll(config.wind);
      splashPool.update();
      splashPool.draw();
    }

    // --- Snow ---
    else if (weatherType === 'snow') {
      snowData.update(config.wind, config.speed);
      snowData.draw();
    }

    // --- Fog ---
    else if (weatherType === 'fog') {
      if (config.fogDensity > 0.05) {
        ctx.globalAlpha = config.fogDensity * 0.5;
        ctx.fillStyle = 'rgb(180, 195, 210)';
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
      }
      fogData.update(config.wind, now);
      fogData.draw(config.fogDensity);
    }

    // --- Cloudy (subtle dark tint) ---
    else if (weatherType === 'cloudy') {
      if (config.cloudCover > 0.1) {
        ctx.globalAlpha = config.cloudCover * 0.15;
        ctx.fillStyle = 'rgb(120, 130, 145)';
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ==================== Visibility Control ====================

  function updateVisibility() {
    // Check if terminal overlay is opaque (character hidden)
    const overlay = document.querySelector('#react-root .terminal-overlay');
    if (overlay) {
      const isOpaque = overlay.classList.contains('overlay-opaque') &&
        !overlay.classList.contains('hidden');
      visible = !isOpaque;
      canvas.style.opacity = isOpaque ? '0' : '1';
    } else {
      // No overlay present → character visible → show weather
      visible = true;
      canvas.style.opacity = '1';
    }
  }

  // MutationObserver on terminal overlay class changes
  const overlayEl = document.querySelector('#react-root');
  if (overlayEl) {
    const obs = new MutationObserver(() => updateVisibility());
    obs.observe(overlayEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  // ==================== Resize ====================

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      width = window.innerWidth;
      height = window.innerHeight;
      groundLevel = height - 4;
      canvas.width = width;
      canvas.height = height;
    }, 150);
  });

  // ==================== WS Event Listener ====================

  window.addEventListener('cloe-weather', (e) => {
    const msg = e.detail;
    if (!msg) return;
    if (msg.type === 'weather-update' && msg.weather) {
      applyWeatherData(msg.weather);
    }
  });

  // Fetch initial weather on load (if enabled)
  fetch('http://127.0.0.1:19851/weather/now')
    .then(r => r.json())
    .then(data => {
      if (data.weather) {
        applyWeatherData(data.weather);
      }
    })
    .catch(() => {});

  // Initial visibility check
  setTimeout(updateVisibility, 500);

  // Start animation
  animate();

  console.log('[WeatherCanvas] Initialized');
})();
