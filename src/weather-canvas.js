/**
 * Cloe Desktop — Weather Canvas (Particle Engine)
 *
 * Renders weather particle effects on a full-viewport canvas behind the character.
 * Supports: rain, snow, fog, thunderstorm, cloudy, clear (sunny), icy.
 * Day/night cycle with sun and moon positioning.
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
  let isDay = true;
  let dayNightFactor = 1.0; // 1.0 = full day, 0.0 = full night

  // ==================== Day/Night Cycle ====================

  function computeDayNight(weather) {
    // Use isDay from API data, plus time of day for sun/moon position
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    isDay = weather.isDay !== undefined ? weather.isDay : (hour >= 6 && hour < 19);

    // Compute day/night factor: smooth curve
    // 0=midnight, 6=sunrise, 12=noon, 18=sunset, 24=midnight
    if (hour < 5) dayNightFactor = 0;
    else if (hour < 7) dayNightFactor = (hour - 5) / 2;     // sunrise transition
    else if (hour < 17) dayNightFactor = 1;                  // full day
    else if (hour < 20) dayNightFactor = 1 - (hour - 17) / 3; // sunset transition
    else dayNightFactor = 0;                                  // full night
  }

  function getSunPosition() {
    // Sun arcs from east (left) at 6am to west (right) at 7pm
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    const t = Math.max(0, Math.min(1, (hour - 6) / 12)); // 0 at sunrise, 1 at sunset
    const x = t * width;
    const y = height * 0.5 - Math.sin(t * Math.PI) * height * 0.35;
    return { x, y };
  }

  function getMoonPosition() {
    // Moon arcs from east at 19pm to west at 5am
    let hour = new Date().getHours() + new Date().getMinutes() / 60;
    if (hour < 5) hour += 24; // 0-5am becomes 24-29
    const t = Math.max(0, Math.min(1, (hour - 19) / 10)); // 0 at sunset, 1 at sunrise
    const x = t * width;
    const y = height * 0.4 - Math.sin(t * Math.PI) * height * 0.3;
    return { x, y };
  }

  // ==================== Sun / Moon Rendering ====================

  let sunTexCanvas = null;
  function createSunTexture() {
    const size = 128;
    sunTexCanvas = document.createElement('canvas');
    sunTexCanvas.width = size;
    sunTexCanvas.height = size;
    const sctx = sunTexCanvas.getContext('2d');
    const cx = size / 2;
    // Multi-layer radial gradient for sun glow
    const g = sctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0, 'rgba(255, 240, 180, 0.9)');
    g.addColorStop(0.15, 'rgba(255, 220, 120, 0.6)');
    g.addColorStop(0.35, 'rgba(255, 200, 80, 0.3)');
    g.addColorStop(0.6, 'rgba(255, 180, 60, 0.12)');
    g.addColorStop(1, 'rgba(255, 160, 40, 0)');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, size, size);
    // Bright core
    const core = sctx.createRadialGradient(cx, cx, 0, cx, cx, 12);
    core.addColorStop(0, 'rgba(255, 255, 230, 1)');
    core.addColorStop(1, 'rgba(255, 240, 180, 0)');
    sctx.fillStyle = core;
    sctx.fillRect(0, 0, size, size);
  }

  function drawSun() {
    if (!sunTexCanvas) createSunTexture();
    const pos = getSunPosition();
    const size = Math.min(width, height) * 0.4;
    ctx.globalAlpha = 0.8 * dayNightFactor;
    ctx.drawImage(sunTexCanvas, pos.x - size / 2, pos.y - size / 2, size, size);
    ctx.globalAlpha = 1;
  }

  let moonTexCanvas = null;
  function createMoonTexture() {
    const size = 96;
    moonTexCanvas = document.createElement('canvas');
    moonTexCanvas.width = size;
    moonTexCanvas.height = size;
    const mctx = moonTexCanvas.getContext('2d');
    const cx = size / 2;
    const g = mctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0, 'rgba(220, 225, 245, 0.7)');
    g.addColorStop(0.2, 'rgba(200, 210, 240, 0.4)');
    g.addColorStop(0.5, 'rgba(180, 195, 235, 0.15)');
    g.addColorStop(1, 'rgba(160, 180, 230, 0)');
    mctx.fillStyle = g;
    mctx.fillRect(0, 0, size, size);
    // Moon body
    const body = mctx.createRadialGradient(cx - 5, cx - 5, 0, cx, cx, 18);
    body.addColorStop(0, 'rgba(240, 240, 250, 0.95)');
    body.addColorStop(0.7, 'rgba(220, 225, 245, 0.7)');
    body.addColorStop(1, 'rgba(200, 210, 240, 0)');
    mctx.fillStyle = body;
    mctx.beginPath();
    mctx.arc(cx, cx, 18, 0, Math.PI * 2);
    mctx.fill();
  }

  function drawMoon() {
    if (!moonTexCanvas) createMoonTexture();
    const pos = getMoonPosition();
    const size = Math.min(width, height) * 0.2;
    ctx.globalAlpha = (1 - dayNightFactor) * 0.7;
    ctx.drawImage(moonTexCanvas, pos.x - size / 2, pos.y - size / 2, size, size);
    ctx.globalAlpha = 1;
  }

  // ==================== Stars (night) ====================

  const MAX_STARS = 80;
  let starData = {
    x: new Float32Array(MAX_STARS),
    y: new Float32Array(MAX_STARS),
    radius: new Float32Array(MAX_STARS),
    twinkle: new Float32Array(MAX_STARS),
    twinkleSpeed: new Float32Array(MAX_STARS),
    count: 0,
    init() {
      for (let i = 0; i < MAX_STARS; i++) {
        this.x[i] = Math.random() * width;
        this.y[i] = Math.random() * height * 0.6;
        this.radius[i] = Math.random() * 1.2 + 0.3;
        this.twinkle[i] = Math.random() * Math.PI * 2;
        this.twinkleSpeed[i] = 0.02 + Math.random() * 0.04;
      }
      this.count = MAX_STARS;
    },
    draw(now) {
      if (this.count === 0) return;
      const nightAlpha = 1 - dayNightFactor;
      if (nightAlpha < 0.05) return;
      for (let i = 0; i < this.count; i++) {
        const tw = 0.4 + 0.6 * Math.sin(now * this.twinkleSpeed[i] + this.twinkle[i]);
        ctx.fillStyle = `rgba(230, 235, 255, ${(tw * nightAlpha * 0.6).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], this.radius[i], 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  // ==================== Cloud System (parallax layers) ====================

  let cloudTexCanvas = null;
  function createCloudTexture() {
    const size = 200;
    cloudTexCanvas = document.createElement('canvas');
    cloudTexCanvas.width = size;
    cloudTexCanvas.height = size;
    const cctx = cloudTexCanvas.getContext('2d');
    const cx = size / 2;
    // Create puffy cloud shape with multiple overlapping circles
    const g = cctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0, 'rgba(240, 244, 252, 0.8)');
    g.addColorStop(0.3, 'rgba(230, 236, 248, 0.5)');
    g.addColorStop(0.6, 'rgba(220, 228, 245, 0.25)');
    g.addColorStop(1, 'rgba(210, 220, 240, 0)');
    cctx.fillStyle = g;
    cctx.fillRect(0, 0, size, size);
  }

  const MAX_CLOUDS = 8;
  const cloudData = {
    x: new Float32Array(MAX_CLOUDS),
    y: new Float32Array(MAX_CLOUDS),
    radius: new Float32Array(MAX_CLOUDS),
    speed: new Float32Array(MAX_CLOUDS),
    opacity: new Float32Array(MAX_CLOUDS),
    depth: new Float32Array(MAX_CLOUDS), // 0=far, 1=near
    count: 0,
    init(i) {
      this.x[i] = Math.random() * (width + 400) - 200;
      this.y[i] = Math.random() * (height * 0.5);
      this.depth[i] = Math.random();
      this.radius[i] = Math.min(width, height) * (0.15 + this.depth[i] * 0.25);
      this.speed[i] = (0.1 + this.depth[i] * 0.3) * (Math.random() > 0.5 ? 1 : -1);
      this.opacity[i] = 0.3 + this.depth[i] * 0.3;
    },
    setCount(n) {
      const target = Math.min(n, MAX_CLOUDS);
      while (this.count < target) { this.init(this.count); this.count++; }
      if (this.count > target) this.count = target;
    },
    update(windVal) {
      for (let i = 0; i < this.count; i++) {
        this.x[i] += this.speed[i] + windVal * (0.5 + this.depth[i]);
        const b = this.radius[i];
        if (this.x[i] > width + b) { this.x[i] = -b; this.y[i] = Math.random() * (height * 0.5); }
        else if (this.x[i] < -b) { this.x[i] = width + b; this.y[i] = Math.random() * (height * 0.5); }
      }
    },
    draw(cover) {
      if (!cloudTexCanvas || this.count === 0) return;
      const nightShift = 1 - dayNightFactor * 0.4;
      for (let i = 0; i < this.count; i++) {
        const op = this.opacity[i] * cover * nightShift;
        if (op <= 0.01) continue;
        const diam = this.radius[i] * 2;
        ctx.globalAlpha = op;
        ctx.drawImage(cloudTexCanvas, this.x[i] - this.radius[i], this.y[i] - this.radius[i], diam, diam);
      }
      ctx.globalAlpha = 1;
    },
    clear() { this.count = 0; }
  };

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

  // ==================== Ice Crystals (icy weather) ====================

  const MAX_ICE = 60;
  const iceData = {
    x:        new Float32Array(MAX_ICE),
    y:        new Float32Array(MAX_ICE),
    radius:   new Float32Array(MAX_ICE),
    speed:    new Float32Array(MAX_ICE),
    angle:    new Float32Array(MAX_ICE),
    opacity:  new Float32Array(MAX_ICE),
    count: 0,
    init(i) {
      this.x[i] = Math.random() * width;
      this.y[i] = Math.random() * height;
      this.radius[i] = Math.random() * 2 + 0.5;
      this.speed[i] = Math.random() * 0.5 + 0.2;
      this.angle[i] = Math.random() * Math.PI * 2;
      this.opacity[i] = Math.random() * 0.5 + 0.2;
    },
    setCount(n) {
      const target = Math.min(n, MAX_ICE);
      while (this.count < target) { this.init(this.count); this.count++; }
      if (this.count > target) this.count = target;
    },
    update(windVal) {
      for (let i = 0; i < this.count; i++) {
        this.y[i] += this.speed[i];
        this.x[i] += windVal * 0.3 + Math.sin(this.angle[i]) * 0.3;
        this.angle[i] += 0.02;
        if (this.y[i] > height) { this.y[i] = -5; this.x[i] = Math.random() * width; }
      }
    },
    draw() {
      for (let i = 0; i < this.count; i++) {
        // Ice-blue shimmering crystals
        ctx.fillStyle = `rgba(180, 220, 255, ${this.opacity[i]})`;
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], this.radius[i], 0, Math.PI * 2);
        ctx.fill();
        // Sparkle cross
        const s = this.radius[i] * 2;
        ctx.strokeStyle = `rgba(200, 235, 255, ${this.opacity[i] * 0.5})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(this.x[i] - s, this.y[i]);
        ctx.lineTo(this.x[i] + s, this.y[i]);
        ctx.moveTo(this.x[i], this.y[i] - s);
        ctx.lineTo(this.x[i], this.y[i] + s);
        ctx.stroke();
      }
    },
    clear() { this.count = 0; }
  };

  // ==================== Config Mapping (weather data → particle params) ====================

  function applyWeatherData(weather) {
    const clamp = (v, mn, mx) => Math.min(mx, Math.max(mn, v));

    const windDir = weather.windDir;
    const windSign = (windDir >= 90 && windDir <= 270) ? 1 : -1;
    const windMag = clamp(weather.windSpeed / 25, 0, 2);
    const wind = windSign * windMag;

    const type = weather.weatherType;

    // Compute day/night
    computeDayNight(weather);

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
    } else if (type === 'icy') {
      config.particleCount = clamp(Math.round(40 + (weather.humidity || 50) * 0.3), 30, 60);
      config.speed = 0.5;
    } else {
      config.particleCount = 0; // clear / cloudy
    }

    weatherType = type;
    initParticles();

    console.log('[WeatherCanvas] Applied:', type, 'particles:', config.particleCount, 'wind:', wind.toFixed(2), 'isDay:', isDay, 'dnf:', dayNightFactor.toFixed(2));
  }

  // ==================== Particle Init ====================

  function initParticles() {
    rainData.clear();
    splashPool.clear();
    snowData.clear();
    fogData.clear();
    cloudData.clear();
    iceData.clear();
    lightningBolts = [];
    flashOpacity = 0;
    lightningCount = 0;

    // Always init stars for night sky
    if (dayNightFactor < 0.9) starData.init();

    if (!weatherType || weatherType === 'clear') {
      // For clear day, show clouds if there's cloud cover
      if (config.cloudCover > 0.1) {
        if (!cloudTexCanvas) createCloudTexture();
        cloudData.setCount(Math.ceil(config.cloudCover * 6));
      }
      return;
    }

    if (weatherType === 'rain' || weatherType === 'thunderstorm') {
      rainData.setCount(config.particleCount);
      nextLightningAt = performance.now() + getNextLightningDelay();
      // Clouds for rain/thunderstorm
      if (!cloudTexCanvas) createCloudTexture();
      cloudData.setCount(Math.ceil(config.cloudCover * 6 + 2));
    } else if (weatherType === 'snow') {
      snowData.setCount(config.particleCount);
      // Some clouds for snow
      if (!cloudTexCanvas) createCloudTexture();
      cloudData.setCount(Math.ceil(config.cloudCover * 4));
    } else if (weatherType === 'fog') {
      if (!fogTexCanvas) createFogTexture();
      fogData.setCount(10);
    } else if (weatherType === 'icy') {
      iceData.setCount(config.particleCount);
      if (!cloudTexCanvas) createCloudTexture();
      cloudData.setCount(Math.ceil(config.cloudCover * 3));
    } else if (weatherType === 'cloudy') {
      if (!cloudTexCanvas) createCloudTexture();
      cloudData.setCount(Math.max(3, Math.ceil(config.cloudCover * 8)));
    }
  }

  // ==================== Animation Loop ====================

  let rafId = 0;

  function animate() {
    rafId = requestAnimationFrame(animate);

    if (!visible || !weatherType) {
      if (ctx.canvas.width > 0) ctx.clearRect(0, 0, width, height);
      return;
    }

    ctx.clearRect(0, 0, width, height);
    const now = performance.now();

    // --- Stars (night sky, always check) ---
    if (dayNightFactor < 0.9) {
      starData.draw(now);
    }

    // --- Sun (daytime) ---
    if (dayNightFactor > 0.1 && (weatherType === 'clear' || weatherType === 'cloudy')) {
      drawSun();
    }

    // --- Moon (nighttime) ---
    if (dayNightFactor < 0.5 && (weatherType === 'clear' || weatherType === 'cloudy' || weatherType === 'icy')) {
      drawMoon();
    }

    // --- Thunder flash ---
    if (flashOpacity > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${flashOpacity})`;
      ctx.fillRect(0, 0, width, height);
      flashOpacity -= 0.05;
      if (flashOpacity < 0) flashOpacity = 0;
    }

    // --- Clouds (shared layer for many weather types) ---
    if (weatherType === 'cloudy' || weatherType === 'clear' ||
        weatherType === 'rain' || weatherType === 'thunderstorm' ||
        weatherType === 'snow' || weatherType === 'icy') {
      cloudData.update(config.wind);
      cloudData.draw(config.cloudCover > 0.1 ? Math.max(0.3, config.cloudCover) : 0);
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

    // --- Icy ---
    else if (weatherType === 'icy') {
      // Ice-blue tint overlay
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = 'rgb(150, 200, 255)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
      // Ice crystals
      iceData.update(config.wind);
      iceData.draw();
    }

    // --- Cloudy (dark tint for heavy overcast) ---
    else if (weatherType === 'cloudy') {
      if (config.cloudCover > 0.5) {
        ctx.globalAlpha = config.cloudCover * 0.1;
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
