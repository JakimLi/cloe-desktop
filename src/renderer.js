// ==================== Cloe Desktop — GIF Mode ====================

// ==================== Config ====================
const WS_PORT = 19850;

// Available GIF animations
const GIF_ANIMATIONS = {
  blink: '/gifs/blink.gif',
  smile: '/gifs/smile.gif',
  kiss: '/gifs/kiss.gif',
  nod: '/gifs/nod.gif',
  wave: '/gifs/wave.gif',
  think: '/gifs/think.gif',
  tease: '/gifs/tease.gif',
  speak: '/gifs/speak.gif',
};

// Idle playlist: randomly cycles through these when no reaction is playing
const IDLE_PLAYLIST = ['blink', 'blink', 'smile', 'smile', 'kiss']; // weighted: blink most, smile often, kiss偶尔
const IDLE_INTERVAL_MIN = 8000;  // ms, random range for next idle switch
const IDLE_INTERVAL_MAX = 15000;

// How long to show a reaction GIF before returning to idle
const REACTION_DURATION = 3000; // ms

let currentGif = 'blink';
let reactionTimer = null;
let idleTimer = null;
let isReacting = false; // true while a reaction GIF is showing

// ==================== GIF Management (Double-buffer crossfade) ====================
const gifLayerA = document.getElementById('cloe-gif-a');
const gifLayerB = document.getElementById('cloe-gif-b');

let activeLayer = 'a'; // which layer is currently visible
let isTransitioning = false;
let pendingGif = null; // if switch requested during transition, queue it

// Preload a GIF and return a promise
function preloadGif(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function switchGif(name, autoReturn = true) {
  const src = GIF_ANIMATIONS[name];
  if (!src) return;

  const active = activeLayer === 'a' ? gifLayerA : gifLayerB;
  const next = activeLayer === 'a' ? gifLayerB : gifLayerA;

  // Already showing this GIF on the active layer
  if (active.src.endsWith(src.split('/').pop())) {
    // Still schedule next idle even if skipped
    if (!autoReturn) scheduleNextIdle();
    return;
  }

  // If already transitioning, queue the new request
  if (isTransitioning) {
    pendingGif = { name, autoReturn };
    return;
  }

  isTransitioning = true;

  // Preload new GIF into the hidden layer
  preloadGif(src).then(() => {
    next.src = src;
    next.style.opacity = '1';

    // Swap roles: next becomes visible, active fades out
    active.style.opacity = '0';
    activeLayer = activeLayer === 'a' ? 'b' : 'a';
    currentGif = name;

    setTimeout(() => {
      isTransitioning = false;

      // Process queued switch if any
      if (pendingGif) {
        const queued = pendingGif;
        pendingGif = null;
        switchGif(queued.name, queued.autoReturn);
        return;
      }

      // Reaction → return to idle after duration
      clearTimeout(reactionTimer);
      if (autoReturn) {
        isReacting = true;
        reactionTimer = setTimeout(() => {
          isReacting = false;
          stopAudio();
          startIdleLoop();
        }, REACTION_DURATION);
      } else {
        // Idle switch — schedule next idle
        scheduleNextIdle();
      }
    }, 300); // match CSS transition duration
  }).catch(() => {
    isTransitioning = false;
  });
}

function resetGif() {
  const active = activeLayer === 'a' ? gifLayerA : gifLayerB;
  const src = active.src;
  active.src = '';
  active.src = src;
}

// ==================== Idle Loop ====================
function scheduleNextIdle() {
  clearTimeout(idleTimer);
  if (isReacting) return; // don't schedule idle while reacting
  const delay = IDLE_INTERVAL_MIN + Math.random() * (IDLE_INTERVAL_MAX - IDLE_INTERVAL_MIN);
  idleTimer = setTimeout(playRandomIdle, delay);
}

function playRandomIdle() {
  if (isReacting) return;
  // Pick a random idle animation, try not to repeat the same one
  let choices = IDLE_PLAYLIST.filter(n => n !== currentGif);
  if (choices.length === 0) choices = IDLE_PLAYLIST;
  const next = choices[Math.floor(Math.random() * choices.length)];
  switchGif(next, false); // false = idle mode, no reaction auto-return
}

function startIdleLoop() {
  // Pick a random starting idle animation
  const first = IDLE_PLAYLIST[Math.floor(Math.random() * IDLE_PLAYLIST.length)];
  switchGif(first, false);
}

function stopIdleLoop() {
  clearTimeout(idleTimer);
  clearTimeout(reactionTimer);
  isReacting = false;
}

// Start idle on load
startIdleLoop();

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
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  window.electronAPI?.moveWindow(dx, dy);
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

// ==================== Action Handlers (Hermes WebSocket) ====================
function playAudio(name) {
  // Stop any currently playing audio
  if (window._currentAudio) {
    window._currentAudio.pause();
    window._currentAudio = null;
  }
  const audio = new Audio(`/audio/${name}.mp3`);
  audio.volume = 0.9;
  window._currentAudio = audio;
  audio.play().catch(e => console.error('Audio play error:', e));
  // Auto-cleanup when done
  audio.addEventListener('ended', () => { window._currentAudio = null; });
}

function stopAudio() {
  if (window._currentAudio) {
    window._currentAudio.pause();
    window._currentAudio = null;
  }
}

function handleAction(data) {
  console.log('Action:', data.action, data);

  // Any reaction interrupts idle
  clearTimeout(idleTimer);
  isReacting = true;

  switch (data.action) {
    case 'expression':
      if (data.expression === 'happy' || data.expression === 'smile') {
        switchGif('smile');
      } else {
        resetGif();
      }
      break;

    case 'approve':
    case 'happy':
      switchGif('smile');
      break;

    case 'nod':
      switchGif('nod');
      break;

    case 'wave':
      switchGif('wave');
      break;

    case 'think':
      switchGif('think');
      break;

    case 'tease':
      switchGif('tease');
      break;

    case 'speak':
      switchGif('speak');
      // Play TTS audio if audio name provided
      if (data.audio) {
        playAudio(data.audio);
      }
      break;

    case 'kiss':
      switchGif('kiss');
      break;

    case 'shake_head':
      switchGif('smile');
      break;

    default:
      resetGif();
  }
}

// ==================== WebSocket (Hermes Integration) ====================
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  try {
    ws = new WebSocket(`ws://localhost:${WS_PORT}/ws`);

    ws.onopen = () => {
      document.getElementById('ws-status').style.color = '#4CAF50';
      console.log('WebSocket connected to Hermes');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleAction(data);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onclose = () => {
      document.getElementById('ws-status').style.color = '#f44336';
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => ws.close();
  } catch (e) {
    console.error('WebSocket init error:', e);
    document.getElementById('ws-status').style.color = '#f44336';
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  }
}

connectWebSocket();

console.log('Cloe Desktop — GIF mode loaded');
