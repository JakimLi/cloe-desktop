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
  heart:       `${BASE}gifs/heart.gif`,
  dance:       `${BASE}gifs/dance.gif`,
  proud:       `${BASE}gifs/proud.gif`,
  surprise:    `${BASE}gifs/surprise.gif`,
  walk_left:   `${BASE}gifs/walk_left.gif`,
  walk_right:  `${BASE}gifs/walk_right.gif`,
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

// Preload GIF and parse its actual duration via fetch + binary GIF parsing.
// Falls back to REACTION_DURATION if parsing fails.
async function preloadGifWithDuration(src) {
  const [img, duration] = await Promise.all([
    new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Failed to load: ${src}`));
      const v = window._gifVersion || 0;
      const sep = src.includes('?') ? '&' : '?';
      i.src = `${src}${sep}v=${v}`;
    }),
    fetchGifDuration(src),
  ]);
  return { img, duration };
}

async function fetchGifDuration(src) {
  try {
    const v = window._gifVersion || 0;
    const sep = src.includes('?') ? '&' : '?';
    const url = `${src}${sep}v=${v}`;
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Parse GIF frame delays (GCE blocks)
    let total = 0;
    let pos = 13; // skip header + LSD + GCT
    while (pos < bytes.length - 1) {
      if (bytes[pos] === 0x21 && bytes[pos + 1] === 0xF9) {
        // Graphics Control Extension
        const delay = bytes[pos + 4] * 10 + bytes[pos + 5];
        total += delay || 100; // 0 delay = 10ms per spec, but browsers use 100ms
        pos += 8;
      } else if (bytes[pos] === 0x21) {
        // Skip other extensions
        pos += 2;
        while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
        pos++;
      } else if (bytes[pos] === 0x2C) {
        // Image Descriptor — skip to next block
        pos += 10;
        if (pos < bytes.length && bytes[pos] & 0x80) {
          const lzwMin = bytes[pos];
          const sub = bytes[pos + 1];
          pos += 2 + sub;
        }
        // Skip LZW data sub-blocks
        while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
        pos++; // block terminator
      } else {
        pos++;
      }
    }
    return total > 0 ? total : REACTION_DURATION;
  } catch {
    return REACTION_DURATION;
  }
}

function preloadGif(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    // Cache-bust: Chromium caches file:// images by URL, so when GIF files
    // are replaced on disk the old version is still served. Append a
    // version param that changes on every set-config update.
    const v = window._gifVersion || 0;
    const sep = src.includes('?') ? '&' : '?';
    img.src = `${src}${sep}v=${v}`;
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

  preloadGifWithDuration(src).then(({ img, duration: gifDuration }) => {
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
          }, gifDuration);
          return;
        }

        isReacting = true;
        reactionTimer = setTimeout(() => {
          isReacting = false;
          stopAudio();
          startIdleLoop();
        }, gifDuration);
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

// ==================== Character Size (scale factor) ====================
let characterScale = 1.0;

/**
 * Apply character position via CSS translate variables on #gif-container.
 * x: 0 = left, 0.5 = center, 1 = right
 * y: 0 = top, 1 = bottom (default bottom)
 * Translates the GIF layers so the character moves within the window.
 */
function applyCharacterPosition() {
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  // x: 0→left edge, 0.5→center (no offset), 1→right edge
  const tx = (characterPosition.x - 0.5) * rect.width;
  // y: 0→top, 1→bottom (default, no offset)
  const ty = (characterPosition.y - 1.0) * rect.height;
  container.style.setProperty('--char-tx', `${tx.toFixed(1)}px`);
  container.style.setProperty('--char-ty', `${ty.toFixed(1)}px`);
}

/**
 * Apply character size (scale) to CSS variable on #gif-container.
 * Affects the transform scale of the GIF layers.
 */
function applyCharacterScale() {
  container.style.setProperty('--character-scale', characterScale);
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

/** Load saved size from config via preload */
function loadCharacterScale() {
  try {
    const saved = window.electronAPI?.getCharacterSize?.();
    if (saved && typeof saved.scale === 'number') {
      characterScale = saved.scale;
    }
  } catch (e) {
    console.warn('[CharacterSize] Failed to load:', e);
  }
  applyCharacterScale();
}

loadCharacterPosition();
loadCharacterScale();

// Re-apply position on window resize (translate depends on container pixel size)
window.addEventListener('resize', () => applyCharacterPosition());

// Listen for real-time updates from chat window (via main process broadcast)
window.electronAPI?.onCharacterPositionUpdated?.((pos) => {
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
    characterPosition = { x: pos.x, y: pos.y };
    applyCharacterPosition();
  }
});

window.electronAPI?.onCharacterSizeUpdated?.((size) => {
  if (size && typeof size.scale === 'number') {
    characterScale = size.scale;
    applyCharacterScale();
  }
});

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
          // Bump GIF cache version so Chromium reloads from disk instead of
          // serving stale file:// cached images.
          window._gifVersion = (window._gifVersion || 0) + 1;

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
        // Forward to ReminderOverlay if it handled this message
        if (window.ReminderOverlay && ReminderOverlay.handleMessage) {
          ReminderOverlay.handleMessage(msg);
        }
        // Forward agent session events to React layer
        if (msg.type && msg.type.startsWith('agent-session-')) {
          window.dispatchEvent(new CustomEvent('cloe-agent-session', { detail: msg }));
        }
        // Forward task events to React layer
        if (msg.type && msg.type.startsWith('task-')) {
          window.dispatchEvent(new CustomEvent('cloe-task', { detail: msg }));
        }
        // Forward mute state changes to React layer
        if (msg.type === 'mute-state-changed') {
          window.dispatchEvent(new CustomEvent('cloe-mute-state', { detail: msg }));
        }
        // Forward global pause state changes to React layer
        if (msg.type === 'global-pause-changed') {
          window.dispatchEvent(new CustomEvent('cloe-global-pause', { detail: msg }));
        }
        // Forward reminder events to React layer
        if (msg.type && msg.type.startsWith('reminder-')) {
          window.dispatchEvent(new CustomEvent('cloe-reminder', { detail: msg }));
        }
        // Forward weather events to weather canvas
        if (msg.type && msg.type.startsWith('weather-')) {
          window.dispatchEvent(new CustomEvent('cloe-weather', { detail: msg }));
        }
        // Forward TTS scheduler events to React layer
        if (msg.type && msg.type.startsWith('tts-')) {
          window.dispatchEvent(new CustomEvent('cloe-tts-scheduler', { detail: msg }));
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
