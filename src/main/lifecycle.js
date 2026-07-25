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

const { app, Tray, Menu, nativeImage } = require('electron');
const { createManagerWindow } = require('./windows');

function createTray() {
  // Template-style tray icon (B&W cartoon face — black on transparent, auto-adapts to dark/light menu bar)
  const TRAY_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAFY0lEQVR4nL2Z22tcVRjFf5mZtJl2nNqkMWmi8RJHK7XUS8XiXaGKIl4QBRERESo++KD/go/iow+Cvgjio3cfFLVStN6q1Zgm1TYxUdPaapPWNDOJnVQ+WBs2x3PO7DOTcUHInMvsvfa313fb00FjDAK/e9ebgHXAn8AqYB7oBI4BXbq3CJwB6kAFWAb2emNsBA7TBHINng97ZC8FbgL+AUaB9SJUBI7q2v6WdN8WsRY4CJwC7gfWaKzDepYZHSnPtgAj+vwocAL4UWQKQLesa2TPBkrAjCy7rLELsviS7m0HpoHvNa49P70ShDfLiobHgK+ASVmlLrK9stRqXRuJWspc3SJ+ud7bp/v9wJFWCTs8DnwgGazX/wVJaUBW7wH2A1WN1yU52LsnY8a051cB48Bx3bOxZ5slvEmDbZfmfpETLYpUjyTQJ2sf1CLOAvKeJOyZ+14txvrXAZ/r80XARLOEHXYC7wF/eZNdCVwi670lWVymd2yssrRc1/UZOZzpfE6RxMGkNAT8rGu3K6kw0ftweroP+MGLEBbGtmrrfgM+0/0jEf3lNOYGLWZJkaZHhFfr+8jyed1b1Ni2sEwwfRmejiziHmAHcAXNYQtwPXC3rOrD7qPwmDkO29bfDLztLeBa4G9Z23l2Vowoitg4F0Z21uSD/KOQlfBaOdOUrm+Vp9cUCVrBvLJdl0jjETU/QPrPRLjHC0WDcgKLFHtaJOuT3q9I5DLdT4oSvrWDCVe0YhRnOzXgSuJXGcV0jearyjC1LISN3DZgTNer5MUu7KwkPpX0nJWryq5dWQiXFFpyGshS6Se0D1Mi6SLEQFan65ZF+/XleQX9dmGfrDyoUvUczR9MeKP01SvS7ZBCFCaF81Sx1bxo0ZCwrexLZbQOOYDLSCuBiuYwP/FxXKk+F1pmFrxw0qVB8wk1xpDemY3UBEmwzNin3ZrSDnaI2LR281slpnWK+TtDCeek10kVMC60GR7RhBOy0A5t45iXEePIWvW2W8SsekvCBo33iqrAuRDCbsCqJnKETRqvee/PqLAvy1mSOoaRDEX5SZWwRUWqIMIOo9rGi3W9kDLJKUkkjrBVaYYhFTwD2kXrXN6MvHtIRdXukLBWiLmua5t8WPP5oKy6oC7kVY8YMc5kunxJ1diHwMvAjcpwz3nv9mk3XGObKTXnpTlzEIe7gGeBF4A/ZA0rNx/wao04nAs8Cbwu37CF7oqQdXI8rV2dzWrhOa226BXW7+u+BfavpWNrbT5qIBvXxBppJJ+4WmFZSauidisTYVexjSs+ujbf9V6mwWZRS7hvOn83JGnESWJCOppWO/5/YEwVYUuZ9RbgRdqPsv42S4JNH1Xt8s4M2okL1JKNhoS0NMIlOZzrBNqFbcA7+uxHpsyEa0oOFnvbiT3e56SYngnP0D4UY2J4o6OzRBS8wSytNsINymK2xbcHzlHxPluMDzn+TYUjGj34SEIuJevFwdJ8HFwd0xKCHCIG5QTHtQY3CaknQI1CiTvJTNLW1aonSip2jqpgLyoBfQN8F/O97pTys5p2mtlIM+PS14zX4frYKyv2e+3OpAp+KyPjyN4ZUCvbmLEI8cqSOmjf4lFY0X+NslVe6dbq3Cge0o68ETBvn6rDpuDvhB10J6E3RZ/DwPMZfowZbkQkDdGe7KmE944lJIBhNQETGc46DoUStvIyDV/IwR4OnPh84A7p3ZqDLCiHEE7rcB1OKCI8oU43CVuB24ADOtE3582CekhYC/k1Z413snmvFnBAhDoVLUwGFqKstnbdScOeLYL/yCeopIuBtUX2Z22PFd4mEXNGczj3Q4ydHFkU+tj7XtO1gsO/iZc4ciQ7vnwAAAAASUVORK5CYII=';
  let trayIcon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_B64, 'base64'));
  trayIcon.setTemplateImage(true);
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
