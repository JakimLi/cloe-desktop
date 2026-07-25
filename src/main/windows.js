'use strict';

/**
 * Windows — secondary BrowserWindow management (manager / chat / workspace),
 * chat avatar, and chat fullscreen pin.
 *
 * Extracted verbatim from launcher.js. The main floating window itself stays
 * in launcher.js (it owns the createWindow entry point + scale config); this
 * module owns the auxiliary windows and their IPC handlers.
 *
 * State: managerWin / workspaceWin are held privately here AND mirrored into
 * window-registry so other modules (and future route modules) can reach them
 * without launcher.js wiring. chatFullscreenPenetrate is private to this
 * module. Chat windows are looked up dynamically by URL (no global).
 *
 * Cross-module touchpoints (the two functions other launcher.js regions call):
 *   - createManagerWindow(): used by the tray/app menu (lifecycle region)
 *   - toggleChatWindow(): used by the HTTP /chat-toggle route
 * Both are exported.
 *
 * Path note: preload scripts and the packaged HTML live at the project root
 * (preload.js, dist/...); re-rooted via PROJECT_ROOT since this file is in
 * src/main/.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, screen, dialog, nativeImage } = require('electron');

const { PROJECT_ROOT, loadConfig } = require('./config');
const windowRegistry = require('./window-registry');
const cloeSessions = require('../cloe-sessions');

// ==================== Manager Window ====================
function createManagerWindow() {
  const existing = windowRegistry.getManagerWindow();
  if (existing) {
    existing.show();
    existing.focus();
    return;
  }

  const managerWin = new BrowserWindow({
    width: 880,
    height: 620,
    title: 'Cloe',
    transparent: false,
    frame: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    alwaysOnTop: false,
    resizable: true,
    skipTaskbar: false,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(PROJECT_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  managerWin.setMenuBarVisibility(false);

  if (!app.isPackaged) {
    // Dev mode: serve manager via Vite dev server for best compatibility
    managerWin.loadURL('http://localhost:5173/manager/index.html');
  } else {
    managerWin.loadFile(path.join(PROJECT_ROOT, 'dist', 'manager', 'index.html'));
  }

  managerWin.on('closed', () => {
    windowRegistry.setManagerWindow(null);
  });
  windowRegistry.setManagerWindow(managerWin);
}

ipcMain.on('open-settings', () => {
  createManagerWindow();
});

// ==================== Chat Window (standalone BrowserWindow) ====================
// All chat windows now go through createChatWindowForSession() which ensures
// each window is bound to a cloe-desktop session ID.

function createChatWindow() {
  // Legacy entry point — create a new session and open a window for it
  const session = cloeSessions.createSession({ title: 'New chat' });
  return createChatWindowForSession(session.id);
}

function openLatestUnsentOrCreateChatSession() {
  const existing = cloeSessions.findLatestUnsentSession();
  if (existing) {
    createChatWindowForSession(existing.id);
    return { sessionId: existing.id, reused: true };
  }
  const session = cloeSessions.createSession({ title: 'New chat' });
  createChatWindowForSession(session.id);
  return { sessionId: session.id, reused: false };
}

function notifyChatWindowState(visible) {
  const win = windowRegistry.getMainWindow();
  try { win?.webContents.send('chat-window-state', visible); } catch {}
}

function toggleChatWindow() {
  // Find the most recently used chat window and toggle it.
  // If none exists, create a new session + window.
  const chatWindows = BrowserWindow.getAllWindows().filter(w =>
    !w.isDestroyed() && w.webContents?.getURL()?.includes('/chat.html')
  );
  if (chatWindows.length > 0) {
    const target = chatWindows[chatWindows.length - 1];
    if (target.isVisible()) {
      target.hide();
      notifyChatWindowState(false);
    } else {
      target.show();
      target.focus();
      notifyChatWindowState(true);
    }
  } else {
    createChatWindow();
    notifyChatWindowState(true);
  }
}

ipcMain.on('chat-window-close', (event) => {
  // Hide the specific window that sent this
  const senderWin = BrowserWindow.fromId(event.sender.id);
  if (senderWin && !senderWin.isDestroyed()) {
    senderWin.hide();
  }
  notifyChatWindowState(false);
});
ipcMain.on('chat-window-toggle', () => toggleChatWindow());
ipcMain.on('chat-window-minimize', (event) => {
  const senderWin = BrowserWindow.fromId(event.sender.id);
  if (senderWin && !senderWin.isDestroyed()) {
    senderWin.minimize();
  }
});

// Legacy: open-new-chat-window is now handled by create-chat-session IPC.
// The old handler is removed to prevent duplicate session creation.

// ==================== Chat Window — Session Management ====================

/**
 * Create a new internal chat session and open it in a chat window.
 * IPC: 'create-chat-session' → returns { sessionId }
 */
ipcMain.handle('create-chat-session', async () => {
  const session = cloeSessions.createSession({ title: 'New chat' });
  createChatWindowForSession(session.id);
  return { sessionId: session.id };
});

