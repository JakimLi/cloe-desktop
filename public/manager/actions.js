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
let actionsToolbar;

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
  actionsToolbar = document.getElementById('actions-toolbar');

  document.getElementById('btn-refresh').addEventListener('click', loadSets);
  document.getElementById('btn-create-set').addEventListener('click', openCreateSetModal);
  document.getElementById('btn-add-action').addEventListener('click', openAddActionModal);
  initCreateSetModal();
  initAddActionModal();
  initConfirmModal();
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
  updateModalsText();
}

function updateModalsText() {
  const createTitle = document.getElementById('create-set-modal-title');
  if (createTitle) createTitle.textContent = I18n.t('createSet.title');
  const addActionTitle = document.getElementById('add-action-modal-title');
  if (addActionTitle) addActionTitle.textContent = I18n.t('addAction.title');
  const createBtn = document.getElementById('btn-submit-create-set');
  if (createBtn) createBtn.textContent = I18n.t('createSet.button');
  const addBtn = document.getElementById('btn-submit-add-action');
  if (addBtn) addBtn.textContent = I18n.t('addAction.button');
  const cancelCreate = document.getElementById('btn-cancel-create-set');
  if (cancelCreate) cancelCreate.textContent = I18n.t('common.cancel');
  const cancelAdd = document.getElementById('btn-cancel-add-action');
  if (cancelAdd) cancelAdd.textContent = I18n.t('common.cancel');
  const addActionBarBtn = document.getElementById('btn-add-action');
  if (addActionBarBtn) addActionBarBtn.textContent = I18n.t('addAction.toolbar');
  const createSetBtn = document.getElementById('btn-create-set');
  if (createSetBtn) createSetBtn.title = I18n.t('createSet.title');
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

async function createSet(data) {
  const res = await fetch(`${API_BASE}/action-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error);
  }
  return res.json();
}

async function deleteSet(setId) {
  const res = await fetch(`${API_BASE}/action-sets/${setId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error);
  }
  return res.json();
}

async function activateSet(setId) {
  const res = await fetch(`${API_BASE}/action-sets/${setId}/activate`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error);
  }
  return res.json();
}

async function addAction(setId, data) {
  const res = await fetch(`${API_BASE}/action-sets/${setId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error);
  }
  return res.json();
}

async function deleteAction(setId, actionName) {
  const res = await fetch(`${API_BASE}/action-sets/${setId}/actions/${actionName}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error);
  }
  return res.json();
}

// ==================== File Helpers ====================
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Remove data:mime;base64, prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==================== Set Tabs ====================
function renderSetTabs() {
  setTabsEl.innerHTML = '';
  setsCache.forEach(set => {
    const wrapper = document.createElement('div');
    wrapper.className = `set-tab-wrapper ${set.id === currentSetId ? 'active' : ''}`;

    const btn = document.createElement('button');
    btn.className = `set-tab ${set.id === currentSetId ? 'active' : ''}`;
    btn.dataset.setId = set.id;
    const thumb = set.reference
      ? `<img src="${ASSET_BASE}${set.reference}" class="set-tab-thumb" alt="">` : '';
    const activeBadge = set.active ? '<span class="set-tab-active-dot"></span>' : '';
    btn.innerHTML = `${thumb}<span>${set.name}</span>${activeBadge}`;
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.set-tab-delete') || e.target.closest('.set-tab-activate')) return;
      selectSet(set.id);
    });
    wrapper.appendChild(btn);

    // Activate button (only for non-active sets)
    if (!set.active) {
      const activateBtn = document.createElement('button');
      activateBtn.className = 'set-tab-activate btn-icon';
      activateBtn.title = I18n.t('set.activate');
      activateBtn.innerHTML = '▶';
      activateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleActivateSet(set.id);
      });
      wrapper.appendChild(activateBtn);
    }

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'set-tab-delete btn-icon';
    deleteBtn.title = I18n.t('set.delete');
    deleteBtn.innerHTML = '×';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteSet(set.id, set.name);
    });
    wrapper.appendChild(deleteBtn);

    setTabsEl.appendChild(wrapper);
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

// ==================== Create Set Modal ====================
let setReferenceBase64 = null;

function openCreateSetModal() {
  const modal = document.getElementById('create-set-modal');
  document.getElementById('create-set-form').reset();
  setReferenceBase64 = null;
  document.getElementById('set-reference-preview').classList.add('hidden');
  document.getElementById('create-set-modal-title').textContent = I18n.t('createSet.title');
  document.getElementById('btn-submit-create-set').textContent = I18n.t('createSet.button');
  document.getElementById('btn-cancel-create-set').textContent = I18n.t('common.cancel');
  modal.classList.remove('hidden');
}

