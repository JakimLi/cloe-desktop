// ==================== Cloe Desktop — Renderer (GIF Mode) ====================

// ==================== Config ====================
const WS_PORT = 19850;
const CROSSFADE_MS = 300;
const IDLE_INTERVAL = { min: 8000, max: 15000 };
const REACTION_DURATION = 3000;

const GIF_ANIMATIONS = {
  blink:       './gifs/blink.gif',
  smile:       './gifs/smile.gif',
  kiss:        './gifs/kiss.gif',
  nod:         './gifs/nod.gif',
  wave:        './gifs/wave.gif',
  think:       './gifs/think.gif',
  tease:       './gifs/tease.gif',
  speak:       './gifs/speak.gif',
  shake_head:  './gifs/shake_head.gif',
  working:     './gifs/working.gif',
};

// Weighted idle playlist (blink & smile most frequent)
const IDLE_PLAYLIST = ['blink', 'blink', 'smile', 'smile', 'kiss', 'think', 'nod', 'shake_head'];

// Action name → GIF name mapping (1:1 pass-through)
const ACTION_MAP = {
  smile: 'smile', approve: 'smile', happy: 'smile',
  nod: 'nod', wave: 'wave', think: 'think', tease: 'tease',
  kiss: 'kiss', shake_head: 'shake_head', speak: 'speak',
};

// ==================== State ====================
let currentGif = 'blink';
let activeLayer = 'a';
let isTransitioning = false;
let isReacting = false;
let isWorking = false;      // True = locked in working mode (no idle)
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

  // Already showing — skip but keep scheduling
  if (active.src.endsWith(src.split('/').pop())) {
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
function playAudio(source) {
  stopAudio();
  // Support: data URL (data:audio/...;base64,...), full URL, or pre-recorded name
  let src;
  if (source.startsWith('data:') || source.startsWith('http://') || source.startsWith('https://')) {
    src = source;
  } else {
    src = `./audio/${source}.mp3`;
  }
  const audio = new Audio(src);
  audio.volume = 0.9;
  window._currentAudio = audio;
  audio.play().catch((e) => console.error('Audio error:', e));
  audio.addEventListener('ended', () => { window._currentAudio = null; });
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
  const gifName = ACTION_MAP[action];
  if (gifName) {
    switchGif(gifName);
    if (action === 'speak') {
      // Priority: audio_url (dynamic TTS) > audio (pre-recorded name)
      if (data.audio_url) {
        playAudio(data.audio_url);
      } else if (data.audio) {
        playAudio(data.audio);
      }
    }
  } else {
    resetGif();
  }
}

// ==================== Window Drag ====================
const container = document.getElementById('gif-container');
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

container.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  window.electronAPI?.moveWindow(e.screenX - dragStartX, e.screenY - dragStartY);
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener('mouseup', () => { isDragging = false; });

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
      try { handleAction(JSON.parse(event.data)); }
      catch (e) { console.error('WS parse:', e); }
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
