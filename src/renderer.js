// ==================== Cloe Desktop — GIF Mode ====================

// ==================== Config ====================
const WS_PORT = 19850;

// Available GIF animations
const GIF_ANIMATIONS = {
  blink: '/gifs/blink.gif',
  smile: '/gifs/smile.gif',
};

// How long to show a reaction GIF before returning to idle blink
const REACTION_DURATION = 3000; // ms

let currentGif = 'blink';
let reactionTimer = null;

// ==================== GIF Management ====================
const gifEl = document.getElementById('cloe-gif');

function switchGif(name, autoReturn = true) {
  const src = GIF_ANIMATIONS[name];
  if (!src) return;
  if (gifEl.src.endsWith(src.split('/').pop())) return; // already showing

  // Fade out → switch → fade in
  gifEl.style.transition = 'opacity 0.15s';
  gifEl.style.opacity = '0';
  setTimeout(() => {
    gifEl.src = src;
    gifEl.onload = () => {
      gifEl.style.opacity = '1';
    };
  }, 150);

  currentGif = name;

  // Auto return to blink after reaction duration
  clearTimeout(reactionTimer);
  if (autoReturn && name !== 'blink') {
    reactionTimer = setTimeout(() => switchGif('blink'), REACTION_DURATION);
  }
}

function resetGif() {
  // Reset current GIF animation by re-setting src
  const src = gifEl.src;
  gifEl.src = '';
  gifEl.src = src;
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
