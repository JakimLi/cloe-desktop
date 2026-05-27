// ==================== Cloe Settings — Shortcuts Tab ====================

const API_CONFIG_BASE = 'http://127.0.0.1:19851';

// ── Shortcut definition list ──
// Each entry: { id, lsKey, labelKey, descKey, emptyKey, hintKey, clearKey }
const SHORTCUT_DEFS = [
  // Window Controls
  { id: 'terminal', lsKey: 'cloe-terminal-shortcut', section: 'window' },
  { id: 'canvas', lsKey: 'cloe-canvas-shortcut', section: 'window' },
  // Chat Controls
  { id: 'chat', lsKey: 'cloe-chat-shortcut', section: 'chat' },
  { id: 'chat-transparency', lsKey: 'cloe-chat-transparency-shortcut', section: 'chat' },
  { id: 'chat-pin', lsKey: 'cloe-chat-pin-shortcut', section: 'chat' },
  { id: 'chat-focus', lsKey: 'cloe-chat-focus-shortcut', section: 'chat' },
  // Character Controls
  { id: 'char-move-up', lsKey: 'cloe-char-move-up-shortcut', section: 'character' },
  { id: 'char-move-down', lsKey: 'cloe-char-move-down-shortcut', section: 'character' },
  { id: 'char-move-left', lsKey: 'cloe-char-move-left-shortcut', section: 'character' },
  { id: 'char-move-right', lsKey: 'cloe-char-move-right-shortcut', section: 'character' },
];

function shortcutLabelKey(id) {
  // Map id to i18n key under prefs
  const map = {
    'terminal': 'terminalShortcut',
    'canvas': 'canvasShortcut',
    'chat': 'chatShortcut',
    'chat-transparency': 'chatTransparencyShortcut',
    'chat-pin': 'chatPinShortcut',
    'chat-focus': 'chatFocusShortcut',
    'char-move-up': 'charMoveUpShortcut',
    'char-move-down': 'charMoveDownShortcut',
    'char-move-left': 'charMoveLeftShortcut',
    'char-move-right': 'charMoveRightShortcut',
  };
  return map[id];
}

function initShortcutsTab() {
  renderShortcuts();
}

function renderShortcuts() {
  const container = document.getElementById('shortcuts-content');
  if (!container) return;

  const sections = {
    window: { title: I18n.t('prefs.shortcutsWindow'), shortcuts: [] },
    chat: { title: I18n.t('prefs.shortcutsChat'), shortcuts: [] },
    character: { title: I18n.t('prefs.shortcutsCharacter'), shortcuts: [] },
  };

  SHORTCUT_DEFS.forEach((def) => {
    sections[def.section].shortcuts.push(def);
  });

  let html = `<h2 class="pref-section-title" style="margin-bottom:16px;">${I18n.t('prefs.shortcutsTitle')}</h2>`;

  Object.values(sections).forEach((section) => {
    html += `<div class="pref-section">
      <h2 class="pref-section-title">${section.title}</h2>
      <div class="pref-group">`;

    section.shortcuts.forEach((def) => {
      const baseKey = shortcutLabelKey(def.id);
      html += `
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('prefs.' + baseKey)}</div>
            <div class="pref-desc">${I18n.t('prefs.' + baseKey + 'Desc')}</div>
          </div>
          <div class="pref-control">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="text" id="shortcut-input-${def.id}" class="form-input"
                style="width:160px;text-align:center;font-family:'SF Mono',monospace;font-size:13px;cursor:pointer;"
                placeholder="${I18n.t('prefs.' + baseKey + 'Empty')}"
                readonly>
              <button type="button" class="btn btn-secondary btn-sm" id="shortcut-clear-${def.id}">${I18n.t('prefs.' + baseKey + 'Clear')}</button>
            </div>
          </div>
        </div>`;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;

  // Bind all shortcut recorders
  SHORTCUT_DEFS.forEach((def) => {
    bindShortcutRecorder(def);
  });
}

function bindShortcutRecorder(def) {
  const baseKey = shortcutLabelKey(def.id);
  const input = document.getElementById('shortcut-input-' + def.id);
  const clearBtn = document.getElementById('shortcut-clear-' + def.id);
  if (!input || !clearBtn) return;

  let saved = localStorage.getItem(def.lsKey) || '';
  if (saved) input.value = electronAcceleratorToDisplay(saved);

  input.addEventListener('focus', () => {
    input.value = I18n.t('prefs.' + baseKey + 'Hint');
    input.classList.add('shortcut-recording');
  });

  input.addEventListener('blur', () => {
    input.classList.remove('shortcut-recording');
    input.value = saved ? electronAcceleratorToDisplay(saved) : '';
  });

  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const accel = buildElectronAccelerator(e);
    if (!accel) return;
    saved = accel;
    localStorage.setItem(def.lsKey, accel);
    input.value = electronAcceleratorToDisplay(accel);
    input.blur();
  });

  clearBtn.addEventListener('click', () => {
    saved = '';
    localStorage.removeItem(def.lsKey);
    input.value = '';
  });
}

/**
 * Build an Electron accelerator string from a KeyboardEvent.
 * Preserve all modifiers separately — don't collapse Ctrl+Cmd.
 */
function buildElectronAccelerator(e) {
  const parts = [];
  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  // Only register single letter keys or function keys
  if (/^F\d{1,2}$/.test(e.key)) {
    parts.push(e.key);
  } else if (e.key.length === 1) {
    parts.push(e.key.toUpperCase());
  } else {
    return null; // ignore modifier-only, arrows, etc.
  }
  return parts.join('+');
}

/**
 * Convert "Cmd+Control+T" → "⌘⌃T" for display.
 */
function electronAcceleratorToDisplay(accel) {
  return accel
    .replace(/CommandOrControl/g, '⌘')
    .replace(/Command/g, '⌘')
    .replace(/Cmd/g, '⌘')
    .replace(/Control/g, '⌃')
    .replace(/Ctrl/g, '⌃')
    .replace(/Alt/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, '');
}

function updateShortcutsText() {
  renderShortcuts();
}
