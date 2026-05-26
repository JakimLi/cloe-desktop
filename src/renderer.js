// ==================== Cloe Desktop — Renderer (GIF Mode) ====================
// This file handles ONLY the character layer:
//   - GIF animation loop, idle, crossfade
//   - Audio playback (TTS, pre-recorded)
//   - Action dispatch (WebSocket → GIF switch)
//   - Window drag (character mode)
//   - Context usage HUD
//
// The terminal/canvas overlay is now managed by React (src/react/).

// ==================== Config ====================
const WS_PORT = 19850;
const CROSSFADE_MS = 300;
const IDLE_INTERVAL = { min: 8000, max: 15000 };
const REACTION_DURATION = 3000;

// Resolve base path for assets (GIFs, audio)
// Dev mode: Vite serves from http://localhost:5173/ → use /gifs/
// Packaged file:// → base URL from ~/.cloe dataDir via preload (no HTTP static route)
const DATA_DIR_BASE = (typeof window !== 'undefined' && window.electronAPI?.getDataDir?.()) || '';
const BASE = (location.protocol === 'file:' && DATA_DIR_BASE)
  ? DATA_DIR_BASE
  : '/';

let GIF_ANIMATIONS = {
  blink:       `${BASE}gifs/blink.gif`,
  smile:       `${BASE}gifs/smile.gif`,
  kiss:        `${BASE}gifs/kiss.gif`,
  nod:         `${BASE}gifs/nod.gif`,
  wave:        `${BASE}gifs/wave.gif`,
  think:       `${BASE}gifs/think.gif`,
  tease:       `${BASE}gifs/tease.gif`,
  speak:       `${BASE}gifs/speak.gif`,
  shake_head:  `${BASE}gifs/shake_head.gif`,
  working:     `${BASE}gifs/working.gif`,
  clap:        `${BASE}gifs/clap.gif`,
  shy:         `${BASE}gifs/shy.gif`,
  yawn:        `${BASE}gifs/yawn.gif`,
  laugh:       `${BASE}gifs/laugh.gif`,
};

// Weighted idle playlist (blink & smile most frequent)
let IDLE_PLAYLIST = ['blink', 'blink', 'smile', 'smile', 'kiss', 'think', 'nod', 'shake_head'];

// Fallback to default set when current set doesn't have the action
let ACTION_MAP = {};
let FALLBACK_GIF_ANIMATIONS = {};
let FALLBACK_ACTION_MAP = {};

// ==================== State ====================
let currentGif = 'blink';
let activeLayer = 'a';
let isTransitioning = false;
let isReacting = false;
let isWorking = false;      // True = locked in working mode (no idle)
let isSpeaking = false;     // True = TTS audio playing (highest priority, nothing can interrupt)
let pendingGif = null;
let idleTimer = null;
let reactionTimer = null;

// ==================== DOM ====================
const gifLayerA = document.getElementById('cloe-gif-a');
const gifLayerB = document.getElementById('cloe-gif-b');
const wsStatus = document.getElementById('ws-status');

function getActive()  { return activeLayer === 'a' ? gifLayerA : gifLayerB; }
function getHidden()  { return activeLayer === 'a' ? gifLayerB : gifLayerA; }
function swapLayers() { activeLayer = activeLayer === 'a' ? 'b' : 'a'; }

/** Resolved absolute href — compares full resource URL, not just filename (img.src getter is always absolute). */
function resolvedGifHref(s) {
  try {
    return new URL(s, location.href).href;
  } catch {
    return s;
  }
}

