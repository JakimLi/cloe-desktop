'use strict';

/**
 * Window Registry — single source of truth for top-level BrowserWindow handles.
 *
 * Why this exists: launcher.js used to hold `win`/`managerWin`/`workspaceWin`
 * as module-level globals that ~25 call sites read directly. Any module split
 * off from launcher.js would otherwise have to receive these handles via
 * parameters, leaking the main-process wiring everywhere. Instead, the main
 * window is assigned here once at creation time and every other module reads
 * it through `getMainWindow()`.
 *
 * All accessors are intentionally defensive (return null when unset or
 * destroyed) so callers can keep using the existing `if (win) { ... }`
 * short-circuit pattern unchanged.
 */

let mainWindow = null;
let managerWindow = null;
let workspaceWindow = null;

function isAlive(win) {
  return !!win && !win.isDestroyed();
}

/** Main floating companion window. */
function getMainWindow() {
  return isAlive(mainWindow) ? mainWindow : null;
}

function setMainWindow(win) {
  mainWindow = win || null;
}

/** Settings window (may be null when closed). */
function getManagerWindow() {
  return isAlive(managerWindow) ? managerWindow : null;
}

function setManagerWindow(win) {
  managerWindow = win || null;
}

/** Workspace window (may be null when closed). */
function getWorkspaceWindow() {
  return isAlive(workspaceWindow) ? workspaceWindow : null;
}

function setWorkspaceWindow(win) {
  workspaceWindow = win || null;
}

module.exports = {
  getMainWindow,
  setMainWindow,
  getManagerWindow,
  setManagerWindow,
  getWorkspaceWindow,
  setWorkspaceWindow,
};
