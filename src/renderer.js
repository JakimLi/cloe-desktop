// ==================== Cloe Desktop — GIF Mode ====================

// ==================== Config ====================
const WS_PORT = 19850;

// Available GIF animations (will be loaded on demand)
const GIF_ANIMATIONS = {
  blink: '/gifs/blink.gif',
  // Future: wave, nod, happy, etc.
};

let currentGif = 'blink';

// ==================== GIF Management ====================
const gifEl = document.getElementById('cloe-gif');

function switchGif(name) {
  const src = GIF_ANIMATIONS[name];
  if (!src || src === gifEl.src) return;

  // Fade out → switch → fade in
  gifEl.style.transition = 'opacity 0.2s';
  gifEl.style.opacity = '0';
  setTimeout(() => {
    gifEl.src = src;
    gifEl.onload = () => {
      gifEl.style.opacity = '1';
    };
  }, 200);

  currentGif = name;
}

function resetGif() {
  // Reset to idle blink by re-setting src
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

// ==================== Action Handlers ====================
function handleAction(data) {
  console.log('Action:', data.action, data);

  switch (data.action) {
    case 'expression':
      // Future: switch to expression GIF
      resetGif();
      break;
    case 'wave':
      // Future: switchGif('wave');
      resetGif();
      break;
    case 'nod':
    case 'approve':
      resetGif();
      break;
    case 'shake_head':
    case 'tease':
      resetGif();
      break;
    case 'speak':
      // Future: talking animation
      resetGif();
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
    ws = new WebSocket(`ws://localhost:${WS_PORT}`);

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
