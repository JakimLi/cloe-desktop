// ==================== Cloe Settings — Main Entry ====================

// ==================== Tab Navigation ====================
let currentTab = 'actions';

function initTabs() {
  const sidebarItems = document.querySelectorAll('.sidebar-item');
  sidebarItems.forEach((item) => {
    item.addEventListener('click', () => {
      switchTab(item.dataset.tab);
    });
  });
}

function switchTab(tabId) {
  currentTab = tabId;

  // Update sidebar active state
  document.querySelectorAll('.sidebar-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });

  // Update content panels
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });
}

// ==================== i18n Update ====================
function updateAllText() {
  document.title = I18n.t('windowTitle');

  const sidebarTitle = document.querySelector('.sidebar-title');
  if (sidebarTitle) sidebarTitle.textContent = I18n.t('sidebar.title');

  // Sidebar items
  document.getElementById('sidebar-actions').querySelector('.sidebar-item-label').textContent = I18n.t('tabs.actions');
  document.getElementById('sidebar-preferences').querySelector('.sidebar-item-label').textContent = I18n.t('tabs.preferences');
  document.getElementById('sidebar-plugin-rules').querySelector('.sidebar-item-label').textContent = I18n.t('tabs.pluginRules');

  // Update actions tab text
  const actionsTitle = document.getElementById('actions-title');
  if (actionsTitle) actionsTitle.textContent = I18n.t('title');
  updateActionsText();

  // Update preferences tab text
  updatePreferencesText();

  // Update plugin rules tab text
  updatePluginRulesText();
}

// Locale change callback (called from preferences.js)
window.onLocaleChange = function () {
  updateAllText();
};

// ==================== Bootstrap ====================
(async () => {
  await I18n.init();

  initTabs();
  initPreviewModal();
  initReferenceModal();
  initActionsTab();
  initPreferencesTab();
  await loadPluginRules();
  initPluginRulesTab();
  updateAllText();
})();
