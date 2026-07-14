// ==================== Cloe Settings — Reminders Tab ====================
// (API_CONFIG_BASE is defined in preferences.js, loaded before this file)

const API_REMINDERS = API_CONFIG_BASE + '/reminders';

function initRemindersTab() {
  loadReminders();
}

// ==================== Data ====================

let reminders = [];
let editTarget = null; // null = creating new, string = editing id

// ==================== Load & Render ====================

async function loadReminders() {
  try {
    const res = await fetch(API_REMINDERS);
    const data = await res.json();
    reminders = data.reminders || [];
    renderReminders();
  } catch (e) {
    console.error('[Reminders] load failed:', e);
  }
}

function renderReminders() {
  const container = document.getElementById('reminders-content');
  if (!container) return;

  container.innerHTML = `
    <div class="reminders-header">
      <h2 class="pref-section-title">${I18n.t('reminders.title')}</h2>
      <button class="btn btn-primary btn-sm" id="btn-add-reminder">+ ${I18n.t('reminders.add')}</button>
    </div>

    <div id="reminders-list" class="reminders-list">
      ${reminders.length === 0 ? `<div class="empty-state"><p>${I18n.t('reminders.empty')}</p></div>` : ''}
      ${reminders.map(renderReminderItem).join('')}
    </div>

    <!-- Add/Edit Form (hidden by default) -->
    <div id="reminder-form" class="reminder-form hidden">
      <div class="pref-section">
        <h2 class="pref-section-title" id="reminder-form-title">${I18n.t('reminders.addTitle')}</h2>
        <div class="pref-group">
          <div class="pref-item">
            <div class="pref-info">
              <div class="pref-label">${I18n.t('reminders.fieldName')}</div>
            </div>
            <div class="pref-control">
              <input type="text" id="reminder-name" class="form-input" placeholder="${I18n.t('reminders.fieldNamePlaceholder')}" style="width:200px;">
            </div>
          </div>

          <div class="pref-item">
            <div class="pref-info">
              <div class="pref-label">${I18n.t('reminders.fieldMode')}</div>
            </div>
            <div class="pref-control">
              <div class="segmented-control" id="reminder-mode-segments">
                <button class="segment active" data-mode="interval">${I18n.t('reminders.modeInterval')}</button>
                <button class="segment" data-mode="countdown">${I18n.t('reminders.modeCountdown')}</button>
              </div>
            </div>
          </div>

          <div class="pref-item" id="reminder-duration-item">
            <div class="pref-info">
              <div class="pref-label">${I18n.t('reminders.fieldDuration')}</div>
              <div class="pref-desc">${I18n.t('reminders.fieldDurationDesc')}</div>
            </div>
            <div class="pref-control">
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="number" id="reminder-duration-min" class="form-input" min="1" max="720" value="30" style="width:80px;text-align:center;">
                <span class="pref-desc">${I18n.t('reminders.minutes')}</span>
              </div>
            </div>
          </div>

          <div class="pref-item hidden" id="reminder-break-item">
            <div class="pref-info">
              <div class="pref-label">${I18n.t('reminders.fieldBreakDuration')}</div>
              <div class="pref-desc">${I18n.t('reminders.fieldBreakDurationDesc')}</div>
            </div>
            <div class="pref-control">
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="number" id="reminder-break-min" class="form-input" min="0" max="120" value="5" style="width:80px;text-align:center;">
                <span class="pref-desc">${I18n.t('reminders.minutes')}</span>
              </div>
            </div>
          </div>

          <div class="pref-item hidden" id="reminder-rounds-item">
            <div class="pref-info">
              <div class="pref-label">${I18n.t('reminders.fieldTotalRounds')}</div>
              <div class="pref-desc">${I18n.t('reminders.fieldTotalRoundsDesc')}</div>
            </div>
            <div class="pref-control">
              <input type="number" id="reminder-rounds" class="form-input" min="0" max="20" value="4" style="width:80px;text-align:center;">
              <span class="pref-desc" style="margin-left:6px;">${I18n.t('reminders.fieldTotalRoundsHint')}</span>
            </div>
          </div>

          <div class="pref-item">
            <div class="pref-info">
              <div class="pref-label">${I18n.t('reminders.fieldAutoStart')}</div>
              <div class="pref-desc">${I18n.t('reminders.fieldAutoStartDesc')}</div>
            </div>
            <div class="pref-control">
              <label class="toggle">
                <input type="checkbox" id="reminder-auto-start" checked>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="pref-item">
            <div class="pref-info">
              <div class="pref-label">${I18n.t('reminders.fieldTTS')}</div>
              <div class="pref-desc">${I18n.t('reminders.fieldTTSDesc')}</div>
            </div>
            <div class="pref-control">
              <label class="toggle">
                <input type="checkbox" id="reminder-tts" checked>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="pref-item">
            <div class="pref-info">
              <div class="pref-label">${I18n.t('reminders.fieldAction')}</div>
              <div class="pref-desc">${I18n.t('reminders.fieldActionDesc')}</div>
            </div>
            <div class="pref-control">
              <input type="text" id="reminder-action" class="form-input" placeholder="${I18n.t('reminders.fieldActionPlaceholder')}" style="width:160px;">
            </div>
          </div>
        </div>

        <div class="reminder-form-actions">
          <button class="btn btn-secondary btn-sm" id="btn-cancel-reminder">${I18n.t('reminders.cancel')}</button>
          <button class="btn btn-primary btn-sm" id="btn-save-reminder">${I18n.t('reminders.save')}</button>
        </div>
      </div>
    </div>
  `;

  bindReminderEvents();
}

