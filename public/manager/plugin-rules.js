// ==================== Cloe Settings — Plugin Rules Tab ====================

let _pluginRulesData = null;

function initPluginRulesTab() {
  renderPluginRules();
}

async function loadPluginRules() {
  try {
    const res = await fetch(`${API_CONFIG_BASE}/plugin-rules`);
    if (!res.ok) return null;
    const data = await res.json();
    _pluginRulesData = data;
    return data;
  } catch (_) {
    return null;
  }
}

async function savePluginRules(rules) {
  const res = await fetch(`${API_CONFIG_BASE}/plugin-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules),
  });
  if (!res.ok) throw new Error('save failed');
  return res.json();
}

// All known action names (for dropdowns)
const KNOWN_ACTIONS = [
  'smile', 'blink', 'kiss', 'nod', 'wave', 'think', 'tease',
  'speak', 'shake_head', 'working', 'clap', 'shy', 'yawn', 'laugh', 'none',
];

// All known tool names (for tool expression mapping)
const KNOWN_TOOLS = [
  'terminal', 'execute_code', 'write_file', 'patch', 'read_file',
  'search_files', 'web_search', 'browser_navigate', 'browser_click',
  'delegate_task', 'send_message', 'vision_analyze',
];

const DEFAULT_TOOL_EXPRESSIONS = {
  terminal: 'working', execute_code: 'working', write_file: 'working',
  patch: 'working', read_file: null, search_files: null,
  web_search: 'working', browser_navigate: 'working', browser_click: 'working',
  delegate_task: 'working', send_message: 'working', vision_analyze: 'working',
};

const DEFAULT_TOOL_COMPLETIONS = {
  delegate_task: 'clap', execute_code: 'nod',
};

const DEFAULT_KEYWORD_MAP = [
  { keywords: ['谢谢', '感谢', 'thank', 'thanks'], action: 'smile' },
  { keywords: ['晚安', 'goodnight', '睡了', '去睡了'], action: 'kiss' },
  { keywords: ['哈哈', '笑死', 'lol', 'haha', '😂', '🤣'], action: 'laugh' },
  { keywords: ['你好', 'hi', 'hello', '早上好', '早安', 'morning'], action: 'wave' },
  { keywords: ['笨', '蠢', '傻', 'stupid'], action: 'tease' },
  { keywords: ['抱歉', '对不起', 'sorry'], action: 'shake_head' },
  { keywords: ['厉害', '棒', 'awesome', 'amazing', 'great'], action: 'clap' },
  { keywords: ['害羞', '脸红', 'shy'], action: 'shy' },
];

const DEFAULT_CONTEXT_THRESHOLDS = {
  warning: { pct: 75, action: 'think' },
  critical: { pct: 90, action: 'shake_head' },
};

function actionSelect(value, id, allowNone = true) {
  const opts = KNOWN_ACTIONS.filter(a => allowNone || a !== 'none').map(a =>
    `<option value="${a}" ${value === a ? 'selected' : ''}>${a}</option>`
  ).join('');
  const noneOpt = allowNone ? `<option value="" ${!value ? 'selected' : ''}>—</option>` : '';
  return `<select class="form-select form-select-sm" id="${id}">${noneOpt}${opts}</select>`;
}

function renderPluginRules() {
  const container = document.getElementById('plugin-rules-content');
  if (!container) return;

  const rules = _pluginRulesData || {};

  // ── Min Interval ──
  const minInterval = rules.min_interval ?? 1.5;

  // ── Tool Expressions ──
  const toolExprs = rules.tool_expressions || {};
  const toolRows = KNOWN_TOOLS.map(tool => {
    const val = toolExprs[tool] ?? (DEFAULT_TOOL_EXPRESSIONS[tool] || '');
    return `
      <div class="pr-row">
        <span class="pr-tool-name">${tool}</span>
        ${actionSelect(val || '', `pr-tool-${tool}`)}
      </div>`;
  }).join('');

  // ── Tool Completions ──
  const toolComps = rules.tool_completions || {};
  const compRows = KNOWN_TOOLS.map(tool => {
    const val = toolComps[tool] || '';
    return `
      <div class="pr-row">
        <span class="pr-tool-name">${tool}</span>
        ${actionSelect(val, `pr-comp-${tool}`)}
      </div>`;
  }).join('');

  // ── Keyword Map ──
  const kwMap = rules.keyword_map || [];
  const kwRows = kwMap.map((entry, i) => {
    const keywords = (entry.keywords || []).join(', ');
    const action = entry.action || '';
    return `
      <div class="pr-kw-row" data-idx="${i}">
        <input type="text" class="form-input form-input-sm pr-kw-input" value="${escHtml(keywords)}" placeholder="关键词，逗号分隔" id="pr-kw-${i}">
        ${actionSelect(action, `pr-kw-action-${i}`, false)}
        <button class="btn-icon btn-icon-sm pr-kw-del" data-idx="${i}" title="Remove">✕</button>
      </div>`;
  }).join('');

  // ── Context Thresholds ──
  const thresholds = rules.context_thresholds || {};
  const warning = thresholds.warning || {};
  const critical = thresholds.critical || {};

  container.innerHTML = `
    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('pluginRules.throttle')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('pluginRules.minInterval')}</div>
            <div class="pref-desc">${I18n.t('pluginRules.minIntervalDesc')}</div>
          </div>
          <div class="pref-control">
            <input type="number" class="form-input form-input-sm" id="pr-min-interval"
                   value="${minInterval}" min="0.5" max="10" step="0.5" style="width:80px;">
            <span class="pref-desc" style="margin-left:6px;">s</span>
          </div>
        </div>
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('pluginRules.toolExpressions')}</h2>
      <div class="pref-desc" style="margin-bottom:10px;">${I18n.t('pluginRules.toolExpressionsDesc')}</div>
      <div class="pref-group pr-tool-grid">
        <div class="pr-grid-header">
          <span>${I18n.t('pluginRules.tool')}</span>
          <span>${I18n.t('pluginRules.expression')}</span>
        </div>
        ${toolRows}
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('pluginRules.toolCompletions')}</h2>
      <div class="pref-desc" style="margin-bottom:10px;">${I18n.t('pluginRules.toolCompletionsDesc')}</div>
      <div class="pref-group pr-tool-grid">
        <div class="pr-grid-header">
          <span>${I18n.t('pluginRules.tool')}</span>
          <span>${I18n.t('pluginRules.expression')}</span>
        </div>
        ${compRows}
      </div>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('pluginRules.keywordMap')}</h2>
      <div class="pref-desc" style="margin-bottom:10px;">${I18n.t('pluginRules.keywordMapDesc')}</div>
      <div class="pref-group pr-kw-list" id="pr-kw-list">
        ${kwRows}
      </div>
      <button class="btn btn-secondary btn-sm" id="pr-add-kw" style="margin-top:8px;">+ ${I18n.t('pluginRules.addRule')}</button>
    </div>

    <div class="pref-section">
      <h2 class="pref-section-title">${I18n.t('pluginRules.contextThresholds')}</h2>
      <div class="pref-group">
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('pluginRules.warningThreshold')}</div>
            <div class="pref-desc">${I18n.t('pluginRules.warningThresholdDesc')}</div>
          </div>
          <div class="pref-control" style="display:flex;align-items:center;gap:8px;">
            <input type="number" class="form-input form-input-sm" id="pr-ctx-warn-pct"
                   value="${warning.pct || 75}" min="50" max="95" step="5" style="width:70px;">
            <span class="pref-desc">%</span>
            ${actionSelect(warning.action || 'think', 'pr-ctx-warn-action', false)}
          </div>
        </div>
        <div class="pref-item">
          <div class="pref-info">
            <div class="pref-label">${I18n.t('pluginRules.criticalThreshold')}</div>
            <div class="pref-desc">${I18n.t('pluginRules.criticalThresholdDesc')}</div>
          </div>
          <div class="pref-control" style="display:flex;align-items:center;gap:8px;">
            <input type="number" class="form-input form-input-sm" id="pr-ctx-crit-pct"
                   value="${critical.pct || 90}" min="60" max="99" step="5" style="width:70px;">
            <span class="pref-desc">%</span>
            ${actionSelect(critical.action || 'shake_head', 'pr-ctx-crit-action', false)}
          </div>
        </div>
      </div>
    </div>

    <div class="pref-section" style="display:flex;gap:10px;align-items:center;">
      <button class="btn btn-primary" id="pr-save">${I18n.t('pluginRules.save')}</button>
      <button class="btn btn-secondary" id="pr-reset">${I18n.t('pluginRules.resetDefaults')}</button>
      <span id="pr-feedback" class="pref-desc" style="min-height:16px;"></span>
    </div>
  `;

  // ── Bind save/reset ──
  document.getElementById('pr-save').addEventListener('click', handleSavePluginRules);
  document.getElementById('pr-reset').addEventListener('click', handleResetPluginRules);
  document.getElementById('pr-add-kw').addEventListener('click', handleAddKeywordRule);

  // Bind keyword delete buttons
  container.querySelectorAll('.pr-kw-del').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteKeywordRule(parseInt(btn.dataset.idx)));
  });
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function collectPluginRules() {
  const rules = {};

  // min_interval
  rules.min_interval = parseFloat(document.getElementById('pr-min-interval').value) || 1.5;

  // tool_expressions
  const toolExprs = {};
  KNOWN_TOOLS.forEach(tool => {
    const sel = document.getElementById(`pr-tool-${tool}`);
    if (sel) toolExprs[tool] = sel.value || null;
  });
  rules.tool_expressions = toolExprs;

  // tool_completions
  const toolComps = {};
  KNOWN_TOOLS.forEach(tool => {
    const sel = document.getElementById(`pr-comp-${tool}`);
    if (sel && sel.value) toolComps[tool] = sel.value;
  });
  rules.tool_completions = toolComps;

  // keyword_map
  const kwList = document.getElementById('pr-kw-list');
  const kwMap = [];
  kwList.querySelectorAll('.pr-kw-row').forEach(row => {
    const input = row.querySelector('.pr-kw-input');
    const actionSel = row.querySelector('select');
    if (input && actionSel) {
      const keywords = input.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const action = actionSel.value;
      if (keywords.length > 0 && action) {
        kwMap.push({ keywords, action });
      }
    }
  });
  rules.keyword_map = kwMap;

  // context_thresholds
  rules.context_thresholds = {
    warning: {
      pct: parseInt(document.getElementById('pr-ctx-warn-pct').value) || 75,
      action: document.getElementById('pr-ctx-warn-action').value || 'think',
    },
    critical: {
      pct: parseInt(document.getElementById('pr-ctx-crit-pct').value) || 90,
      action: document.getElementById('pr-ctx-crit-action').value || 'shake_head',
    },
  };

  return rules;
}

async function handleSavePluginRules() {
  const feedback = document.getElementById('pr-feedback');
  feedback.textContent = I18n.t('pluginRules.saving');
  feedback.style.color = 'var(--text-dim)';

  try {
    const rules = collectPluginRules();
    await savePluginRules(rules);
    _pluginRulesData = rules;
    feedback.textContent = I18n.t('pluginRules.saveSuccess');
    feedback.style.color = 'var(--success)';
  } catch (e) {
    feedback.textContent = I18n.t('pluginRules.saveError', { error: e.message });
    feedback.style.color = 'var(--danger)';
  }

  setTimeout(() => { feedback.textContent = ''; }, 3000);
}

async function handleResetPluginRules() {
  _pluginRulesData = {
    min_interval: 1.5,
    tool_expressions: { ...DEFAULT_TOOL_EXPRESSIONS },
    tool_completions: { ...DEFAULT_TOOL_COMPLETIONS },
    keyword_map: JSON.parse(JSON.stringify(DEFAULT_KEYWORD_MAP)),
    context_thresholds: JSON.parse(JSON.stringify(DEFAULT_CONTEXT_THRESHOLDS)),
  };
  renderPluginRules();
}

function handleAddKeywordRule() {
  const kwList = document.getElementById('pr-kw-list');
  if (!kwList) return;
  const idx = kwList.querySelectorAll('.pr-kw-row').length;
  const row = document.createElement('div');
  row.className = 'pr-kw-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <input type="text" class="form-input form-input-sm pr-kw-input" value="" placeholder="${I18n.t('pluginRules.keywordPlaceholder')}" id="pr-kw-${idx}">
    ${actionSelect('', `pr-kw-action-${idx}`, false)}
    <button class="btn-icon btn-icon-sm pr-kw-del" data-idx="${idx}" title="Remove">✕</button>
  `;
  kwList.appendChild(row);
  row.querySelector('.pr-kw-del').addEventListener('click', () => {
    row.remove();
  });
  row.querySelector('.pr-kw-input').focus();
}

function handleDeleteKeywordRule(idx) {
  const row = document.querySelector(`.pr-kw-row[data-idx="${idx}"]`);
  if (row) row.remove();
}

function updatePluginRulesText() {
  renderPluginRules();
}
