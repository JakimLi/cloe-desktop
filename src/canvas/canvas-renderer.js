/**
 * Canvas Core Renderer
 *
 * Renders elements as pure DOM (absolute positioning).
 * Supports: image, text, rect, arrow, highlight.
 * Mouse drag to move elements.
 */

import { SAMPLE_ELEMENTS, validateElement, createElement, generateId } from './element-model.js';

// ==================== Constants ====================
const CANVAS_API_BASE = 'http://localhost:19851';
const PASTE_MARGIN = 20;     // gap between pasted elements (px)
const PASTE_START_X = 60;    // initial X for first pasted element
const PASTE_START_Y = 60;    // initial Y for first pasted element
const MAX_IMAGE_WIDTH = 480;  // max width for pasted images
const MAX_IMAGE_HEIGHT = 360; // max height for pasted images
const CODE_LINE_PATTERNS = [
  /^\s{2,}\S/,          // indented code
  /^\s*(function|const|let|var|return|import|export|class|if|else|for|while|switch|try|catch|async|await)\b/,
  /^\s*[{}\[\]();]/,
  /^[^a-zA-Z]*[=+\-*/<>!&|].*[=+\-*/<>!&|]/,  // contains operators
  /^\s*(def |self\.|print\(|from |import )/,       // Python
  /^\s*\/\//,                                         // JS comment
];

// ==================== State ====================
const state = {
  elements: new Map(),   // id → element object
  domRefs: new Map(),    // id → DOM node
  dragging: null,        // { id, startX, startY, elStartX, elStartY }
  pasteCursor: { x: PASTE_START_X, y: PASTE_START_Y },  // flow layout cursor
};

// ==================== DOM References ====================
const workspace = document.getElementById('canvas-workspace');
const board = document.getElementById('canvas-board');
const elementCountEl = document.getElementById('element-count');
const typeCountEl = document.getElementById('type-count');

// ==================== Render ====================

/**
 * Mount a single element to the canvas board
 * @param {object} el - Element data
 */
function mountElement(el) {
  const validation = validateElement(el);
  if (!validation.valid) {
    console.warn('[Canvas] Invalid element:', el.id, validation.errors);
    return;
  }

  // Remove existing if remounting
  unmountElement(el.id);

  const node = createElementDOM(el);
  board.appendChild(node);
  state.elements.set(el.id, el);
  state.domRefs.set(el.id, node);
  updateInfoBar();
}

/**
 * Create DOM node for an element based on its type
 * @param {object} el
 * @returns {HTMLElement}
 */
function createElementDOM(el) {
  const style = el.style || {};
  let node;

  switch (el.type) {
    case 'image':
      node = createImageElement(el, style);
      break;
    case 'text':
      node = createTextElement(el, style);
      break;
    case 'rect':
      node = createRectElement(el, style);
      break;
    case 'arrow':
      node = createArrowElement(el, style);
      break;
    case 'highlight':
      node = createHighlightElement(el, style);
      break;
    default:
      console.warn('[Canvas] Unknown element type:', el.type);
      node = document.createElement('div');
  }

  // Common attributes
  node.className = 'canvas-element';
  node.dataset.id = el.id;
  node.dataset.type = el.type;
  node.style.left = `${el.x}px`;
  node.style.top = `${el.y}px`;
  node.style.width = `${el.w}px`;
  node.style.height = `${el.h}px`;
  node.style.opacity = style.opacity ?? 1;
  if (style.rotation) {
    node.style.transform = `rotate(${style.rotation}deg)`;
  }
  node.title = `#${el.id} · ${el.author} · ${new Date(el.timestamp).toLocaleString()}`;

  // Drag handlers
  node.addEventListener('mousedown', onDragStart);
  node.addEventListener('touchstart', onTouchDragStart, { passive: false });

  return node;
}

/**
 * Image element: <img> tag inside a container
 */
function createImageElement(el, style) {
  const wrapper = document.createElement('div');
  wrapper.style.borderRadius = `${style.borderRadius ?? 0}px`;
  wrapper.style.border = style.borderWidth
    ? `${style.borderWidth}px solid ${style.borderColor || '#ccc'}`
    : 'none';

  const img = document.createElement('img');
  img.src = el.content;
  img.alt = el.content || 'image';
  img.draggable = false;

  // Loading state
  const loading = document.createElement('span');
  loading.className = 'image-loading';
  loading.textContent = '加载中...';

  img.addEventListener('load', () => loading.remove());
  img.addEventListener('error', () => {
    loading.textContent = '❌ 图片加载失败';
  });

  wrapper.appendChild(loading);
  wrapper.appendChild(img);
  return wrapper;
}

/**
 * Text element: styled <div> with textContent
 */
function createTextElement(el, style) {
  const node = document.createElement('div');
  node.textContent = el.content || '';
  node.style.fontSize = `${style.fontSize ?? 16}px`;
  node.style.fontWeight = style.fontWeight || 'normal';
  node.style.color = style.color || '#333';
  node.style.textAlign = style.textAlign || 'left';
  node.style.backgroundColor = style.backgroundColor || 'transparent';
  node.style.borderRadius = `${style.borderRadius ?? 0}px`;
  node.style.border = style.borderWidth
    ? `${style.borderWidth}px solid ${style.borderColor || '#ccc'}`
    : 'none';
  return node;
}

/**
 * Rect element: colored rectangle with optional border
 */
function createRectElement(el, style) {
  const node = document.createElement('div');
  node.style.backgroundColor = style.backgroundColor || 'rgba(255,255,255,0.8)';
  node.style.border = `${style.borderWidth ?? 2}px solid ${style.borderColor || '#ccc'}`;
  node.style.borderRadius = `${style.borderRadius ?? 4}px`;
  return node;
}

/**
 * Arrow element: SVG with line + arrowhead marker
 */
function createArrowElement(el, style) {
  const container = document.createElement('div');

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${el.w} ${el.h}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const strokeColor = style.strokeColor || '#ff4444';
  const strokeWidth = style.strokeWidth || 2;

  // Arrow line: from top-left to bottom-right
  const x1 = 0;
  const y1 = 0;
  const x2 = el.w;
  const y2 = el.h;

  // Marker definition for arrowhead
  const defs = document.createElementNS(svgNS, 'defs');

  const marker = document.createElementNS(svgNS, 'marker');
  marker.setAttribute('id', `arrowhead-${el.id}`);
  marker.setAttribute('markerWidth', '12');
  marker.setAttribute('markerHeight', '8');
  marker.setAttribute('refX', '10');
  marker.setAttribute('refY', '4');
  marker.setAttribute('orient', 'auto');

  const polygon = document.createElementNS(svgNS, 'polygon');
  polygon.setAttribute('points', '0 0, 12 4, 0 8');
  polygon.setAttribute('fill', strokeColor);

  marker.appendChild(polygon);
  defs.appendChild(marker);

  // Line
  const line = document.createElementNS(svgNS, 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', strokeColor);
  line.setAttribute('stroke-width', strokeWidth);
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('marker-end', `url(#arrowhead-${el.id})`);

  svg.appendChild(defs);
  svg.appendChild(line);
  container.appendChild(svg);

  return container;
}

/**
 * Highlight element: semi-transparent colored background
 */
function createHighlightElement(el, style) {
  const node = document.createElement('div');
  const hlColor = style.highlightColor || 'rgba(255, 255, 0, 0.35)';
  node.style.backgroundColor = hlColor;
  node.style.borderRadius = `${style.borderRadius ?? 6}px`;
  return node;
}

/**
 * Remove a single element from the canvas
 * @param {string} id
 */
function unmountElement(id) {
  const existing = state.domRefs.get(id);
  if (existing) {
    existing.remove();
    state.domRefs.delete(id);
    state.elements.delete(id);
  }
}

/**
 * Mount all elements from an array
 * @param {object[]} elements
 */
function mountAll(elements) {
  // Clear existing
  for (const id of state.domRefs.keys()) {
    state.domRefs.get(id)?.remove();
  }
  state.elements.clear();
  state.domRefs.clear();

  for (const el of elements) {
    mountElement(el);
  }
}

// ==================== Drag & Drop ====================

function onDragStart(e) {
  // Don't start drag if right-click or on a child element of different type
  if (e.button !== 0) return;

  const node = e.currentTarget;
  const id = node.dataset.id;
  const el = state.elements.get(id);
  if (!el) return;

  e.preventDefault();
  e.stopPropagation();

  state.dragging = {
    id,
    startX: e.clientX,
    startY: e.clientY,
    elStartX: el.x,
    elStartY: el.y,
  };

  node.classList.add('dragging');

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!state.dragging) return;

  const dx = e.clientX - state.dragging.startX;
  const dy = e.clientY - state.dragging.startY;

  const newX = state.dragging.elStartX + dx;
  const newY = state.dragging.elStartY + dy;

  // Update data model
  const el = state.elements.get(state.dragging.id);
  if (el) {
    el.x = newX;
    el.y = newY;
  }

  // Update DOM
  const node = state.domRefs.get(state.dragging.id);
  if (node) {
    node.style.left = `${newX}px`;
    node.style.top = `${newY}px`;
  }
}

function onDragEnd() {
  if (!state.dragging) return;

  const node = state.domRefs.get(state.dragging.id);
  if (node) {
    node.classList.remove('dragging');
  }

  state.dragging = null;

  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
}

// Touch support
function onTouchDragStart(e) {
  if (e.touches.length !== 1) return;

  const touch = e.touches[0];
  const node = e.currentTarget;
  const id = node.dataset.id;
  const el = state.elements.get(id);
  if (!el) return;

  e.preventDefault();
  e.stopPropagation();

  state.dragging = {
    id,
    startX: touch.clientX,
    startY: touch.clientY,
    elStartX: el.x,
    elStartY: el.y,
  };

  node.classList.add('dragging');

  document.addEventListener('touchmove', onTouchDragMove, { passive: false });
  document.addEventListener('touchend', onTouchDragEnd);
}

function onTouchDragMove(e) {
  if (!state.dragging || e.touches.length !== 1) return;
  e.preventDefault();

  const touch = e.touches[0];
  const dx = touch.clientX - state.dragging.startX;
  const dy = touch.clientY - state.dragging.startY;

  const newX = state.dragging.elStartX + dx;
  const newY = state.dragging.elStartY + dy;

  const el = state.elements.get(state.dragging.id);
  if (el) {
    el.x = newX;
    el.y = newY;
  }

  const node = state.domRefs.get(state.dragging.id);
  if (node) {
    node.style.left = `${newX}px`;
    node.style.top = `${newY}px`;
  }
}

function onTouchDragEnd() {
  if (!state.dragging) return;

  const node = state.domRefs.get(state.dragging.id);
  if (node) {
    node.classList.remove('dragging');
  }

  state.dragging = null;

  document.removeEventListener('touchmove', onTouchDragMove);
  document.removeEventListener('touchend', onTouchDragEnd);
}

// ==================== Paste Interaction ====================

/**
 * Detect if pasted text looks like code.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeCode(text) {
  const lines = text.split('\n');
  if (lines.length < 2) {
    // Single line: check for code-like patterns
    return CODE_LINE_PATTERNS.some(p => p.test(text));
  }
  // Multi-line: if most lines look like code, treat as code
  let codeLineCount = 0;
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (CODE_LINE_PATTERNS.some(p => p.test(line))) {
      codeLineCount++;
    }
  }
  return codeLineCount >= lines.filter(l => l.trim()).length * 0.4;
}

/**
 * Calculate the next paste position using flow layout.
 * Elements are placed vertically, advancing the cursor after each placement.
 * @param {number} elWidth - Width of element being placed
 * @param {number} elHeight - Height of element being placed
 * @returns {{ x: number, y: number }}
 */
function getNextPastePosition(elWidth, elHeight) {
  const pos = { x: state.pasteCursor.x, y: state.pasteCursor.y };
  // Advance cursor for next element
  state.pasteCursor.y += elHeight + PASTE_MARGIN;
  return pos;
}

/**
 * Create an image element from base64 data URL and mount it.
 * @param {string} dataUrl - data:image/png;base64,...
 */
async function pasteImage(dataUrl) {
  // Get image dimensions to determine element size
  const dims = await getImageDimensions(dataUrl);
  let w = dims.width;
  let h = dims.height;

  // Scale down if too large
  if (w > MAX_IMAGE_WIDTH) {
    const scale = MAX_IMAGE_WIDTH / w;
    w = MAX_IMAGE_WIDTH;
    h = Math.round(h * scale);
  }
  if (h > MAX_IMAGE_HEIGHT) {
    const scale = MAX_IMAGE_HEIGHT / h;
    h = MAX_IMAGE_HEIGHT;
    w = Math.round(w * scale);
  }

  w = Math.max(w, 80);
  h = Math.max(h, 60);

  const pos = getNextPastePosition(w, h);
  const el = createElement({
    type: 'image',
    x: pos.x,
    y: pos.y,
    w,
    h,
    content: dataUrl,
    author: 'paste',
  });

  mountElement(el);
  syncElementToServer(el);
  console.log('[Canvas] Pasted image element:', el.id, `${w}×${h}`);
}

/**
 * Create a text element (or code element) from text and mount it.
 * @param {string} text
 */
function pasteText(text) {
  if (!text.trim()) return;

  const isCode = looksLikeCode(text);

  // Estimate dimensions
  const fontSize = isCode ? 13 : 16;
  const lines = text.split('\n');
  const maxLineLength = Math.max(...lines.map(l => l.length));
  let w = Math.min(Math.max(maxLineLength * (fontSize * 0.6) + 24, 120), 600);
  let h = Math.min(lines.length * (fontSize * 1.6) + 16, 500);

  const pos = getNextPastePosition(w, h);

  const el = createElement({
    type: 'text',
    x: pos.x,
    y: pos.y,
    w,
    h,
    content: text,
    style: isCode ? {
      fontSize,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      color: '#e0e0e0',
      backgroundColor: '#1e1e2e',
      borderRadius: 8,
      borderColor: '#313244',
      borderWidth: 1,
      textAlign: 'left',
    } : {
      fontSize,
      color: '#333',
      backgroundColor: 'rgba(255,255,255,0.92)',
      borderRadius: 8,
      borderColor: '#e0e0e0',
      borderWidth: 1,
      textAlign: 'left',
    },
    author: 'paste',
  });

  // Add a 'code' data attribute for styling
  mountElement(el);
  if (isCode) {
    const node = state.domRefs.get(el.id);
    if (node) {
      node.classList.add('code-block');
    }
  }

  // Recalculate actual size after mount (for auto-fit)
  requestAnimationFrame(() => {
    const node = state.domRefs.get(el.id);
    if (node && !isCode) {
      // For non-code text, auto-resize to fit content
      const scrollW = node.scrollWidth;
      const scrollH = node.scrollHeight;
      if (scrollW > 0 && scrollH > 0) {
        el.w = Math.min(Math.max(scrollW + 4, 100), 600);
        el.h = Math.min(Math.max(scrollH + 4, 30), 500);
        node.style.width = `${el.w}px`;
        node.style.height = `${el.h}px`;
        // Adjust cursor position
        state.pasteCursor.y = pos.y + el.h + PASTE_MARGIN;
      }
    }
    if (isCode && node) {
      const scrollH = node.scrollHeight;
      if (scrollH > 0) {
        el.h = Math.min(scrollH + 4, 500);
        node.style.height = `${el.h}px`;
        state.pasteCursor.y = pos.y + el.h + PASTE_MARGIN;
      }
    }
  });

  syncElementToServer(el);
  console.log(`[Canvas] Pasted ${isCode ? 'code' : 'text'} element:`, el.id);
}

/**
 * Get image dimensions from a data URL.
 * @param {string} dataUrl
 * @returns {Promise<{ width: number, height: number }>}
 */
function getImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 400, height: 300 }); // fallback
    img.src = dataUrl;
  });
}