/**
 * Open the latest unsent internal chat session, or create one if none exists.
 * IPC: 'quick-chat-session' → returns { sessionId, reused }
 */
ipcMain.handle('quick-chat-session', async () => {
  return openLatestUnsentOrCreateChatSession();
});

/**
 * Open an existing internal chat session in a chat window.
 * If the session already has an open window, focus it instead.
 * IPC: 'open-chat-session' (sessionId) → returns { ok: true }
 */
ipcMain.handle('open-chat-session', async (_event, sessionId) => {
  const session = cloeSessions.getSession(sessionId);
  if (!session) return { ok: false, error: 'session not found' };
  createChatWindowForSession(sessionId);
  return { ok: true };
});

/**
 * Delete an internal chat session (persisted storage).
 * IPC: 'delete-chat-session' (sessionId) → returns { ok: true }
 */
ipcMain.handle('delete-chat-session', async (_event, sessionId) => {
  // Close any chat window displaying this session
  const allWins = BrowserWindow.getAllWindows().filter(w =>
    !w.isDestroyed() && w.webContents?.getURL()?.includes('/chat.html')
  );
  for (const w of allWins) {
    if (w._cloeSessionId === sessionId) {
      try { w.close(); } catch {}
    }
  }
  cloeSessions.deleteSession(sessionId);
  return { ok: true };
});

/**
 * Create (or reuse) a chat window for a specific session ID.
 * Each window tracks which session it belongs to via _cloeSessionId.
 */
function createChatWindowForSession(sessionId) {
  // Check if a window for this session already exists
  const existing = BrowserWindow.getAllWindows().find(w =>
    !w.isDestroyed() &&
    w.webContents?.getURL()?.includes('/chat.html') &&
    w._cloeSessionId === sessionId
  );
  if (existing) {
    existing.show();
    existing.focus();
    return existing;
  }

  // Calculate offset from existing chat windows.
  // When the main window is in macOS fullscreen, its bounds span the whole
  // screen, so positioning the chat relative to mainBounds would place it
  // off-screen (and macOS may then enlarge it). In that case, anchor the
  // chat window to the visible screen area instead.
  let originX, originY;
  const mainWin = windowRegistry.getMainWindow();
  const mainIsFullscreen = mainWin && mainWin.isFullScreen();
  if (mainIsFullscreen) {
    const screenArea = screen.getPrimaryDisplay().workArea;
    originX = screenArea.x + 40;
    originY = screenArea.y + 40;
  } else {
    const mainBounds = mainWin?.getBounds() || { x: 100, y: 100, width: 600, height: 500 };
    originX = mainBounds.x + mainBounds.width + 16;
    originY = mainBounds.y;
  }
  const existingWindows = BrowserWindow.getAllWindows().filter(w =>
    !w.isDestroyed() && w.webContents?.getURL()?.includes('/chat.html')
  );
  const offset = existingWindows.length * 30;

  const chatWindow = new BrowserWindow({
    width: 400,
    height: 520,
    x: originX + offset,
    y: originY + offset,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    fullscreenable: false,
    minWidth: 300,
    minHeight: 250,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(PROJECT_ROOT, 'chat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  chatWindow._cloeSessionId = sessionId;

  if (!app.isPackaged) {
    chatWindow.loadURL('http://localhost:5173/src/chat.html');
  } else {
    chatWindow.loadFile(path.join(PROJECT_ROOT, 'dist', 'src', 'chat.html'));
  }

  // Disable spellcheck so macOS doesn't draw red squiggles under the model
  // name shown in the <select>, or under typed text.
  try {
    chatWindow.webContents.session.setSpellCheckerEnabled(false);
    chatWindow.webContents.on('did-attach-webview', () => {
      chatWindow.webContents.session.setSpellCheckerEnabled(false);
    });
  } catch (e) {
    console.error('[chat] disable spellcheck failed:', e.message);
  }

  // Send the session ID to the window — use 'did-finish-load' as primary
  // and a small delay fallback in case the React app isn't ready yet
  chatWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      try { chatWindow.webContents.send('chat-window-session', sessionId); } catch {}
    }, 100);
  });

  chatWindow.once('ready-to-show', () => chatWindow.show());
  return chatWindow;
}

