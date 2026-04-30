// ==================== Cloe Settings — Actions Tab ====================

const API_BASE = 'http://127.0.0.1:19851';

const isDev = location.protocol === 'http:';
const GIF_BASE = isDev ? 'http://localhost:5173/gifs/' : '../gifs/';

let actionsCache = [];
let actionsGrid, actionCount, emptyState, loadingEl;
let statusBar, statusText;

// ==================== Init ====================
function initActionsTab() {
  actionsGrid = document.getElementById('actions-grid');
  actionCount = document.getElementById('action-count');
  emptyState = document.getElementById('empty-state');
  loadingEl = document.getElementById('loading');
  statusBar = document.getElementById('status-bar');
  statusText = document.getElementById('status-text');

  document.getElementById('btn-refresh').addEventListener('click', loadActions);

  loadActions();
}

// ==================== i18n helpers ====================
function specialLabel(special) {
  if (special === '工作模式') return I18n.t('tag.specialWork');
  if (special === '语音') return I18n.t('tag.specialSpeak');
  return special;
}

function updateActionsText() {
  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) refreshBtn.title = I18n.t('refresh');
  if (loadingEl) loadingEl.querySelector('p').textContent = I18n.t('loading');
  if (emptyState) {
    emptyState.querySelector('p').textContent = I18n.t('empty.title');
    emptyState.querySelector('.sub').textContent = I18n.t('empty.sub');
  }
  if (actionsCache.length > 0) {
    renderActions(actionsCache);
  }
  if (actionCount) {
    actionCount.textContent = I18n.t('actionCount', { count: actionsCache.length });
  }
}

// ==================== API ====================
async function fetchActions() {
  const res = await fetch(`${API_BASE}/actions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function previewAction(name) {
  const res = await fetch(`${API_BASE}/actions/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: name }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ==================== UI ====================
function showStatus(msg, type = 'success') {
  statusBar.className = `status-bar ${type}`;
  statusText.textContent = msg;
  clearTimeout(statusBar._timer);
  statusBar._timer = setTimeout(() => {
    statusBar.classList.add('hidden');
  }, 3000);
}

function renderActions(actions) {
  actionsCache = actions;
  actionsGrid.innerHTML = '';
  actionCount.textContent = I18n.t('actionCount', { count: actions.length });

  if (actions.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  actions.forEach((action) => {
    const card = document.createElement('div');
    card.className = 'action-card';
    card.dataset.name = action.name;

    const tags = [];
    if (action.trigger === 'idle') {
      tags.push(`<span class="tag tag-idle">${I18n.t('tag.idle')}</span>`);
      if (action.idleWeight > 0) {
        tags.push(`<span class="tag tag-weight">${I18n.t('tag.weight', { weight: action.idleWeight })}</span>`);
      }
    } else if (action.trigger === 'manual') {
      tags.push(`<span class="tag tag-manual">${I18n.t('tag.manual')}</span>`);
    } else if (action.trigger === 'hook') {
      tags.push(`<span class="tag tag-hook">${I18n.t('tag.hook', { names: action.hookNames.join(', ') })}</span>`);
    }

    if (action.special) {
      tags.push(`<span class="tag tag-special">${specialLabel(action.special)}</span>`);
    }

    const gifUrl = `${GIF_BASE}${action.gifFile}`;

    card.innerHTML = `
      <div class="card-preview" data-action="${action.name}">
        <img src="${gifUrl}" alt="${action.name}" loading="lazy">
        <div class="play-overlay"><span>▶</span></div>
      </div>
      <div class="card-body">
        <div class="card-name">${action.name}</div>
        <div class="card-meta">${tags.join('')}</div>
        <div class="card-actions">
          <button class="btn btn-primary btn-preview" data-action="${action.name}" title="${I18n.t('preview.button')}">▶ ${I18n.t('preview.button')}</button>
          <button class="btn btn-danger btn-delete" data-action="${action.name}" title="${I18n.t('delete.title')}" disabled>${I18n.t('delete.button')}</button>
        </div>
      </div>
    `;

    actionsGrid.appendChild(card);
  });

  actionsGrid.querySelectorAll('.btn-preview').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playAction(btn.dataset.action);
    });
  });

  actionsGrid.querySelectorAll('.card-preview').forEach((el) => {
    el.addEventListener('click', () => {
      openPreview(el.dataset.action);
    });
  });
}

// ==================== Preview Modal ====================
let currentPreviewAction = null;

function openPreview(name) {
  currentPreviewAction = name;
  const previewModal = document.getElementById('preview-modal');
  const previewTitle = document.getElementById('preview-title');
  const previewGif = document.getElementById('preview-gif');
  const btnPlayAction = document.getElementById('btn-play-action');

  previewTitle.textContent = I18n.t('preview.titleWith', { name });
  previewGif.src = `${GIF_BASE}${name}.gif`;
  btnPlayAction.textContent = '▶ ' + I18n.t('preview.play');
  previewModal.classList.remove('hidden');
}

function closePreview() {
  const previewModal = document.getElementById('preview-modal');
  const previewGif = document.getElementById('preview-gif');
  previewModal.classList.add('hidden');
  previewGif.src = '';
  currentPreviewAction = null;
}

function initPreviewModal() {
  document.getElementById('btn-close-modal').addEventListener('click', closePreview);
  document.getElementById('preview-modal').querySelector('.modal-backdrop').addEventListener('click', closePreview);
  document.getElementById('btn-play-action').addEventListener('click', () => {
    if (currentPreviewAction) playAction(currentPreviewAction);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePreview();
  });
}

async function playAction(name) {
  try {
    const result = await previewAction(name);
    showStatus(`✓ ${I18n.t('success.sent', { name, count: result.sent_to })}`, 'success');
  } catch (err) {
    showStatus(`✗ ${I18n.t('error.sendFailed', { error: err.message })}`, 'error');
  }
}

// ==================== Load ====================
async function loadActions() {
  loadingEl.classList.remove('hidden');
  actionsGrid.innerHTML = '';
  emptyState.classList.add('hidden');

  try {
    const data = await fetchActions();
    renderActions(data.actions);
  } catch (err) {
    emptyState.classList.remove('hidden');
    emptyState.querySelector('p').textContent = I18n.t('error.connection');
    emptyState.querySelector('.sub').textContent = I18n.t('error.connectionSub', { error: err.message });
    showStatus(`✗ ${I18n.t('error.connectionFailed', { error: err.message })}`, 'error');
  } finally {
    loadingEl.classList.add('hidden');
  }
}