function renderReminderItem(r) {
  const icon = r.mode === 'countdown' ? '🍅' : '💧';
  const statusLabel = I18n.t(`reminders.status${capitalize(r.status)}`) || r.status;
  const durationMin = Math.round(r.duration / 60);
  const isRunning = r.status === 'running';
  const isTriggered = r.status === 'triggered';
  const isPaused = r.status === 'paused';

  return `
    <div class="reminder-item${isTriggered ? ' reminder-triggered' : ''}${!r.enabled ? ' reminder-disabled' : ''}" data-id="${escapeAttr(r.id)}">
      <div class="reminder-item-left">
        <div class="reminder-item-icon">${icon}</div>
        <div class="reminder-item-info">
          <div class="reminder-item-name">${escapeHtml(r.name)}</div>
          <div class="reminder-item-detail">
            ${r.mode === 'interval' ? I18n.t('reminders.every') : I18n.t('reminders.countdown')}
            ${durationMin}min
            ${r.round > 0 ? ' · ' + I18n.t('reminders.round') + ' ' + r.round : ''}
            ${r.tts ? '' : ' · 🔇'}
          </div>
        </div>
      </div>
      <div class="reminder-item-right">
        <span class="reminder-status-badge reminder-status-${r.status}">${statusLabel}</span>
        <div class="reminder-item-actions">
          ${isRunning ? `<button class="btn-icon btn-icon-sm reminder-action-btn" data-action="pause" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.pause')}">⏸</button>` : ''}
          ${isPaused ? `<button class="btn-icon btn-icon-sm reminder-action-btn" data-action="resume" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.resume')}">▶</button>` : ''}
          ${isTriggered ? `<button class="btn-icon btn-icon-sm reminder-action-btn" data-action="dismiss" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.dismiss')}">✓</button>` : ''}
          <button class="btn-icon btn-icon-sm reminder-action-btn" data-action="toggle" data-id="${escapeAttr(r.id)}" title="${r.enabled ? I18n.t('reminders.disable') : I18n.t('reminders.enable')}">${r.enabled ? '🔴' : '🟢'}</button>
          <button class="btn-icon btn-icon-sm reminder-action-btn" data-action="edit" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.edit')}">✏</button>
          <button class="btn-icon btn-icon-sm reminder-action-btn" data-action="delete" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.delete')}">🗑</button>
        </div>
      </div>
    </div>
  `;
}

// ==================== Events ====================

function bindReminderEvents() {
  // Add button
  const addBtn = document.getElementById('btn-add-reminder');
  if (addBtn) addBtn.addEventListener('click', () => showReminderForm(null));

  // Mode toggle
  const modeSegments = document.getElementById('reminder-mode-segments');
  if (modeSegments) {
    modeSegments.querySelectorAll('.segment').forEach((seg) => {
      seg.addEventListener('click', () => {
        modeSegments.querySelectorAll('.segment').forEach(s => s.classList.remove('active'));
        seg.classList.add('active');
        const mode = seg.dataset.mode;
        toggleCountdownFields(mode === 'countdown');
        // Default auto_start based on mode
        const autoStartCheckbox = document.getElementById('reminder-auto-start');
        if (autoStartCheckbox && !editTarget) {
          autoStartCheckbox.checked = mode === 'interval';
        }
      });
    });
  }

  // Cancel
  const cancelBtn = document.getElementById('btn-cancel-reminder');
  if (cancelBtn) cancelBtn.addEventListener('click', () => hideReminderForm());

  // Save
  const saveBtn = document.getElementById('btn-save-reminder');
  if (saveBtn) saveBtn.addEventListener('click', () => saveReminder());

  // List actions
  const list = document.getElementById('reminders-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.reminder-action-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      handleReminderAction(action, id);
    });
  }
}

function toggleCountdownFields(show) {
  const breakItem = document.getElementById('reminder-break-item');
  const roundsItem = document.getElementById('reminder-rounds-item');
  if (breakItem) breakItem.classList.toggle('hidden', !show);
  if (roundsItem) roundsItem.classList.toggle('hidden', !show);
}

function showReminderForm(id) {
  editTarget = id;
  const form = document.getElementById('reminder-form');
  const titleEl = document.getElementById('reminder-form-title');
  if (!form) return;

  form.classList.remove('hidden');

  if (id) {
    const r = reminders.find(x => x.id === id);
    if (!r) return;
    titleEl.textContent = I18n.t('reminders.editTitle');
    document.getElementById('reminder-name').value = r.name;
    // Set mode
    const modeSegments = document.getElementById('reminder-mode-segments');
    modeSegments.querySelectorAll('.segment').forEach(seg => {
      seg.classList.toggle('active', seg.dataset.mode === r.mode);
    });
    document.getElementById('reminder-duration-min').value = Math.round(r.duration / 60);
    document.getElementById('reminder-break-min').value = r.break_duration ? Math.round(r.break_duration / 60) : 5;
    document.getElementById('reminder-rounds').value = r.total_rounds || 0;
    document.getElementById('reminder-auto-start').checked = r.auto_start;
    document.getElementById('reminder-tts').checked = r.tts;
    document.getElementById('reminder-action').value = r.action || '';
    toggleCountdownFields(r.mode === 'countdown');
  } else {
    titleEl.textContent = I18n.t('reminders.addTitle');
    document.getElementById('reminder-name').value = '';
    document.getElementById('reminder-duration-min').value = 30;
    document.getElementById('reminder-break-min').value = 5;
    document.getElementById('reminder-rounds').value = 4;
    document.getElementById('reminder-auto-start').checked = true;
    document.getElementById('reminder-tts').checked = true;
    document.getElementById('reminder-action').value = '';
    toggleCountdownFields(false);
  }
}

function hideReminderForm() {
  editTarget = null;
  const form = document.getElementById('reminder-form');
  if (form) form.classList.add('hidden');
}

async function saveReminder() {
  const name = (document.getElementById('reminder-name')?.value || '').trim();
  if (!name) return;

  const activeModeBtn = document.querySelector('#reminder-mode-segments .segment.active');
  const mode = activeModeBtn ? activeModeBtn.dataset.mode : 'interval';
  const durationMin = parseInt(document.getElementById('reminder-duration-min')?.value) || 30;
  const breakMin = parseInt(document.getElementById('reminder-break-min')?.value) || 5;
  const totalRounds = parseInt(document.getElementById('reminder-rounds')?.value) || 0;
  const autoStart = document.getElementById('reminder-auto-start')?.checked ?? true;
  const tts = document.getElementById('reminder-tts')?.checked ?? true;
  const action = (document.getElementById('reminder-action')?.value || '').trim();

  const body = {
    name,
    mode,
    duration: durationMin * 60,
    break_duration: breakMin * 60,
    total_rounds: totalRounds,
    auto_start: autoStart,
    tts,
    action,
  };

  if (editTarget) {
    body.id = editTarget;
    body.start = false; // Don't restart when just editing
  }

  try {
    await fetch(API_REMINDERS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    hideReminderForm();
    await loadReminders();
  } catch (e) {
    console.error('[Reminders] save failed:', e);
  }
}

async function handleReminderAction(action, id) {
  try {
    switch (action) {
      case 'toggle':
        await fetch(`${API_REMINDERS}/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
        break;
      case 'dismiss':
        await fetch(`${API_REMINDERS}/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
        break;
      case 'pause':
        await fetch(`${API_REMINDERS}/${encodeURIComponent(id)}/pause`, { method: 'POST' });
        break;
      case 'resume':
        await fetch(`${API_REMINDERS}/${encodeURIComponent(id)}/resume`, { method: 'POST' });
        break;
      case 'edit':
        showReminderForm(id);
        return; // don't reload
      case 'delete':
        if (!confirm(I18n.t('reminders.deleteConfirm'))) return;
        await fetch(`${API_REMINDERS}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        break;
    }
    await loadReminders();
  } catch (e) {
    console.error(`[Reminders] ${action} failed:`, e);
  }
}

// ==================== Helpers ====================

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function updateRemindersText() {
  loadReminders();
}