// ==================== Workspace Window (standalone BrowserWindow) ====================
function createWorkspaceWindow() {
  const existing = windowRegistry.getWorkspaceWindow();
  // If window exists, toggle visibility
  if (existing) {
    if (existing.isVisible()) {
      existing.hide();
    } else {
      existing.show();
      existing.focus();
    }
    notifyWorkspaceState(existing.isVisible());
    return;
  }

  const display = screen.getPrimaryDisplay();
  const winWidth = 680;
  const winHeight = 520;
  // Center on screen: window center = screen center
  const centerX = Math.round(display.bounds.x + (display.bounds.width - winWidth) / 2);
  const centerY = Math.round(display.bounds.y + (display.bounds.height - winHeight) / 2);

  const workspaceWin = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: centerX,
    y: centerY,
    transparent: true,
    frame: false,
    alwaysOnTop: false,
    resizable: true,
    minWidth: 400,
    minHeight: 300,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(PROJECT_ROOT, 'workspace-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  workspaceWin.setMenuBarVisibility(false);

  if (!app.isPackaged) {
    workspaceWin.loadURL('http://localhost:5173/src/workspace.html');
  } else {
    workspaceWin.loadFile(path.join(PROJECT_ROOT, 'dist', 'src', 'workspace.html'));
  }

  workspaceWin.once('ready-to-show', () => { workspaceWin.show(); });

  workspaceWin.on('closed', () => {
    windowRegistry.setWorkspaceWindow(null);
    notifyWorkspaceState(false);
  });
  windowRegistry.setWorkspaceWindow(workspaceWin);

  notifyWorkspaceState(true);
}

function notifyWorkspaceState(visible) {
  const win = windowRegistry.getMainWindow();
  try { win?.webContents.send('workspace-window-state', visible); } catch {}
}

ipcMain.on('workspace-window-toggle', () => createWorkspaceWindow());
ipcMain.on('workspace-window-close', () => {
  const ws = windowRegistry.getWorkspaceWindow();
  if (ws) {
    ws.hide();
    notifyWorkspaceState(false);
  }
});
ipcMain.on('workspace-window-move', (_e, payload) => {
  const ws = windowRegistry.getWorkspaceWindow();
  if (ws && payload) {
    const dx = Math.round(payload.dx || 0);
    const dy = Math.round(payload.dy || 0);
    const [x, y] = ws.getPosition();
    ws.setPosition(x + dx, y + dy);
  }
});

ipcMain.handle('get-chat-nickname', () => loadConfig().chatNickname || '');

// Chat window opacity toggle (transparent / opaque)
ipcMain.on('chat-set-opacity', (event, opacity) => {
  try { event.sender.setOpacity(opacity); } catch {}
});

// ==================== Chat Avatar ====================

function getChatAvatarPath() {
  return path.join(os.homedir(), '.cloe', 'chat-avatar.png');
}

ipcMain.handle('chat-select-avatar', async (event) => {
  // Attach the dialog to the chat window that asked for it (not the main
  // window) so the picker appears over the correct window in multi-session.
  const mainWin = windowRegistry.getMainWindow();
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWin;
  const result = await dialog.showOpenDialog(parent, {
    title: 'Select AI Avatar',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  const srcPath = result.filePaths[0];
  try {
    // Read the original image and return as base64 data URL (no resize — let the frontend crop)
    const nativeImg = nativeImage.createFromPath(srcPath);
    if (nativeImg.isEmpty()) return null;
    const pngBuf = nativeImg.toPNG();
    const base64 = pngBuf.toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (err) {
    console.error('[Chat] Error reading avatar image:', err);
    return null;
  }
});

ipcMain.handle('chat-save-avatar', (_event, dataUrl) => {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return false;
    // Extract base64 payload
    const base64 = dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    // Ensure ~/.cloe directory exists
    const cloeDir = path.join(os.homedir(), '.cloe');
    if (!fs.existsSync(cloeDir)) {
      fs.mkdirSync(cloeDir, { recursive: true });
    }
    const avatarPath = getChatAvatarPath();
    fs.writeFileSync(avatarPath, buf);
    return true;
  } catch (err) {
    console.error('[Chat] Error saving cropped avatar:', err);
    return false;
  }
});

ipcMain.handle('chat-get-avatar', () => {
  const avatarPath = getChatAvatarPath();
  try {
    if (fs.existsSync(avatarPath)) {
      const buf = fs.readFileSync(avatarPath);
      return `data:image/png;base64,${buf.toString('base64')}`;
    }
  } catch {}
  return null;
});

ipcMain.handle('chat-remove-avatar', () => {
  const avatarPath = getChatAvatarPath();
  try {
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }
    return true;
  } catch {
    return false;
  }
});

// ==================== Chat Fullscreen Pin (show on fullscreen Space) ====================

/**
 * Whether the user has pinned the chat window to appear over fullscreen.
 * Persisted in localStorage (on the chat renderer side) and synced via IPC.
 */
let chatFullscreenPenetrate = false;

ipcMain.on('chat-set-fullscreen-penetrate', (event, enabled) => {
  chatFullscreenPenetrate = !!enabled;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  if (chatFullscreenPenetrate) {
    // Allow chat to appear on fullscreen Spaces — the user can manually
    // drag it there, or it will be visible when the main window goes fullscreen.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'floating');
    console.log('[Chat] Pin enabled — visible on all workspaces');
  } else {
    win.setVisibleOnAllWorkspaces(false);
    win.setAlwaysOnTop(true, 'normal');
    console.log('[Chat] Pin disabled');
  }
});

ipcMain.handle('chat-get-fullscreen-penetrate', () => chatFullscreenPenetrate);

module.exports = {
  createManagerWindow,
  toggleChatWindow,
  createWorkspaceWindow,
};
