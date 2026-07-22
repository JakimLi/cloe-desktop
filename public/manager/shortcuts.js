// ==================== Cloe Settings — Shortcuts Tab ====================
// (API_CONFIG_BASE 已在 preferences.js 中定义)

// ── Shortcut definition list ──
// Each entry: { id, lsKey, labelKey, descKey, emptyKey, hintKey, clearKey }
var SHORTCUT_DEFS = [
  // Window Controls
  { id: 'terminal', lsKey: 'cloe-terminal-shortcut', section: 'window' },
  { id: 'canvas', lsKey: 'cloe-canvas-shortcut', section: 'window' },
  { id: 'transparency', lsKey: 'cloe-transparency-shortcut', section: 'window' },
  { id: 'agent-tracker', lsKey: 'cloe-agent-tracker-shortcut', section: 'window' },
  { id: 'mute-toggle', lsKey: 'cloe-mute-toggle-shortcut', section: 'window' },
  // Terminal Tabs
  { id: 'tab-new', lsKey: 'cloe-tab-new-shortcut', section: 'terminal', defaultAccel: 'Cmd+T' },
  { id: 'tab-close', lsKey: 'cloe-tab-close-shortcut', section: 'terminal', defaultAccel: 'Cmd+W' },
  { id: 'tab-switch', lsKey: 'cloe-tab-switch-shortcut', section: 'terminal', defaultAccel: 'Alt+Tab' },
  { id: 'tab-prev', lsKey: 'cloe-tab-prev-shortcut', section: 'terminal', defaultAccel: 'Cmd+Shift+[' },
  { id: 'tab-next', lsKey: 'cloe-tab-next-shortcut', section: 'terminal', defaultAccel: 'Cmd+Shift+]' },
  // Chat Controls
  { id: 'chat', lsKey: 'cloe-chat-shortcut', section: 'chat' },
  { id: 'chat-pin', lsKey: 'cloe-chat-pin-shortcut', section: 'chat' },
  { id: 'chat-focus', lsKey: 'cloe-chat-focus-shortcut', section: 'chat' },
  // Character Controls
  { id: 'char-move-up', lsKey: 'cloe-char-move-up-shortcut', section: 'character' },
  { id: 'char-move-down', lsKey: 'cloe-char-move-down-shortcut', section: 'character' },
  { id: 'char-move-left', lsKey: 'cloe-char-move-left-shortcut', section: 'character' },
  { id: 'char-move-right', lsKey: 'cloe-char-move-right-shortcut', section: 'character' },
  { id: 'char-scale-up', lsKey: 'cloe-char-scale-up-shortcut', section: 'character' },
  { id: 'char-scale-down', lsKey: 'cloe-char-scale-down-shortcut', section: 'character' },
  // Reminder Controls
  { id: 'reminder-dismiss', lsKey: 'cloe-reminder-dismiss-shortcut', section: 'reminder' },
  { id: 'reminder-stop', lsKey: 'cloe-reminder-stop-shortcut', section: 'reminder' },
];

function shortcutLabelKey(id) {
  // Map id to i18n key under prefs
  const map = {
    'terminal': 'terminalShortcut',
    'canvas': 'canvasShortcut',
    'transparency': 'transparencyShortcut',
    'agent-tracker': 'agentTrackerShortcut',
    'mute-toggle': 'muteToggleShortcut',
    'tab-new': 'tabNewShortcut',
    'tab-close': 'tabCloseShortcut',
    'tab-switch': 'tabSwitchShortcut',
    'tab-prev': 'tabPrevShortcut',
    'tab-next': 'tabNextShortcut',
    'chat': 'chatShortcut',
    'chat-pin': 'chatPinShortcut',
    'chat-focus': 'chatFocusShortcut',
    'char-move-up': 'charMoveUpShortcut',
    'char-move-down': 'charMoveDownShortcut',
    'char-move-left': 'charMoveLeftShortcut',
    'char-move-right': 'charMoveRightShortcut',
    'char-scale-up': 'charScaleUpShortcut',
    'char-scale-down': 'charScaleDownShortcut',
    'reminder-dismiss': 'reminderDismissShortcut',
    'reminder-stop': 'reminderStopShortcut',
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
    terminal: { title: I18n.t('prefs.shortcutsTerminal'), shortcuts: [] },
    chat: { title: I18n.t('prefs.shortcutsChat'), shortcuts: [] },
    character: { title: I18n.t('prefs.shortcutsCharacter'), shortcuts: [] },
    reminder: { title: I18n.t('prefs.shortcutsReminder'), shortcuts: [] },
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

  let saved = localStorage.getItem(def.lsKey) || def.defaultAccel || '';
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
 * Supports single-char keys, function keys, Tab, and bracket keys.
 */
function buildElectronAccelerator(e) {
  // Ignore pure modifier presses
  if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'].includes(e.key)) return null;

  const parts = [];
  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  // Only register single letter keys, function keys, Tab, and brackets
  if (/^F\d{1,2}$/.test(e.key)) {
    parts.push(e.key);
  } else if (e.key === 'Tab') {
    parts.push('Tab');
  } else if (e.key === '[' || e.key === ']') {
    parts.push(e.key);
  } else if (e.key.length === 1) {
    parts.push(e.key.toUpperCase());
  } else {
    return null; // ignore arrows, etc.
  }
  return parts.join('+');
}

/**
 * Convert "Cmd+Control+T" → "⌘⌃T" for display.
 * Special: "Cmd+Tab" → "⌘⇥", "[" → "[", "]" → "]"
 */
function electronAcceleratorToDisplay(accel) {
  // Replace Tab as the last segment
  const segs = accel.split('+');
  const key = segs[segs.length - 1];
  const mods = segs.slice(0, -1);

  const modStr = mods.map(m =>
    m.replace(/CommandOrControl/g, '⌘')
     .replace(/Command/g, '⌘')
     .replace(/Cmd/g, '⌘')
     .replace(/Control/g, '⌃')
     .replace(/Ctrl/g, '⌃')
     .replace(/Alt/g, '⌥')
     .replace(/Shift/g, '⇧')
  ).join('');

  let keyStr;
  if (key === 'Tab') keyStr = '⇥';
  else if (key === '[' || key === ']') keyStr = key;
  else keyStr = key.toUpperCase();

  return modStr + keyStr;
}

function updateShortcutsText() {
  renderShortcuts();
}