function closeCreateSetModal() {
  document.getElementById('create-set-modal').classList.add('hidden');
  setReferenceBase64 = null;
}

function initCreateSetModal() {
  const modal = document.getElementById('create-set-modal');
  document.getElementById('btn-close-create-set').addEventListener('click', closeCreateSetModal);
  document.getElementById('btn-cancel-create-set').addEventListener('click', closeCreateSetModal);
  modal.querySelector('.modal-backdrop').addEventListener('click', closeCreateSetModal);

  // Reference image preview
  document.getElementById('set-reference').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setReferenceBase64 = await readFileAsBase64(file);
    const previewEl = document.getElementById('set-reference-preview');
    document.getElementById('set-reference-preview-img').src = `data:${file.type};base64,${setReferenceBase64}`;
    previewEl.classList.remove('hidden');
  });

  document.getElementById('set-reference-remove').addEventListener('click', () => {
    setReferenceBase64 = null;
    document.getElementById('set-reference').value = '';
    document.getElementById('set-reference-preview').classList.add('hidden');
  });

  // Submit
  document.getElementById('btn-submit-create-set').addEventListener('click', async () => {
    const name = document.getElementById('set-name').value.trim();
    if (!name) {
      showStatus(`✗ ${I18n.t('createSet.errorNameRequired')}`, 'error');
      return;
    }
    const nameEn = document.getElementById('set-name-en').value.trim();
    const description = document.getElementById('set-desc-input').value.trim();
    const descriptionEn = document.getElementById('set-desc-en-input').value.trim();
    const chromakey = document.getElementById('set-chromakey').value;

    const submitBtn = document.getElementById('btn-submit-create-set');
    submitBtn.disabled = true;
    submitBtn.textContent = I18n.t('common.creating') + '...';

    try {
      const newSet = await createSet({
        name, nameEn, description, descriptionEn, chromakey,
        referenceBase64: setReferenceBase64,
      });
      closeCreateSetModal();
      showStatus(`✓ ${I18n.t('createSet.success', { name: newSet.name })}`, 'success');
      // Auto-select and activate the new set
      await handleActivateSet(newSet.id);
    } catch (err) {
      showStatus(`✗ ${I18n.t('createSet.error', { error: err.message })}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = I18n.t('createSet.button');
    }
  });
}

// ==================== Add Action Modal ====================
let actionGifBase64 = null;

function openAddActionModal() {
  if (!currentSetId) return;
  const modal = document.getElementById('add-action-modal');
  document.getElementById('add-action-form').reset();
  actionGifBase64 = null;
  document.getElementById('action-gif-preview').classList.add('hidden');
  document.getElementById('action-weight-group').style.display = 'none';
  document.getElementById('add-action-modal-title').textContent = I18n.t('addAction.title');
  document.getElementById('btn-submit-add-action').textContent = I18n.t('addAction.button');
  document.getElementById('btn-cancel-add-action').textContent = I18n.t('common.cancel');
  modal.classList.remove('hidden');
}

function closeAddActionModal() {
  document.getElementById('add-action-modal').classList.add('hidden');
  actionGifBase64 = null;
}

function initAddActionModal() {
  const modal = document.getElementById('add-action-modal');
  document.getElementById('btn-close-add-action').addEventListener('click', closeAddActionModal);
  document.getElementById('btn-cancel-add-action').addEventListener('click', closeAddActionModal);
  modal.querySelector('.modal-backdrop').addEventListener('click', closeAddActionModal);

  // Trigger type toggle for weight field
  document.getElementById('action-trigger').addEventListener('change', (e) => {
    document.getElementById('action-weight-group').style.display =
      e.target.value === 'idle' ? 'block' : 'none';
  });

  // GIF preview
  document.getElementById('action-gif').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    actionGifBase64 = await readFileAsBase64(file);
    const previewEl = document.getElementById('action-gif-preview');
    document.getElementById('action-gif-preview-img').src = `data:${file.type};base64,${actionGifBase64}`;
    previewEl.classList.remove('hidden');
  });

  document.getElementById('action-gif-remove').addEventListener('click', () => {
    actionGifBase64 = null;
    document.getElementById('action-gif').value = '';
    document.getElementById('action-gif-preview').classList.add('hidden');
  });

  // Submit
  document.getElementById('btn-submit-add-action').addEventListener('click', async () => {
    const name = document.getElementById('action-name').value.trim();
    if (!name) {
      showStatus(`✗ ${I18n.t('addAction.errorNameRequired')}`, 'error');
      return;
    }
    if (!actionGifBase64) {
      showStatus(`✗ ${I18n.t('addAction.errorGifRequired')}`, 'error');
      return;
    }
    const trigger = document.getElementById('action-trigger').value;
    const weight = parseInt(document.getElementById('action-weight').value, 10) || 1;

    const submitBtn = document.getElementById('btn-submit-add-action');
    submitBtn.disabled = true;
    submitBtn.textContent = I18n.t('common.adding') + '...';

    try {
      const result = await addAction(currentSetId, {
        name, gifBase64: actionGifBase64, trigger, idleWeight: weight,
      });
      closeAddActionModal();
      showStatus(`✓ ${I18n.t('addAction.success', { name })}`, 'success');
      renderActions(result.actions || []);
      // Refresh set tabs to update action count
      const setData = await fetchSets();
      setsCache = setData.sets || [];
      renderSetTabs();
    } catch (err) {
      showStatus(`✗ ${I18n.t('addAction.error', { error: err.message })}`, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = I18n.t('addAction.button');
    }
  });
}

// ==================== Confirm Modal ====================
let confirmCallback = null;

function showConfirm(title, message, okText, callback) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;
  document.getElementById('btn-confirm-ok').textContent = okText;
  confirmCallback = callback;
  modal.classList.remove('hidden');
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.add('hidden');
  confirmCallback = null;
}

function initConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('btn-close-confirm').addEventListener('click', closeConfirmModal);
  document.getElementById('btn-cancel-confirm').addEventListener('click', closeConfirmModal);
  modal.querySelector('.modal-backdrop').addEventListener('click', closeConfirmModal);
  document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirmModal();
  });
}

// ==================== Set Operations ====================
async function handleActivateSet(setId) {
  try {
    const result = await activateSet(setId);
    showStatus(`✓ ${I18n.t('set.activated')}`, 'success');
    // Reload all sets to refresh active status
    const data = await fetchSets();
    setsCache = data.sets || [];
    currentSetId = result.activeSetId || setId;
    renderSetTabs();
    await loadSetDetail(currentSetId);
  } catch (err) {
    showStatus(`✗ ${I18n.t('set.activateError', { error: err.message })}`, 'error');
  }
}

function handleDeleteSet(setId, setName) {
  const set = setsCache.find(s => s.id === setId);
  if (!set) return;
  if (set.active) {
    showStatus(`✗ ${I18n.t('set.errorDeleteActive')}`, 'error');
    return;
  }
  showConfirm(
    I18n.t('set.deleteConfirmTitle'),
    I18n.t('set.deleteConfirm', { name: setName }),
    I18n.t('delete.button'),
    async () => {
      try {
        const result = await deleteSet(setId);
        showStatus(`✓ ${I18n.t('set.deleted', { name: setName })}`, 'success');
        setsCache = result.sets || [];
        // If we deleted the currently viewed set, switch to active
        if (currentSetId === setId) {
          currentSetId = result.activeSetId || (setsCache[0] && setsCache[0].id);
        }
        renderSetTabs();
        await loadSetDetail(currentSetId);
      } catch (err) {
        showStatus(`✗ ${I18n.t('set.deleteError', { error: err.message })}`, 'error');
      }
    }
  );
}

// ==================== Action Delete ====================
function handleDeleteAction(actionName) {
  if (!currentSetId) return;
  showConfirm(
    I18n.t('action.deleteConfirmTitle'),
    I18n.t('action.deleteConfirm', { name: actionName }),
    I18n.t('delete.button'),
    async () => {
      try {
        const result = await deleteAction(currentSetId, actionName);
        showStatus(`✓ ${I18n.t('action.deleted', { name: actionName })}`, 'success');
        renderActions(result.actions || []);
        // Refresh set tabs to update action count
        const setData = await fetchSets();
        setsCache = setData.sets || [];
        renderSetTabs();
      } catch (err) {
        showStatus(`✗ ${I18n.t('action.deleteError', { error: err.message })}`, 'error');
      }
    }
  );
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
          <button class="btn btn-danger btn-delete" data-action="${action.name}" title="${I18n.t('delete.title')}">${I18n.t('delete.button')}</button>
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
  actionsGrid.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handleDeleteAction(btn.dataset.action);
    });
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
  actionsToolbar.classList.add('hidden');

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
  actionsToolbar.classList.add('hidden');

  try {
    const data = await fetchSetDetail(setId);
    renderSetInfo(data);
    renderActions(data.actions || []);
    actionsToolbar.classList.remove('hidden');
  } catch (err) {
    showStatus(`✗ ${I18n.t('error.loadFailed', { error: err.message })}`, 'error');
  }
}
