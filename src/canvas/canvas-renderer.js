/**
 * Canvas Core Renderer
 *
 * Renders elements as pure DOM (absolute positioning).
 * Supports: image, text, rect, arrow, highlight.
 * Mouse drag to move elements.
 */

import { SAMPLE_ELEMENTS, validateElement } from './element-model.js';

// ==================== State ====================
const state = {
  elements: new Map(),   // id → element object
  domRefs: new Map(),    // id → DOM node
  dragging: null,        // { id, startX, startY, elStartX, elStartY }
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

  console.log(`[Canvas] Mounted ${state.elements.size} elements`);
  console.log('[Canvas] Element types:', [...new Set(SAMPLE_ELEMENTS.map(e => e.type))].join(', '));

  // Expose for debugging
  window.__canvasState = state;
  window.__canvasMount = mountElement;
  window.__canvasUnmount = unmountElement;
  window.__canvasMountAll = mountAll;
}

// Boot
document.addEventListener('DOMContentLoaded', init);
