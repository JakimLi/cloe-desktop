/**
 * Canvas Element Data Model
 *
 * JSON structure: { id, type, x, y, w, h, content, style, author, timestamp }
 * Types: image | text | rect | arrow | highlight | annotation | emoji
 */

/**
 * Generate a unique element ID
 * @returns {string}
 */
export function generateId() {
  return 'el_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * Create a new element with defaults
 * @param {object} overrides
 * @returns {object}
 */
export function createElement(overrides = {}) {
  return {
    id: overrides.id || generateId(),
    type: overrides.type || 'rect',          // image | text | rect | arrow | highlight | annotation | emoji
    x: overrides.x ?? 50,                     // absolute position X (px)
    y: overrides.y ?? 50,                     // absolute position Y (px)
    w: overrides.w ?? 200,                    // width (px)
    h: overrides.h ?? 120,                    // height (px)
    content: overrides.content ?? '',         // text content (for text type), or URL (for image type)
    style: {
      // Common
      opacity: 1,
      rotation: 0,
      // Text-specific
      fontSize: 16,
      fontWeight: 'normal',
      color: '#333333',
      textAlign: 'left',
      backgroundColor: 'transparent',
      // Rect/Highlight-specific
      borderColor: '#cccccc',
      borderWidth: 2,
      borderRadius: 4,
      // Arrow-specific
      strokeColor: '#ff4444',
      strokeWidth: 2,
      // Highlight-specific
      highlightColor: 'rgba(255, 255, 0, 0.35)',
      ...overrides.style,
    },
    author: overrides.author ?? 'anonymous',
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

/**
 * Validate an element object
 * @param {object} el
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateElement(el) {
  const errors = [];
  const VALID_TYPES = ['image', 'text', 'rect', 'arrow', 'highlight', 'annotation', 'emoji'];

  if (!el || typeof el !== 'object') {
    return { valid: false, errors: ['Element must be an object'] };
  }

  if (!el.id || typeof el.id !== 'string') {
    errors.push('Missing or invalid "id" (string required)');
  }

  if (!VALID_TYPES.includes(el.type)) {
    errors.push(`Invalid type "${el.type}". Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  if (typeof el.x !== 'number' || typeof el.y !== 'number') {
    errors.push('"x" and "y" must be numbers');
  }

  if (typeof el.w !== 'number' || typeof el.h !== 'number') {
    errors.push('"w" and "h" must be numbers');
  }

  if (el.w < 0 || el.h < 0) {
    errors.push('"w" and "h" must be non-negative');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Sample elements for initial canvas rendering
 */
export const SAMPLE_ELEMENTS = [
  createElement({
    id: 'sample_text_1',
    type: 'text',
    x: 40,
    y: 30,
    w: 320,
    h: 60,
    content: '👋 Hello Canvas! 拖拽我试试~',
    style: {
      fontSize: 24,
      fontWeight: 'bold',
      color: '#1a73e8',
      backgroundColor: 'rgba(26, 115, 232, 0.08)',
      borderRadius: 8,
      borderColor: 'transparent',
    },
    author: '小可爱',
  }),
  createElement({
    id: 'sample_rect_1',
    type: 'rect',
    x: 40,
    y: 120,
    w: 240,
    h: 160,
    content: '',
    style: {
      backgroundColor: 'rgba(52, 168, 83, 0.15)',
      borderColor: '#34a853',
      borderWidth: 2,
      borderRadius: 12,
    },
    author: '小可爱',
  }),
  createElement({
    id: 'sample_text_2',
    type: 'text',
    x: 60,
    y: 140,
    w: 200,
    h: 40,
    content: '📝 这是矩形区域',
    style: {
      fontSize: 14,
      color: '#34a853',
      backgroundColor: 'transparent',
    },
    author: '小可爱',
  }),
  createElement({
    id: 'sample_highlight_1',
    type: 'highlight',
    x: 320,
    y: 100,
    w: 280,
    h: 80,
    content: '',
    style: {
      highlightColor: 'rgba(255, 235, 59, 0.4)',
      borderRadius: 6,
    },
    author: '可可',
  }),
  createElement({
    id: 'sample_text_3',
    type: 'text',
    x: 340,
    y: 115,
    w: 240,
    h: 50,
    content: '💡 高亮标注区域\n用于标记重点内容',
    style: {
      fontSize: 14,
      color: '#f57f17',
      backgroundColor: 'transparent',
    },
    author: '可可',
  }),
  createElement({
    id: 'sample_image_1',
    type: 'image',
    x: 40,
    y: 310,
    w: 200,
    h: 200,
    content: 'https://placehold.co/400x400/1a73e8/ffffff?text=Cloe+Canvas',
    style: {
      borderRadius: 12,
      borderColor: '#1a73e8',
      borderWidth: 3,
    },
    author: '可可',
  }),
  createElement({
    id: 'sample_arrow_1',
    type: 'arrow',
    x: 260,
    y: 380,
    w: 200,
    h: 80,
    content: '',  // direction: right-down
    style: {
      strokeColor: '#ea4335',
      strokeWidth: 3,
    },
    author: '小可爱',
  }),
  createElement({
    id: 'sample_text_4',
    type: 'text',
    x: 300,
    y: 340,
    w: 260,
    h: 40,
    content: '🎨 支持 5 种元素类型',
    style: {
      fontSize: 18,
      fontWeight: 'bold',
      color: '#ea4335',
      backgroundColor: 'transparent',
    },
    author: '小可爱',
  }),
  createElement({
    id: 'sample_rect_2',
    type: 'rect',
    x: 300,
    y: 420,
    w: 300,
    h: 120,
    content: '',
    style: {
      backgroundColor: 'rgba(234, 67, 53, 0.08)',
      borderColor: '#ea4335',
      borderWidth: 2,
      borderRadius: 12,
    },
    author: '可可',
  }),
  createElement({
    id: 'sample_text_5',
    type: 'text',
    x: 320,
    y: 440,
    w: 260,
    h: 80,
    content: '✅ image  ✅ text  ✅ rect\n✅ arrow   ✅ highlight\n\n全部可拖拽移动!',
    style: {
      fontSize: 14,
      color: '#5f6368',
      backgroundColor: 'transparent',
    },
    author: '可可',
  }),
];
