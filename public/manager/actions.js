// ==================== Cloe Settings — Actions Tab ====================

const API_BASE = 'http://127.0.0.1:19851';
const isDev = location.protocol === 'http:';
const ASSET_BASE = isDev ? 'http://localhost:5173/' : '../';

let actionsCache = [];
let setsCache = [];
let currentSetId = null;
let actionsGrid, actionCount, setCount, emptyState, loadingEl;
let statusBar, statusText;
let setTabsEl, setInfoEl, referenceThumb, referenceThumbImg;
let setDescEl, setChromakeyEl;

// ==================== Init ====================
function initActionsTab() {
  actionsGrid = document.getElementById('actions-grid');
  actionCount = document.getElementById('action-count');
  setCount = document.getElementById('set-count');
  emptyState = document.getElementById('empty-state');
  loadingEl = document.getElementById('loading');
  statusBar = document.getElementById('status-bar');
  statusText = document.getElementById('status-text');
  setTabsEl = document.getElementById('set-tabs');
  setInfoEl = document.getElementById('set-info');
  referenceThumb = document.getElementById('reference-thumb');
  referenceThumbImg = document.getElementById('reference-thumb-img');
  setDescEl = document.getElementById('set-desc');
  setChromakeyEl = document.getElementById('set-chromakey');

  document.getElementById('btn-refresh').addEventListener('click', loadSets);
  loadSets();
}

// ==================== i18n ====================
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
  if (actionsCache.length > 0) renderActions(actionsCache);
  if (actionCount) actionCount.textContent = I18n.t('actionCount', { count: actionsCache.length });
  if (setsCache.length > 0) renderSetTabs();
  updateSetInfoText();
}

// ==================== API ====================
async function fetchSets() {
  const res = await fetch(`${API_BASE}/action-sets`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchSetDetail(setId) {
  const res = await fetch(`${API_BASE}/action-sets/${setId}`);
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

// ==================== Set Tabs ====================
function renderSetTabs() {
  setTabsEl.innerHTML = '';
  setsCache.forEach(set => {
    const btn = document.createElement('button');
    btn.className = `set-tab ${set.id === currentSetId ? 'active' : ''}`;
    btn.dataset.setId = set.id;
    const thumb = set.reference
      ? `<img src="${ASSET_BASE}${set.reference}" class="set-tab-thumb" alt="">` : '';
    btn.innerHTML = `${thumb}<span>${set.name}</span>`;
    btn.addEventListener('click', () => selectSet(set.id));
    setTabsEl.appendChild(btn);
  });
}

async function selectSet(setId) {
  currentSetId = setId;
  renderSetTabs();
  loadSetDetail(setId);
}

// ==================== Set Info (reference) ====================
function renderSetInfo(set) {
  if (!set || !set.reference) {
    setInfoEl.classList.add('hidden');
    return;
  }
  setInfoEl.classList.remove('hidden');
  referenceThumbImg.src = `${ASSET_BASE}${set.reference}`;
  referenceThumb.title = I18n.t('reference.viewTitle');
  referenceThumb.onclick = () => openReferenceModal(set);
  setDescEl.textContent = set.description || '';
  setChromakeyEl.textContent = set.chromakey
    ? I18n.t('reference.chromakey', { color: set.chromakey }) : '';
}

function updateSetInfoText() {
  if (referenceThumb) referenceThumb.title = I18n.t('reference.viewTitle');
}

// ==================== Reference Modal ====================
function openReferenceModal(set) {
  const modal = document.getElementById('reference-modal');
  document.getElementById('reference-modal-title').textContent =
    I18n.t('reference.modalTitle', { name: set.name });
  document.getElementById('reference-full-img').src = `${ASSET_BASE}${set.reference}`;
  modal.classList.remove('hidden');
}

function closeReferenceModal() {
  document.getElementById('reference-modal').classList.add('hidden');
  document.getElementById('reference-full-img').src = '';
}

function initReferenceModal() {
  document.getElementById('btn-close-reference').addEventListener('click', closeReferenceModal);
  document.getElementById('reference-modal').querySelector('.modal-backdrop')
    .addEventListener('click', closeReferenceModal);
}

// ==================== UI ====================
function showStatus(msg, type = 'success') {
  statusBar.className = `status-bar ${type}`;
  statusText.textContent = msg;
  clearTimeout(statusBar._timer);
  statusBar._timer = setTimeout(() => statusBar.classList.add('hidden'), 3000);
}

function renderActions(actions) {
  actionsCache = actions;
  actionsGrid.innerHTML = '';
  actionCount.textContent = I18n.t('actionCount', { count: actions.length });

  if (actions.length === 0) { emptyState.classList.remove('hidden'); return; }
  emptyState.classList.add('hidden');

  actions.forEach(action => {
    const card = document.createElement('div');
    card.className = 'action-card';

    const tags = [];
    if (action.trigger === 'idle') {
      tags.push(`<span class="tag tag-idle">${I18n.t('tag.idle')}</span>`);
      if (action.idleWeight > 0) tags.push(`<span class="tag tag-weight">${I18n.t('tag.weight', { weight: action.idleWeight })}</span>`);
    } else if (action.trigger === 'manual') {
      tags.push(`<span class="tag tag-manual">${I18n.t('tag.manual')}</span>`);
    } else if (action.trigger === 'hook') {
      tags.push(`<span class="tag tag-hook">${I18n.t('tag.hook', { names: action.hookNames.join(', ') })}</span>`);
    }
    if (action.special) tags.push(`<span class="tag tag-special">${specialLabel(action.special)}</span>`);

    card.innerHTML = `
      <div class="card-preview" data-action="${action.name}">
        <img src="${ASSET_BASE}${action.gifPath}" alt="${action.name}" loading="lazy">
        <div class="play-overlay"><span>▶</span></div>
      </div>
      <div class="card-body">
        <div class="card-name">${action.name}</div>
        <div class="card-meta">${tags.join('')}</div>
        <div class="card-actions">
          <button class="btn btn-primary btn-preview" data-action="${action.name}" title="${I18n.t('preview.button')}">▶ ${I18n.t('preview.button')}</button>
          <button class="btn btn-danger btn-delete" data-action="${action.name}" title="${I18n.t('delete.title')}" disabled>${I18n.t('delete.button')}</button>
        </div>
      </div>`;

    actionsGrid.appendChild(card);
  });

  actionsGrid.querySelectorAll('.btn-preview').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); playAction(btn.dataset.action); });
  });
  actionsGrid.querySelectorAll('.card-preview').forEach(el => {
    el.addEventListener('click', () => openPreview(el.dataset.action));
  });
}

