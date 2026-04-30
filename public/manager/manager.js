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

// Modal
const previewModal = document.getElementById('preview-modal');
const previewTitle = document.getElementById('preview-title');
const previewGif = document.getElementById('preview-gif');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnPlayAction = document.getElementById('btn-play-action');
const modalBackdrop = previewModal.querySelector('.modal-backdrop');

let currentPreviewAction = null;

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
  actionsGrid.innerHTML = '';
  actionCount.textContent = `${actions.length} 个动作`;

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
      tags.push(`<span class="tag tag-idle">idle</span>`);
      if (action.idleWeight > 0) {
        tags.push(`<span class="tag tag-weight">权重 ${action.idleWeight}</span>`);
      }
    } else if (action.trigger === 'manual') {
      tags.push(`<span class="tag tag-manual">manual</span>`);
    } else if (action.trigger === 'hook') {
      tags.push(`<span class="tag tag-hook">hook: ${action.hookNames.join(', ')}</span>`);
    }

    if (action.special) {
      tags.push(`<span class="tag tag-special">${action.special}</span>`);
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
          <button class="btn btn-primary btn-preview" data-action="${action.name}" title="播放此动作">▶ 预览</button>
          <button class="btn btn-danger btn-delete" data-action="${action.name}" title="删除（M2）" disabled>🗑 删除</button>
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
  previewTitle.textContent = `预览 — ${name}`;
  previewGif.src = `${GIF_BASE}${name}.gif`;
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
    showStatus(`✓ "${name}" 已发送 (${result.sent_to} 客户端)`, 'success');
  } catch (err) {
    showStatus(`✗ 发送失败: ${err.message}`, 'error');
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
    emptyState.querySelector('p').textContent = '无法连接到 Cloe Desktop';
    emptyState.querySelector('.sub').textContent = `请确认 Cloe Desktop 正在运行 (${err.message})`;
    showStatus(`✗ 连接失败: ${err.message}`, 'error');
  } finally {
    loading.classList.add('hidden');
  }
}

// ==================== Event listeners ====================
btnRefresh.addEventListener('click', load);

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

// Initial load
load();
