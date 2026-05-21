/**
 * Cloe Canvas — Element Renderer
 *
 * Renders elements received via IPC (canvas-update) as DOM overlays on the canvas.
 * Supports: annotation, text, arrow, highlight, rect, image, emoji.
 * All new elements animate in with a fade-in effect.
 *
 * Elements are authored by "可可" (Cloe) with distinct visual styling
 * (accent color, avatar indicator, rounded corners).
 */

(function () {
  'use strict';

  // ==================== Cloe Theme Constants ====================
  const CLOE = {
    accent: '#FF6B9D',        // Cloe's signature pink
    accentLight: 'rgba(255, 107, 157, 0.12)',
    accentBorder: 'rgba(255, 107, 157, 0.5)',
    bg: '#1a1a2e',
    text: '#e8e8f0',
    muted: 'rgba(255, 255, 255, 0.5)',
    avatar: '🎀',             // Cloe's avatar emoji
    cornerRadius: 12,
  };

  // ==================== State ====================
  const state = {
    elements: new Map(),     // id → element data
    domRefs: new Map(),      // id → DOM node
    mounted: new Set(),      // ids that have already animated in
    nextZIndex: 10,
  };

  // ==================== DOM Setup ====================
  const canvasEl = document.getElementById('cloe-canvas');
  const ctx = canvasEl.getContext('2d');

  // Create overlay container for DOM-based elements
  const overlay = document.createElement('div');
  overlay.id = 'canvas-overlay';
  overlay.style.cssText = `
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    overflow: hidden;
  `;
  document.body.appendChild(overlay);

  // ==================== Canvas Background ====================
  let width = 0, height = 0;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvasEl.width = width * dpr;
    canvasEl.height = height * dpr;
    canvasEl.style.width = width + 'px';
    canvasEl.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();
  }

  function drawBackground() {
    // Dark background
    ctx.fillStyle = CLOE.bg;
    ctx.fillRect(0, 0, width, height);

    // Subtle grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ==================== Element Rendering ====================

  /**
   * Mount all elements from a full update
   * Compares with current state, adds new / removes missing
   */
  function syncElements(elements) {
    const newIds = new Set(elements.map(el => el.id));

    // Remove elements no longer present
    for (const [id, node] of state.domRefs) {
      if (!newIds.has(id)) {
        node.remove();
        state.domRefs.delete(id);
        state.elements.delete(id);
        state.mounted.delete(id);
      }
    }

    // Add / update elements
    for (const el of elements) {
      const existing = state.domRefs.get(el.id);
      if (existing) {
        // Update position/style if changed
        updateElementPosition(existing, el);
        state.elements.set(el.id, el);
      } else {
        mountElement(el);
      }
    }
  }

  /**
   * Mount a single element with fade-in animation
   */
  function mountElement(el) {
    const node = createElementDOM(el);
    if (!node) return;

    overlay.appendChild(node);
    state.elements.set(el.id, el);
    state.domRefs.set(el.id, node);

    // Fade-in animation for new elements
    requestAnimationFrame(() => {
      node.classList.add('canvas-fade-in');
    });
  }

  /**
   * Update element position if it moved
   */
  function updateElementPosition(node, el) {
    node.style.left = `${el.x}px`;
    node.style.top = `${el.y}px`;
    if (el.w) node.style.width = `${el.w}px`;
    if (el.h) node.style.height = `${el.h}px`;
  }

  /**
   * Create DOM node for an element based on type
   */
  function createElementDOM(el) {
    const style = el.style || {};
    const isCloe = el.author === '可可' || el.author === 'cloe' || el.author === 'Cloe';
    let node;

    switch (el.type) {
      case 'annotation':
        node = createAnnotationElement(el, style, isCloe);
        break;
      case 'text':
        node = createTextElement(el, style, isCloe);
        break;
      case 'arrow':
        node = createArrowElement(el, style, isCloe);
        break;
      case 'highlight':
        node = createHighlightElement(el, style, isCloe);
        break;
      case 'rect':
        node = createRectElement(el, style, isCloe);
        break;
      case 'emoji':
        node = createEmojiElement(el, style, isCloe);
        break;
      default:
        console.warn('[Canvas] Unknown element type:', el.type, el.id);
        node = null;
    }

    if (!node) return null;

    // Common positioning
    node.className = 'canvas-el';
    node.dataset.id = el.id;
    node.dataset.type = el.type;
    node.style.left = `${el.x}px`;
    node.style.top = `${el.y}px`;
    if (el.w) node.style.width = `${el.w}px`;
    if (el.h) node.style.height = `${el.h}px`;
    node.style.opacity = style.opacity ?? 1;
    node.style.zIndex = state.nextZIndex++;

    // Tooltip
    const time = el.timestamp ? new Date(el.timestamp).toLocaleTimeString() : '';
    node.title = `#${el.id} · ${el.author || '?'} · ${time}`;

    return node;
  }

  // ==================== Element Type Renderers ====================

  /**
   * Annotation: Cloe's speech/thought bubble
   * Distinctive pink theme with avatar indicator and arrow tip
   */
  function createAnnotationElement(el, style, isCloe) {
    const bubble = document.createElement('div');
    bubble.className = 'canvas-el annotation-bubble';

    if (isCloe) {
      bubble.classList.add('cloe-annotation');
    }

    // Author badge
    const badge = document.createElement('div');
    badge.className = 'annotation-badge';
    badge.textContent = isCloe ? CLOE.avatar : (el.author || '?');

    // Content
    const content = document.createElement('div');
    content.className = 'annotation-content';
    content.textContent = el.content || '';

    // Arrow tip (bottom-left)
    const tip = document.createElement('div');
    tip.className = 'annotation-tip';

    bubble.appendChild(badge);
    bubble.appendChild(content);
    bubble.appendChild(tip);

    // Custom style overrides
    if (style.fontSize) content.style.fontSize = `${style.fontSize}px`;
    if (style.color) content.style.color = style.color;
    if (style.backgroundColor) bubble.style.backgroundColor = style.backgroundColor;

    return bubble;
  }

  /**
   * Text element
   */
  function createTextElement(el, style, isCloe) {
    const node = document.createElement('div');
    node.className = 'canvas-el text-element';

    if (isCloe) {
      node.classList.add('cloe-text');
    }

    node.textContent = el.content || '';
    node.style.fontSize = `${style.fontSize || 14}px`;
    node.style.fontWeight = style.fontWeight || 'normal';
    node.style.color = style.color || (isCloe ? CLOE.text : '#ccc');
    node.style.textAlign = style.textAlign || 'left';
    if (style.backgroundColor) {
      node.style.backgroundColor = style.backgroundColor;
    }
    node.style.borderRadius = `${style.borderRadius || 8}px`;

    return node;
  }

  /**
   * Arrow element: SVG with arrowhead
   */
  function createArrowElement(el, style, isCloe) {
    const container = document.createElement('div');
    container.className = 'canvas-el arrow-element';

    const svgNS = 'http://www.w3.org/2000/svg';
    const w = el.w || 200;
    const h = el.h || 80;
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const strokeColor = style.strokeColor || (isCloe ? CLOE.accent : '#ff6b6b');
    const strokeWidth = style.strokeWidth || 2;

    // Arrowhead marker
    const defs = document.createElementNS(svgNS, 'defs');
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', `ah-${el.id}`);
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

    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', String(w));
    line.setAttribute('y2', String(h));
    line.setAttribute('stroke', strokeColor);
    line.setAttribute('stroke-width', String(strokeWidth));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', `url(#ah-${el.id})`);

    svg.appendChild(defs);
    svg.appendChild(line);
    container.appendChild(svg);

    return container;
  }

  /**
   * Highlight element: semi-transparent background
   */
  function createHighlightElement(el, style, isCloe) {
    const node = document.createElement('div');
    node.className = 'canvas-el highlight-element';

    const color = style.highlightColor || (isCloe
      ? 'rgba(255, 107, 157, 0.2)'
      : 'rgba(255, 235, 59, 0.3)');
    node.style.backgroundColor = color;
    node.style.borderRadius = `${style.borderRadius || 8}px`;

    return node;
  }

  /**
   * Rect element: bordered rectangle
   */
  function createRectElement(el, style, isCloe) {
    const node = document.createElement('div');
    node.className = 'canvas-el rect-element';

    const borderColor = style.borderColor || (isCloe ? CLOE.accentBorder : 'rgba(255,255,255,0.2)');
    const bgColor = style.backgroundColor || (isCloe ? CLOE.accentLight : 'rgba(255,255,255,0.05)');

    node.style.backgroundColor = bgColor;
    node.style.border = `${style.borderWidth || 2}px solid ${borderColor}`;
    node.style.borderRadius = `${style.borderRadius || 12}px`;

    return node;
  }

  /**
   * Emoji reaction: large emoji display
   */
  function createEmojiElement(el, style, isCloe) {
    const node = document.createElement('div');
    node.className = 'canvas-el emoji-element';
    node.textContent = el.content || '';
    node.style.fontSize = `${style.fontSize || 48}px`;
    node.style.lineHeight = '1';

    return node;
  }

  // ==================== IPC Connection ====================

  if (window.canvasAPI && window.canvasAPI.onCanvasUpdate) {
    const unsubscribe = window.canvasAPI.onCanvasUpdate((elements) => {
      console.log('[Canvas] Received canvas-update:', elements.length, 'elements');
      syncElements(elements);
    });
    console.log('[Canvas] IPC listener registered');
  } else {
    console.log('[Canvas] No canvasAPI — running in standalone mode (dev preview)');
    // In dev mode, expose manual sync for testing
    window.__canvasSync = syncElements;
  }

  // ==================== Init ====================
  console.log('[Canvas] Initialized', { width, height, dpr: window.devicePixelRatio });
})();
