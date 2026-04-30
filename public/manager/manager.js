// ==================== Cloe Action Manager — Client ====================

const API_BASE = 'http://127.0.0.1:19851';

// Determine the base path for GIF assets
// When loaded via file:// in Electron, we need to resolve relative to the app
// When loaded via Vite dev server, use the dev server URL
const isDev = location.protocol === 'http:';
const GIF_BASE = isDev ? 'http://localhost:5173/gifs/' : '../gifs/';

// ==================== DOM refs ====================
const actionsGrid = document.getElementById('actions-grid');
const actionCount = document.getElementById('action-count');
const emptyState = document.getElementById('empty-state');
const loading = document.getElementById('loading');
const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('status-text');
const btnRefresh = document.getElementById('btn-refresh');
const btnLangSwitch = document.getElementById('btn-lang-switch');

// Modal
const previewModal = document.getElementById('preview-modal');
const previewTitle = document.getElementById('preview-title');
const previewGif = document.getElementById('preview-gif');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnPlayAction = document.getElementById('btn-play-action');
const modalBackdrop = previewModal.querySelector('.modal-backdrop');

let currentPreviewAction = null;
let actionsCache = [];

// ==================== i18n text helpers ====================

function specialLabel(special) {
  if (special === '工作模式') return I18n.t('tag.specialWork');
  if (special === '语音') return I18n.t('tag.specialSpeak');
  return special;
}

function updateStaticText() {
  document.title = I18n.t('windowTitle');
  document.getElementById('header-title').textContent = I18n.t('title');
  btnRefresh.title = I18n.t('refresh');
  btnLangSwitch.textContent = I18n.getSwitchLabel();
  btnLangSwitch.title = I18n.t('lang');
  loading.querySelector('p').textContent = I18n.t('loading');
  emptyState.querySelector('p').textContent = I18n.t('empty.title');
  emptyState.querySelector('.sub').textContent = I18n.t('empty.sub');
  // Update action count badge if we have cached data
  if (actionsCache.length > 0) {
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

    // Build tags
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

  // Bind events
  actionsGrid.querySelectorAll('.btn-preview').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = btn.dataset.action;
      playAction(name);
    });
  });

  actionsGrid.querySelectorAll('.card-preview').forEach((el) => {
    el.addEventListener('click', () => {
      const name = el.dataset.action;
      openPreview(name);
    });
  });
}

function openPreview(name) {
  currentPreviewAction = name;
  previewTitle.textContent = I18n.t('preview.titleWith', { name });
  previewGif.src = `${GIF_BASE}${name}.gif`;
  btnPlayAction.textContent = '▶ ' + I18n.t('preview.play');
  previewModal.classList.remove('hidden');
}

function closePreview() {
  previewModal.classList.add('hidden');
  previewGif.src = '';
  currentPreviewAction = null;
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
async function load() {
  loading.classList.remove('hidden');
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
    loading.classList.add('hidden');
  }
}

// ==================== Event listeners ====================
btnRefresh.addEventListener('click', load);

btnLangSwitch.addEventListener('click', async () => {
  const nextLocale = I18n.getSwitchLocale();
  await I18n.switchLocale(nextLocale);
  updateStaticText();
  // Re-render cards with new language (no refetch needed)
  if (actionsCache.length > 0) {
    renderActions(actionsCache);
  }
  // Update empty/loading text
  emptyState.querySelector('p').textContent = I18n.t('empty.title');
  emptyState.querySelector('.sub').textContent = I18n.t('empty.sub');
  loading.querySelector('p').textContent = I18n.t('loading');
});

btnCloseModal.addEventListener('click', closePreview);
modalBackdrop.addEventListener('click', closePreview);
btnPlayAction.addEventListener('click', () => {
  if (currentPreviewAction) {
    playAction(currentPreviewAction);
  }
});

// ESC to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePreview();
});

// ==================== Bootstrap ====================
(async () => {
  await I18n.init();
  updateStaticText();
  load();
})();
