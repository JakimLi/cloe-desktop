// ==================== Cloe Settings — Reminders Tab ====================
// (API_CONFIG_BASE is defined in preferences.js, loaded before this file)

const API_REMINDERS = API_CONFIG_BASE + '/reminders';

function initRemindersTab() {
  loadAvailableActions().then(() => loadReminders());
}

async function loadAvailableActions() {
  try {
    const res = await fetch(API_CONFIG_BASE + '/actions');
    const data = await res.json();
    availableActions = (data.actions || []).filter(a =>
      // Exclude util/internal actions not suitable for reminders
      !['working', 'idle', 'walk_right', 'walk_left', 'speak'].includes(a.name)
    );
  } catch (e) {
    console.error('[Reminders] load actions failed:', e);
    availableActions = [];
  }
}

// ==================== Data ====================

let reminders = [];
let editTarget = null; // null = creating new, string = editing id
let availableActions = []; // cached action list from /actions API

// ==================== SVG Icons (Lucide-style) ====================

const SVG = {
  // Reminder type icons
  interval: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
  countdown: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/></svg>',
  // Action icons
  pause: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  resume: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>',
  dismiss: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  power_on: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
  power_off: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  delete: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  // Mute indicator
  mute: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/></svg>',
};

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
    <div class="rm-toolbar">
      <div class="rm-toolbar-title">${I18n.t('reminders.title')}</div>
      <button class="rm-btn-add" id="btn-add-reminder">
        ${SVG.edit.replace('width="15" height="15"', 'width="14" height="14"').replace('M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z', 'M12 5v14M5 12h14')}
        <span>${I18n.t('reminders.add')}</span>
      </button>
    </div>

    <div id="reminders-list" class="rm-list">
      ${reminders.length === 0 ? `<div class="rm-empty">${I18n.t('reminders.empty')}</div>` : ''}
      ${reminders.map(renderReminderItem).join('')}
    </div>

    <!-- Add/Edit Form -->
    <div id="reminder-form" class="rm-form hidden"></div>
  `;

  bindReminderEvents();
}

function renderReminderItem(r) {
  const icon = r.mode === 'countdown' ? SVG.countdown : SVG.interval;
  const iconClass = r.mode === 'countdown' ? 'rm-ico-timer' : 'rm-ico-drop';
  const statusLabel = I18n.t(`reminders.status${capitalize(r.status)}`) || r.status;
  const statusClass = `rm-status-${r.status}`;
  const durationMin = Math.round(r.duration / 60);
  const isRunning = r.status === 'running';
  const isTriggered = r.status === 'triggered';
  const isPaused = r.status === 'paused';
  const isCompleted = r.status === 'completed';

  // Primary action button (context-aware)
  let primaryBtn = '';
  if (isRunning) {
    primaryBtn = `<button class="rm-action" data-action="pause" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.pause')}">${SVG.pause}</button>`;
  } else if (isPaused) {
    primaryBtn = `<button class="rm-action" data-action="resume" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.resume')}">${SVG.resume}</button>`;
  } else if (isTriggered) {
    primaryBtn = `<button class="rm-action rm-action-accent" data-action="dismiss" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.dismiss')}">${SVG.dismiss}</button>`;
  }

  // Toggle button
  const toggleBtn = r.enabled
    ? `<button class="rm-action rm-action-on" data-action="toggle" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.disable')}">${SVG.power_on}</button>`
    : `<button class="rm-action" data-action="toggle" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.enable')}">${SVG.power_off}</button>`;

  return `
    <div class="rm-card${isTriggered ? ' rm-card-active' : ''}${!r.enabled ? ' rm-card-off' : ''}${isCompleted ? ' rm-card-done' : ''}" data-id="${escapeAttr(r.id)}">
      <div class="rm-card-icon ${iconClass}">${icon}</div>
      <div class="rm-card-body">
        <div class="rm-card-name">${escapeHtml(r.name)}</div>
        <div class="rm-card-meta">
          <span>${r.mode === 'interval' ? I18n.t('reminders.every') : I18n.t('reminders.countdown')} ${durationMin}min</span>
          ${r.mode === 'countdown' && r.round > 0 ? `<span class="rm-dot"></span><span>${I18n.t('reminders.round')} ${r.round}${r.total_rounds > 0 ? '/' + r.total_rounds : ''}</span>` : ''}
          ${r.tts ? '' : `<span class="rm-dot"></span>${SVG.mute}`}
          ${isRunning && r.trigger_at ? `<span class="rm-dot"></span><span class="rm-next-time">${formatNextTime(r.trigger_at)}</span>` : ''}
        </div>
      </div>
      <div class="rm-card-side">
        <span class="rm-badge ${statusClass}">${statusLabel}</span>
        <div class="rm-card-btns">
          ${primaryBtn}
          ${toggleBtn}
          <button class="rm-action" data-action="edit" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.edit')}">${SVG.edit}</button>
          <button class="rm-action rm-action-danger" data-action="delete" data-id="${escapeAttr(r.id)}" title="${I18n.t('reminders.delete')}">${SVG.delete}</button>
        </div>
      </div>
    </div>
  `;
}