// ==================== GIF Switch (double-buffer crossfade) ====================
function preloadGif(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

function switchGif(name, autoReturn = true) {
  const src = GIF_ANIMATIONS[name];
  if (!src) return;

  const active = getActive();

  // Already showing — skip but keep scheduling (full resolved URL, not filename-only endsWith)
  if (resolvedGifHref(active.src) === resolvedGifHref(src)) {
    if (!autoReturn) scheduleNextIdle();
    return;
  }

  // Queue if mid-transition
  if (isTransitioning) {
    pendingGif = { name, autoReturn };
    return;
  }

  isTransitioning = true;
  const next = getHidden();

  preloadGif(src).then(() => {
    next.src = src;
    next.style.opacity = '1';
    active.style.opacity = '0';
    swapLayers();
    currentGif = name;

    setTimeout(() => {
      isTransitioning = false;

      // Drain queue first
      if (pendingGif) {
        const queued = pendingGif;
        pendingGif = null;
        switchGif(queued.name, queued.autoReturn);
        return;
      }

      if (autoReturn) {
        // In working mode, return to working.gif after reaction
        if (isWorking) {
          isReacting = true;
          reactionTimer = setTimeout(() => {
            isReacting = false;
            stopAudio();
            switchGif('working', false);
          }, REACTION_DURATION);
          return;
        }

        isReacting = true;
        reactionTimer = setTimeout(() => {
          isReacting = false;
          stopAudio();
          startIdleLoop();
        }, REACTION_DURATION);
      } else {
        scheduleNextIdle();
      }
    }, CROSSFADE_MS);
  }).catch((err) => {
    console.error(`[switchGif] ${name}: ${err.message}`);
    isTransitioning = false;
  });
}

function resetGif() {
  const active = getActive();
  const src = active.src;
  active.src = '';
  active.src = src;
}

// ==================== Idle Loop ====================
function scheduleNextIdle() {
  clearTimeout(idleTimer);
  if (isReacting || isWorking) return;
  const delay = IDLE_INTERVAL.min + Math.random() * (IDLE_INTERVAL.max - IDLE_INTERVAL.min);
  idleTimer = setTimeout(playRandomIdle, delay);
}

function playRandomIdle() {
  if (isReacting || isWorking) return;
  const choices = IDLE_PLAYLIST.filter((n) => n !== currentGif);
  const pool = choices.length > 0 ? choices : IDLE_PLAYLIST;
  const next = pool[Math.floor(Math.random() * pool.length)];
  switchGif(next, false);
}

function startIdleLoop() {
  const first = IDLE_PLAYLIST[Math.floor(Math.random() * IDLE_PLAYLIST.length)];
  switchGif(first, false);
}

// ==================== Audio ====================

// --- Legacy Audio (non-streaming, for pre-recorded and HTTP audio) ---
function playAudio(source, onEnded) {
  stopAudio();
  // Support: data URL (data:audio/...;base64,...), full URL, or pre-recorded name
  let src;
  if (source.startsWith('data:') || source.startsWith('http://') || source.startsWith('https://')) {
    src = source;
  } else {
    src = `${BASE}audio/${source}.mp3`;
  }
  const audio = new Audio(src);
  audio.volume = 0.9;
  window._currentAudio = audio;
  audio.play().catch((e) => console.error('Audio error:', e));
  audio.addEventListener('ended', () => {
    window._currentAudio = null;
    if (onEnded) onEnded();
  });
  // Also handle load error — don't get stuck if audio fails
  audio.addEventListener('error', () => {
    console.error('[Audio] Failed to load:', src.substring(0, 80));
    window._currentAudio = null;
    if (onEnded) onEnded();
  });
  return audio;
}

function stopAudio() {
  if (window._currentAudio) {
    window._currentAudio.pause();
    window._currentAudio = null;
  }
}

// ==================== Action Dispatch ====================
function handleAction(data) {
  const action = data.action;
  console.log('[Action]', action, data);

  // ── Highest priority: speaking (TTS audio playing) ──
  // Nothing can interrupt a speak in progress — drop all other actions.
  // The only exception is another 'speak' (re-trigger / override).
  // Terminal effects always fire regardless of speak state
  if (action === 'smash_screen') {
    effectSmashScreen();
    return;
  }

  if (isSpeaking && action !== 'speak') {
    console.log('[Action] Dropped — speak in progress:', action);
    return;
  }

  // ── Working mode: lock into working GIF until "idle" action ──
  if (action === 'working') {
    clearTimeout(idleTimer);
    clearTimeout(reactionTimer);
    isWorking = true;
    isReacting = false;
    // Use working.gif as default working animation, allow override
    const gifName = data.gif || 'working';
    switchGif(gifName);
    return;
  }

  // ── Exit working mode, resume idle loop ──
  if (action === 'idle') {
    isWorking = false;
    isReacting = false;
    clearTimeout(reactionTimer);
    // If audio is playing (e.g. TTS speak), don't kill it — wait for it to
    // finish naturally, then return to idle.  This prevents plugin hooks
    // (post_llm_call → idle) from cutting off a speak animation mid-playback.
    if (window._currentAudio) {
      console.log('[idle] Audio playing — deferring idle until audio ends');
      const audio = window._currentAudio;
      const onEnd = () => {
        audio.removeEventListener('ended', onEnd);
        audio.removeEventListener('error', onEnd);
        stopAudio();
        startIdleLoop();
      };
      audio.addEventListener('ended', onEnd);
      audio.addEventListener('error', onEnd);
      return;
    }
    stopAudio();
    startIdleLoop();
    return;
  }

  // Interrupt idle
  clearTimeout(idleTimer);
  isReacting = true;

  // Handle compound action (expression with sub-type)
  if (action === 'expression') {
    if (data.expression === 'happy' || data.expression === 'smile') {
      switchGif('smile');
    } else {
      resetGif();
    }
    return;
  }

  // Direct mapping or fallback
  let gifName = ACTION_MAP[action];
  let animSrc = GIF_ANIMATIONS;
  if (!gifName && FALLBACK_ACTION_MAP[action]) {
    // Fallback to default set
    gifName = FALLBACK_ACTION_MAP[action];
    animSrc = FALLBACK_GIF_ANIMATIONS;
  }
  if (gifName) {
    // Temporarily use the fallback animation source for switchGif
    const savedAnims = GIF_ANIMATIONS;
    if (animSrc !== GIF_ANIMATIONS) GIF_ANIMATIONS = animSrc;
    if (action === 'speak') {
      // Priority 1: Dynamic TTS via HTTP (audio_url field)
      if (data.audio_url) {
        isSpeaking = true;
        switchGif(gifName, false);
        playAudio(data.audio_url, () => {
          isSpeaking = false;
          isWorking = false;   // speak 结束后解锁 working 状态，避免死锁
          isReacting = false;
          startIdleLoop();
        });
      }
      // Priority 2: Pre-recorded audio (audio field)
      else {
        switchGif(gifName);
        if (data.audio) {
          playAudio(data.audio);
        }
      }
    } else {
      switchGif(gifName);
    }
    // Restore animation source if we used fallback
    if (animSrc !== savedAnims) GIF_ANIMATIONS = savedAnims;
  } else {
    resetGif();
  }
}

// ==================== Context Usage HUD ====================

const contextBar = document.getElementById('context-bar');
const contextBarFill = document.getElementById('context-bar-fill');
const contextBarText = document.getElementById('context-bar-text');

function initContextBar() {
  // Default: visible. localStorage only hides if explicitly set to 'false'.
  const hidden = localStorage.getItem('cloe-context-bar-visible') === 'false';
  if (!hidden) contextBar.classList.add('visible');

  // Listen for changes from the settings panel (different window, same origin)
  window.addEventListener('storage', (e) => {
    if (e.key === 'cloe-context-bar-visible') {
      const newVisible = e.newValue !== 'false';
      contextBar.classList.toggle('visible', newVisible);
    }
  });
}

function updateContextBar(usagePct) {
  const pct = Math.max(0, Math.min(100, usagePct));

  contextBarFill.style.width = `${pct}%`;
  contextBarText.textContent = `${Math.round(pct)}%`;

  // Remove all state classes
  contextBarFill.classList.remove('warn', 'danger', 'critical');

  // Apply color based on usage
  if (pct >= 90) {
    contextBarFill.classList.add('critical');
  } else if (pct >= 75) {
    contextBarFill.classList.add('danger');
  } else if (pct >= 50) {
    contextBarFill.classList.add('warn');
  }
}

initContextBar();

// ==================== Window Drag ====================
const container = document.getElementById('gif-container');
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// ==================== Character Position (Shift+drag) ====================
let isPositionDragging = false;
let posDragStartX = 0;
let posDragStartY = 0;
// characterPosition: {x: 0~1, y: 0~1} — ratio of container width/height
let characterPosition = { x: 0.5, y: 1.0 };

/**
 * Apply character position to CSS variables on #gif-container.
 * x: 0 = left, 0.5 = center, 1 = right
 * y: 0 = top, 1 = bottom
 */
function applyCharacterPosition() {
  const xPct = (characterPosition.x * 100).toFixed(1);
  const yPct = (characterPosition.y * 100).toFixed(1);
  container.style.setProperty('--character-position-x', `${xPct}%`);
  container.style.setProperty('--character-position-y', `${yPct}%`);
}

/** Load saved position from config via preload */
function loadCharacterPosition() {
  try {
    const saved = window.electronAPI?.getCharacterPosition?.();
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
      characterPosition = { x: saved.x, y: saved.y };
    }
  } catch (e) {
    console.warn('[CharacterPosition] Failed to load:', e);
  }
  applyCharacterPosition();
}