// ==================== Preview Modal ====================
let currentPreviewAction = null;

function openPreview(name) {
  currentPreviewAction = name;
  const modal = document.getElementById('preview-modal');
  document.getElementById('preview-title').textContent = I18n.t('preview.titleWith', { name });
  const action = actionsCache.find(a => a.name === name);
  document.getElementById('preview-gif').src = action
    ? `${ASSET_BASE}${action.gifPath}` : `${ASSET_BASE}gifs/${name}.gif`;
  document.getElementById('btn-play-action').textContent = '▶ ' + I18n.t('preview.play');
  modal.classList.remove('hidden');
}

function closePreview() {
  document.getElementById('preview-modal').classList.add('hidden');
  document.getElementById('preview-gif').src = '';
  currentPreviewAction = null;
}

function initPreviewModal() {
  document.getElementById('btn-close-modal').addEventListener('click', closePreview);
  document.getElementById('preview-modal').querySelector('.modal-backdrop')
    .addEventListener('click', closePreview);
  document.getElementById('btn-play-action').addEventListener('click', () => {
    if (currentPreviewAction) playAction(currentPreviewAction);
  });
}

async function playAction(name) {
  try {
    const r = await previewAction(name);
    showStatus(`✓ ${I18n.t('success.sent', { name, count: r.sent_to })}`, 'success');
  } catch (err) {
    showStatus(`✗ ${I18n.t('error.sendFailed', { error: err.message })}`, 'error');
  }
}

// ==================== Load ====================
async function loadSets() {
  loadingEl.classList.remove('hidden');
  actionsGrid.innerHTML = '';
  emptyState.classList.add('hidden');
  setInfoEl.classList.add('hidden');

  try {
    const data = await fetchSets();
    setsCache = data.sets || [];
    currentSetId = data.activeSetId || (setsCache[0] && setsCache[0].id);
    setCount.textContent = I18n.t('setCount', { count: setsCache.length });

    if (setsCache.length === 0) {
      emptyState.classList.remove('hidden');
      emptyState.querySelector('p').textContent = I18n.t('empty.noSets');
      emptyState.querySelector('.sub').textContent = I18n.t('empty.noSetsSub');
      loadingEl.classList.add('hidden');
      return;
    }

    renderSetTabs();
    await loadSetDetail(currentSetId);
  } catch (err) {
    emptyState.classList.remove('hidden');
    emptyState.querySelector('p').textContent = I18n.t('error.connection');
    emptyState.querySelector('.sub').textContent = I18n.t('error.connectionSub', { error: err.message });
    showStatus(`✗ ${I18n.t('error.connectionFailed', { error: err.message })}`, 'error');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

async function loadSetDetail(setId) {
  actionsGrid.innerHTML = '';
  emptyState.classList.add('hidden');

  try {
    const data = await fetchSetDetail(setId);
    renderSetInfo(data);
    renderActions(data.actions || []);
  } catch (err) {
    showStatus(`✗ ${I18n.t('error.loadFailed', { error: err.message })}`, 'error');
  }
}