// ==================== Events ====================

function bindReminderEvents() {
  const addBtn = document.getElementById('btn-add-reminder');
  if (addBtn) addBtn.addEventListener('click', () => showReminderForm(null));

  const list = document.getElementById('reminders-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.rm-action');
      if (!btn) return;
      handleReminderAction(btn.dataset.action, btn.dataset.id);
    });
  }
}

function showReminderForm(id) {
  editTarget = id;
  const form = document.getElementById('reminder-form');
  if (!form) return;

  const isEdit = !!id;
  const r = isEdit ? reminders.find(x => x.id === id) : null;
  const mode = r ? r.mode : 'interval';

  form.classList.remove('hidden');
  form.innerHTML = renderFormHTML(isEdit, r, mode);

  // Bind mode segments
  const modeSegments = document.getElementById('reminder-mode-segments');
  if (modeSegments) {
    modeSegments.querySelectorAll('.segment').forEach((seg) => {
      seg.addEventListener('click', () => {
        modeSegments.querySelectorAll('.segment').forEach(s => s.classList.remove('active'));
        seg.classList.add('active');
        const isCountdown = seg.dataset.mode === 'countdown';
        toggleCountdownFields(isCountdown);
        // Clear countdown-specific fields when switching to interval
        if (!isCountdown) {
          const breakInput = document.getElementById('reminder-break-min');
          const roundsInput = document.getElementById('reminder-rounds');
          if (breakInput) breakInput.value = 0;
          if (roundsInput) roundsInput.value = 0;
        }
        const autoStartCheckbox = document.getElementById('reminder-auto-start');
        if (autoStartCheckbox && !editTarget) {
          autoStartCheckbox.checked = !isCountdown;
        }
      });
    });
  }

  const cancelBtn = document.getElementById('btn-cancel-reminder');
  if (cancelBtn) cancelBtn.addEventListener('click', () => hideReminderForm());

  const saveBtn = document.getElementById('btn-save-reminder');
  if (saveBtn) saveBtn.addEventListener('click', () => saveReminder());

  // Scroll into view
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderFormHTML(isEdit, r, mode) {
  const name = r ? r.name : '';
  const duration = r ? Math.round(r.duration / 60) : 30;
  const breakDur = r && r.break_duration ? Math.round(r.break_duration / 60) : 5;
  const rounds = r ? (r.total_rounds || 0) : 4;
  const autoStart = r ? r.auto_start : true;
  const tts = r ? r.tts : true;
  const action = r ? (r.action || '') : '';
  const isCountdown = mode === 'countdown';

  return `
    <div class="rm-form-inner">
      <div class="rm-form-head">
        <span class="rm-form-title">${isEdit ? I18n.t('reminders.editTitle') : I18n.t('reminders.addTitle')}</span>
        <button class="rm-form-close" id="btn-cancel-reminder" title="${I18n.t('reminders.cancel')}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="rm-form-row">
        <div class="rm-field">
          <label class="rm-label">${I18n.t('reminders.fieldName')}</label>
          <input type="text" id="reminder-name" class="form-input rm-input" placeholder="${I18n.t('reminders.fieldNamePlaceholder')}" value="${escapeAttr(name)}">
        </div>
        <div class="rm-field rm-field-sm">
          <label class="rm-label">${I18n.t('reminders.fieldMode')}</label>
          <div class="segmented-control" id="reminder-mode-segments">
            <button class="segment${mode === 'interval' ? ' active' : ''}" data-mode="interval">${I18n.t('reminders.modeInterval')}</button>
            <button class="segment${mode === 'countdown' ? ' active' : ''}" data-mode="countdown">${I18n.t('reminders.modeCountdown')}</button>
          </div>
        </div>
      </div>

      <div class="rm-form-row">
        <div class="rm-field rm-field-sm">
          <label class="rm-label">${I18n.t('reminders.fieldDuration')}</label>
          <div class="rm-input-group">
            <input type="number" id="reminder-duration-min" class="form-input rm-input rm-input-narrow" min="1" max="720" value="${duration}">
            <span class="rm-unit">${I18n.t('reminders.minutes')}</span>
          </div>
        </div>
        <div class="rm-field rm-field-sm${isCountdown ? '' : ' hidden'}" id="reminder-break-item">
          <label class="rm-label">${I18n.t('reminders.fieldBreakDuration')}</label>
          <div class="rm-input-group">
            <input type="number" id="reminder-break-min" class="form-input rm-input rm-input-narrow" min="0" max="120" value="${breakDur}">
            <span class="rm-unit">${I18n.t('reminders.minutes')}</span>
          </div>
        </div>
        <div class="rm-field rm-field-sm${isCountdown ? '' : ' hidden'}" id="reminder-rounds-item">
          <label class="rm-label">${I18n.t('reminders.fieldTotalRounds')}</label>
          <input type="number" id="reminder-rounds" class="form-input rm-input rm-input-narrow" min="0" max="20" value="${rounds}">
        </div>
      </div>

      <div class="rm-form-row">
        <div class="rm-field rm-field-sm">
          <label class="rm-label">${I18n.t('reminders.fieldAction')}</label>
          <select id="reminder-action" class="form-input rm-input rm-select">
            <option value="">${I18n.t('reminders.fieldActionPlaceholder')}</option>
            ${availableActions.map(a => `<option value="${escapeAttr(a.name)}"${a.name === action ? ' selected' : ''}>${escapeHtml(a.name)} — ${escapeHtml(a.description || '')}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="rm-form-toggles">
        <label class="rm-toggle-row">
          <span class="rm-toggle-label">${I18n.t('reminders.fieldAutoStart')}<span class="rm-toggle-desc">${I18n.t('reminders.fieldAutoStartDesc')}</span></span>
          <label class="toggle"><input type="checkbox" id="reminder-auto-start" ${autoStart ? 'checked' : ''}><span class="toggle-slider"></span></label>
        </label>
        <label class="rm-toggle-row">
          <span class="rm-toggle-label">${I18n.t('reminders.fieldTTS')}<span class="rm-toggle-desc">${I18n.t('reminders.fieldTTSDesc')}</span></span>
          <label class="toggle"><input type="checkbox" id="reminder-tts" ${tts ? 'checked' : ''}><span class="toggle-slider"></span></label>
        </label>
      </div>

      <div class="rm-form-foot">
        <button class="btn btn-primary btn-sm" id="btn-save-reminder">${I18n.t('reminders.save')}</button>
      </div>
    </div>
  `;
}

function hideReminderForm() {
  editTarget = null;
  const form = document.getElementById('reminder-form');
  if (form) {
    form.classList.add('hidden');
    form.innerHTML = '';
  }
}

function toggleCountdownFields(show) {
  const breakItem = document.getElementById('reminder-break-item');
  const roundsItem = document.getElementById('reminder-rounds-item');
  if (breakItem) breakItem.classList.toggle('hidden', !show);
  if (roundsItem) roundsItem.classList.toggle('hidden', !show);
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
    name, mode,
    duration: durationMin * 60,
    break_duration: breakMin * 60,
    total_rounds: totalRounds,
    auto_start: autoStart,
    tts, action,
  };

  if (editTarget) {
    body.id = editTarget;
    body.start = false;
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
        return;
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

function formatNextTime(triggerAtIso) {
  try {
    const target = new Date(triggerAtIso);
    const now = new Date();
    const diffMs = target - now;
    if (diffMs <= 0) return '';
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return '即将提醒';
    if (diffMin < 60) return `${diffMin}分钟后`;
    const targetStr = target.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return `${targetStr}提醒`;
  } catch {
    return '';
  }
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