loadCharacterPosition();

container.addEventListener('mousedown', (e) => {
  // No dragging when terminal overlay is visible (React handles this)
  if (document.body.classList.contains('terminal-mode')) return;
  // Skip window drag if clicking inside the chat panel (it has its own drag)
  if (e.target.closest('.chat-panel')) return;

  // Shift+click: adjust character position within window
  if (e.shiftKey) {
    e.preventDefault();
    isPositionDragging = true;
    posDragStartX = e.clientX;
    posDragStartY = e.clientY;
    container.style.cursor = 'crosshair';
    return;
  }

  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener('mousemove', (e) => {
  // Character position adjustment (Shift+drag)
  if (isPositionDragging) {
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) return;

    const dx = e.clientX - posDragStartX;
    const dy = e.clientY - posDragStartY;
    posDragStartX = e.clientX;
    posDragStartY = e.clientY;

    // Convert pixel delta to ratio delta (0~1)
    const ratioDx = dx / containerRect.width;
    const ratioDy = dy / containerRect.height;

    characterPosition.x = Math.max(0, Math.min(1, characterPosition.x + ratioDx));
    characterPosition.y = Math.max(0, Math.min(1, characterPosition.y + ratioDy));

    applyCharacterPosition();
    return;
  }

  // Normal window drag
  if (!isDragging) return;
  window.electronAPI?.moveWindow(e.screenX - dragStartX, e.screenY - dragStartY);
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener('mouseup', () => {
  if (isPositionDragging) {
    isPositionDragging = false;
    container.style.cursor = '';
    // Save position to config
    try {
      window.electronAPI?.saveCharacterPosition?.(characterPosition);
      console.log(`[CharacterPosition] Saved: ${JSON.stringify(characterPosition)}`);
    } catch (e) {
      console.warn('[CharacterPosition] Failed to save:', e);
    }
    return;
  }
  isDragging = false;
});

// ==================== Terminal Effect Engine ====================
// Works with xterm.js DOM renderer: clones actual DOM elements for pixel-perfect
// text, animates them with CSS transforms. No canvas rasterization needed.

let effectRunning = false;
let effectAnimId = null;

// ── Effect: Smash Screen (字符掉落) ──

function effectSmashScreen() {
  if (!window.xtermInstance || !document.body.classList.contains('terminal-mode') || effectRunning) return;

  const xtermScreen = document.querySelector('.xterm-screen');
  const xtermRows = document.querySelector('.xterm-rows');
  const effectContainer = document.getElementById('terminal-container');
  if (!xtermScreen || !xtermRows || !effectContainer) return;

  const screenRect = xtermScreen.getBoundingClientRect();
  const rows = document.querySelectorAll('.xterm-rows > div');

  const particles = [];
  const CHUNK_WIDTH = 160; // px — each row gets split into ~160px chunks

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.textContent || !row.textContent.trim()) continue;

    const rect = row.getBoundingClientRect();
    const numChunks = Math.max(1, Math.ceil(rect.width / CHUNK_WIDTH));

    for (let c = 0; c < numChunks; c++) {
      const chunkW = Math.min(CHUNK_WIDTH, rect.width - c * CHUNK_WIDTH);
      const leftOffset = c * CHUNK_WIDTH;
      const originLeft = rect.left - screenRect.left + leftOffset;
      const originTop = rect.top - screenRect.top;

      // Wrapper clips the chunk; inner clone shifts to show the right portion
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        position: absolute;
        left: ${originLeft}px;
        top: ${originTop}px;
        width: ${chunkW}px;
        height: ${rect.height}px;
        overflow: hidden;
        z-index: 10;
        pointer-events: none;
        will-change: transform, opacity;
      `;
      const clone = row.cloneNode(true);
      clone.style.cssText = `
        position: absolute;
        left: ${-leftOffset}px;
        top: 0;
        width: ${rect.width}px;
        height: ${rect.height}px;
        margin: 0;
      `;
      wrapper.appendChild(clone);
      xtermScreen.appendChild(wrapper);

      const delay = i * 25 + c * 8 + Math.random() * 30;

      particles.push({
        el: wrapper,
        x: 0, y: 0,
        baseY: originTop,
        baseX: originLeft,
        chunkW,
        chunkH: rect.height,
        vy: 0,
        gravity: 0.25 + Math.random() * 0.12,
        opacity: 1,
        landed: false,
        landedAt: 0,
        landX: 0,
        settleFadeDelay: 1200 + Math.random() * 800,
        fadeRate: 0.006 + Math.random() * 0.004,
        delay,
        started: false,
        startTime: performance.now(),
      });
    }
  }

  if (!particles.length) return;
  effectRunning = true;

  xtermRows.style.visibility = 'hidden';
  // Clip everything to terminal bounds
  xtermScreen.style.overflow = 'hidden';

  const groundY = screenRect.height;
  const startGlobal = performance.now();

  function animate(now) {
    let allDone = true;

    for (const p of particles) {
      if (!p.started) {
        if (now - p.startTime < p.delay) { allDone = false; continue; }
        p.started = true;
        // Random scatter X, clamped inside screen bounds
        const scatter = (Math.random() - 0.5) * 80;
        p.landX = Math.max(-p.baseX + 4, Math.min(screenRect.width - p.baseX - p.chunkW - 4, scatter));
      }

      if (!p.landed) {
        p.vy += p.gravity;
        p.y += p.vy;
        // Gently drift toward landX while falling
        p.x += (p.landX - p.x) * 0.08;

        const currentY = p.baseY + p.y;
        if (currentY >= groundY - p.chunkH) {
          p.y = groundY - p.chunkH - p.baseY;
          p.landed = true;
          p.landedAt = now;
          p.vy = 0;
          p.x = p.landX;
          // Slight random tilt
          p.angle = (Math.random() - 0.5) * 0.18;
        }
      } else {
        if (now - p.landedAt > p.settleFadeDelay) {
          p.opacity -= p.fadeRate;
        }
      }

      if (p.opacity <= 0) {
        p.el.remove();
        continue;
      }

      allDone = false;
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.angle || 0}rad)`;
      p.el.style.opacity = Math.max(0, p.opacity);
    }

    if (!allDone && now - startGlobal < 10000) {
      effectAnimId = requestAnimationFrame(animate);
    } else {
      xtermRows.style.visibility = '';
      xtermScreen.style.overflow = '';
      for (const p of particles) { if (p.el.parentNode) p.el.remove(); }
      particles.length = 0;
      effectRunning = false;
    }
  }

  effectAnimId = requestAnimationFrame(animate);
}

// ==================== WebSocket ====================
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  try {
    ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    ws.onopen = () => {
      wsStatus.style.color = '#4CAF50';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'set-config') {
          // Dynamic config update from action set switch
          const newAnims = {};
          for (const [key, val] of Object.entries(msg.animations || {})) {
            // Values come as "gifs/xxx.gif" — prepend BASE
            const relative = val.startsWith('/') ? val.slice(1) : val;
            newAnims[key] = `${BASE}${relative}`;
          }
          GIF_ANIMATIONS = newAnims;
          IDLE_PLAYLIST = msg.idlePlaylist || [];
          ACTION_MAP = msg.actionMap || {};

          // Store default set as fallback
          if (msg.fallbackAnimations) {
            const fbAnims = {};
            for (const [key, val] of Object.entries(msg.fallbackAnimations)) {
              const relative = val.startsWith('/') ? val.slice(1) : val;
              fbAnims[key] = `${BASE}${relative}`;
            }
            FALLBACK_GIF_ANIMATIONS = fbAnims;
            FALLBACK_ACTION_MAP = msg.fallbackActionMap || {};
          } else {
            FALLBACK_GIF_ANIMATIONS = {};
            FALLBACK_ACTION_MAP = {};
          }

          // Always reset timers so the new action set applies immediately (same action name can map to a different file)
          clearTimeout(idleTimer);
          clearTimeout(reactionTimer);
          isReacting = false;
          startIdleLoop();
          console.log(`[set-config] Updated: ${Object.keys(GIF_ANIMATIONS).length} animations, ${IDLE_PLAYLIST.length} idle entries`);
        } else if (msg.type === 'context-usage') {
          // Context window usage HUD update
          updateContextBar(msg.usage_pct);
        } else {
          handleAction(msg);
        }
      } catch (e) { console.error('WS parse:', e); }
    };

    ws.onclose = () => {
      wsStatus.style.color = '#f44336';
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => ws.close();
  } catch (e) {
    console.error('WS init:', e);
    wsStatus.style.color = '#f44336';
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  }
}

// ==================== Init ====================
startIdleLoop();
connectWebSocket();
