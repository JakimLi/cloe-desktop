// ==================== Cloe Desktop — GIF Mode ====================

// ==================== Config ====================
const WS_PORT = 19850;

// Available GIF animations
const GIF_ANIMATIONS = {
  blink: '/gifs/blink.gif',
  smile: '/gifs/smile.gif',
  kiss: '/gifs/kiss.gif',
};

// How long to show a reaction GIF before returning to idle blink
const REACTION_DURATION = 3000; // ms

let currentGif = 'blink';
let reactionTimer = null;

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
  if (active.src.endsWith(src.split('/').pop())) return;

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

    setTimeout(() => {
      isTransitioning = false;

      // Process queued switch if any
      if (pendingGif) {
        const queued = pendingGif;
        pendingGif = null;
        switchGif(queued.name, queued.autoReturn);
        return;
      }

      // Auto return to blink after reaction duration
      clearTimeout(reactionTimer);
      if (autoReturn && name !== 'blink') {
        reactionTimer = setTimeout(() => switchGif('blink'), REACTION_DURATION);
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
function handleAction(data) {
  console.log('Action:', data.action, data);

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

    case 'wave':
    case 'nod':
    case 'shake_head':
    case 'tease':
      switchGif('smile');
      break;

    case 'kiss':
      switchGif('kiss');
      break;

    case 'speak':
    case 'think':
      // Future: dedicated GIFs for these
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
