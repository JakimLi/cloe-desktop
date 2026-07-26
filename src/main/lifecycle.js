'use strict';

/**
 * Lifecycle — system tray, application menu, and PATH repair.
 *
 * Extracted from launcher.js. These three routines are self-contained UI
 * helpers whose only external touchpoint is createManagerWindow() (from the
 * windows module), used by the tray and app-menu "Settings…" entries.
 *
 * The app.whenReady bootstrap sequence and app.on(...) event handlers stay in
 * launcher.js for now: they orchestrate startBridge/waitForBridge/createWindow,
 * which still live there (the HTTP route split is a later phase). Moving the
 * bootstrap here would create a circular dependency, so it is deferred until
 * the bridge/window internals are themselves modularised.
 */

const path = require('path');
const { app, Tray, Menu, nativeImage } = require('electron');
const { createManagerWindow } = require('./windows');

function createTray() {
  // Tray icon — dock icon (icon_1024.png) scaled to 70x70 and centred on an
  // 88x88 transparent canvas (≈80% scale with padding). Stored as a PNG asset
  // at build/tray-icon.png so it ships with every build and is easy to swap.
  // Loaded from disk (not inlined) for clarity; keepTemplate=false so the
  // original colours render identically on light and dark menu bars.
  const iconPath = path.join(__dirname, '..', '..', 'build', 'tray-icon.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  trayIcon = trayIcon.resize({ width: 22, height: 22 });

  const tray = new Tray(trayIcon);
  tray.setToolTip('Cloe Desktop');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '设置...',
      click: () => createManagerWindow(),
    },
    { type: 'separator' },
    {
      label: '退出 Cloe',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  return tray;
}

// ==================== Application Menu (macOS menu bar) ====================
function createAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { label: '设置...', accelerator: 'Cmd+,', click: () => createManagerWindow() },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${app.name}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${app.name}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置所有窗口' },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ==================== PATH repair ====================

// Fix PATH for packaged app — macOS GUI apps get a minimal PATH from launchd,
// missing Homebrew, Hermes, and other shell-configured paths.
// Run a login shell to capture the full PATH and merge into process.env.
async function fixPath() {
  const { execSync } = require('child_process');
  try {
    const shellPath = process.env.SHELL || '/bin/zsh';
    const loginPath = execSync(`${shellPath} -l -c 'echo $PATH'`, {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    if (loginPath) {
      const extra = loginPath.split(':').filter(p => !process.env.PATH.includes(p));
      if (extra.length > 0) {
        process.env.PATH = [...extra, process.env.PATH].join(':');
        console.log('[PATH] Enriched with', extra.length, 'entries from login shell');
      }
    }
  } catch (e) {
    console.warn('[PATH] Failed to enrich PATH from login shell:', e.message);
  }
}

module.exports = {
  createTray,
  createAppMenu,
  fixPath,
};