/**
 * Handle paste events from keyboard (Cmd+V / Ctrl+V).
 * @param {ClipboardEvent} e
 */
async function handlePaste(e) {
  // Only handle paste on the workspace/board, not on input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  e.preventDefault();
  console.log('[Canvas] Paste event detected');

  // Try reading clipboard via preload API (Electron clipboard)
  const api = window.canvasAPI;
  if (api) {
    // Check for image first
    const imageDataUrl = api.readClipboardImage();
    if (imageDataUrl) {
      await pasteImage(imageDataUrl);
      return;
    }

    // Check for text
    const text = api.readClipboardText();
    if (text) {
      pasteText(text);
      return;
    }
  }

  // Fallback: use browser clipboard API
  const clipboardItems = e.clipboardData?.items;
  if (!clipboardItems) return;

  for (const item of clipboardItems) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = async () => {
        await pasteImage(reader.result);
      };
      reader.readAsDataURL(blob);
      return;
    }

    if (item.type === 'text/plain') {
      e.preventDefault();
      item.getAsString((text) => {
        pasteText(text);
      });
      return;
    }
  }

  console.log('[Canvas] No pasteable content found');
}

/**
 * Sync a newly created element to the Canvas API server.
 * @param {object} el
 */
async function syncElementToServer(el) {
  try {
    const resp = await fetch(`${CANVAS_API_BASE}/canvas/elements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(el),
    });
    if (resp.ok) {
      console.log('[Canvas] Element synced to server:', el.id);
    }
  } catch (err) {
    // Silently fail — server might not be running
    console.warn('[Canvas] Failed to sync element to server:', err.message);
  }
}

/**
 * Listen for canvas-update events from the main process (via IPC).
 * Used when elements are modified from the HTTP API.
 */
function setupIPCListener() {
  // Listen via ipcRenderer if available
  const api = window.canvasAPI;
  if (api && api.onCanvasUpdate) {
    api.onCanvasUpdate((elements) => {
      mountAll(elements);
    });
  }
}

// ==================== Info Bar ====================

function updateInfoBar() {
  const count = state.elements.size;
  if (elementCountEl) {
    elementCountEl.textContent = `${count} 个元素`;
  }

  if (typeCountEl) {
    const types = {};
    for (const el of state.elements.values()) {
      types[el.type] = (types[el.type] || 0) + 1;
    }
    const parts = Object.entries(types).map(([t, c]) => `${t}×${c}`);
    typeCountEl.textContent = parts.join(' · ');
  }
}

// ==================== Init ====================

function init() {
  console.log('[Canvas] Initializing with sample elements...');

  // Mount sample elements
  mountAll(SAMPLE_ELEMENTS);

  // Set paste cursor below existing sample elements
  let maxY = 0;
  for (const el of state.elements.values()) {
    if (el.y + el.h > maxY) maxY = el.y + el.h;
  }
  state.pasteCursor.y = maxY + PASTE_MARGIN;

  console.log(`[Canvas] Mounted ${state.elements.size} elements`);
  console.log('[Canvas] Element types:', [...new Set(SAMPLE_ELEMENTS.map(e => e.type))].join(', '));

  // Register paste event listener
  document.addEventListener('paste', handlePaste);
  console.log('[Canvas] Paste handler registered (Cmd+V / Ctrl+V)');

  // Setup IPC listener for server-side canvas updates
  setupIPCListener();

  // Expose for debugging
  window.__canvasState = state;
  window.__canvasMount = mountElement;
  window.__canvasUnmount = unmountElement;
  window.__canvasMountAll = mountAll;
  window.__pasteImage = pasteImage;
  window.__pasteText = pasteText;
}

// Boot
document.addEventListener('DOMContentLoaded', init);
