// ==================== Cloe Settings — Shortcuts Tab ====================
// (API_CONFIG_BASE 已在 preferences.js 中定义)

// ── Shortcut definition list ──
// Each entry: { id, lsKey, labelKey, descKey, emptyKey, hintKey, clearKey }
var SHORTCUT_DEFS = [
  // Window Controls
  { id: 'terminal', lsKey: 'cloe-terminal-shortcut', section: 'window', defaultAccel: 'Cmd+Control+T' },
  { id: 'canvas', lsKey: 'cloe-canvas-shortcut', section: 'window', defaultAccel: 'Cmd+Control+2' },
  { id: 'transparency', lsKey: 'cloe-transparency-shortcut', section: 'window', defaultAccel: 'Cmd+Control+W' },
  { id: 'agent-tracker', lsKey: 'cloe-agent-tracker-shortcut', section: 'window', defaultAccel: 'Cmd+Control+/' },
  { id: 'mute-toggle', lsKey: 'cloe-mute-toggle-shortcut', section: 'window', defaultAccel: 'Cmd+Control+S' },
  { id: 'global-pause-toggle', lsKey: 'cloe-global-pause-toggle-shortcut', section: 'window', defaultAccel: 'Cmd+Control+P' },
  // Terminal Tabs
  { id: 'tab-new', lsKey: 'cloe-tab-new-shortcut', section: 'terminal', defaultAccel: 'Cmd+T' },
  { id: 'tab-close', lsKey: 'cloe-tab-close-shortcut', section: 'terminal', defaultAccel: 'Cmd+W' },
  { id: 'tab-switch', lsKey: 'cloe-tab-switch-shortcut', section: 'terminal', defaultAccel: 'Alt+Tab' },
  { id: 'tab-prev', lsKey: 'cloe-tab-prev-shortcut', section: 'terminal', defaultAccel: 'Cmd+Shift+[' },
  { id: 'tab-next', lsKey: 'cloe-tab-next-shortcut', section: 'terminal', defaultAccel: 'Cmd+Shift+]' },
  // Chat Controls
  { id: 'chat', lsKey: 'cloe-chat-shortcut', section: 'chat', defaultAccel: 'Cmd+Control+3' },
  { id: 'chat-pin', lsKey: 'cloe-chat-pin-shortcut', section: 'chat', defaultAccel: 'Cmd+Control+F' },
  { id: 'chat-focus', lsKey: 'cloe-chat-focus-shortcut', section: 'chat', defaultAccel: 'Control+L' },
  // Character Controls
  { id: 'char-move-up', lsKey: 'cloe-char-move-up-shortcut', section: 'character', defaultAccel: 'Control+Shift+K' },
  { id: 'char-move-down', lsKey: 'cloe-char-move-down-shortcut', section: 'character', defaultAccel: 'Control+Shift+J' },
  { id: 'char-move-left', lsKey: 'cloe-char-move-left-shortcut', section: 'character', defaultAccel: 'Control+Shift+H' },
  { id: 'char-move-right', lsKey: 'cloe-char-move-right-shortcut', section: 'character', defaultAccel: 'Control+Shift+L' },
  { id: 'char-scale-up', lsKey: 'cloe-char-scale-up-shortcut', section: 'character', defaultAccel: 'Control+Shift+U' },
  { id: 'char-scale-down', lsKey: 'cloe-char-scale-down-shortcut', section: 'character', defaultAccel: 'Control+Shift+M' },
  // Reminder Controls
  { id: 'reminder-dismiss', lsKey: 'cloe-reminder-dismiss-shortcut', section: 'reminder', defaultAccel: 'Cmd+Control+O' },
  { id: 'reminder-stop', lsKey: 'cloe-reminder-stop-shortcut', section: 'reminder', defaultAccel: 'Cmd+Control+X' },
  // Weather Controls
  { id: 'weather-toggle', lsKey: 'cloe-weather-toggle-shortcut', section: 'window', defaultAccel: 'Alt+W' },
];

function shortcutLabelKey(id) {
  // Map id to i18n key under prefs
  const map = {
    'terminal': 'terminalShortcut',
    'canvas': 'canvasShortcut',
    'transparency': 'transparencyShortcut',
    'agent-tracker': 'agentTrackerShortcut',
    'mute-toggle': 'muteToggleShortcut',
    'global-pause-toggle': 'globalPauseToggleShortcut',
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
    'weather-toggle': 'weatherToggleShortcut',
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
 * Map a physical key code (e.code) back to its base key label.
 * On macOS, Alt+letter produces a special character (e.g. Alt+W → "∑"),
 * so e.key can't be trusted when Alt is held. e.code is layout-stable and
 * modifier-independent, so we use it to recover the actual letter.
 */
function codeToKey(code) {
  if (!code) return null;
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit([0-9])$/))) return m[1];
  return null;
}

/**
 * Build an Electron accelerator string from a KeyboardEvent.
 * Preserve all modifiers separately — don't collapse Ctrl+Cmd.
 * Supports single-char keys, function keys, Tab, and brackets.
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
    // macOS: Alt+letter yields a special char (Alt+W → "∑").
    // Prefer e.code (physical key, modifier-independent) to recover the
    // real letter; fall back to e.key only if code is unavailable.
    parts.push(codeToKey(e.code) || e.key.toUpperCase());
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
