const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  moveWindow: (dx, dy) => ipcRenderer.send('window-move', { dx, dy }),
  getDataDir: () => ipcRenderer.sendSync('get-data-dir'),
  // PTY (multi-tab: ptyId identifies each session)
  ptySpawn: (ptyId, cols, rows) => ipcRenderer.send('pty-spawn', { ptyId, cols, rows }),
  ptyWrite: (ptyId, data) => ipcRenderer.send('pty-write', { ptyId, data }),
  ptyResize: (ptyId, cols, rows) => ipcRenderer.send('pty-resize', { ptyId, cols, rows }),
  ptyKill: (ptyId) => ipcRenderer.send('pty-kill', { ptyId }),
  onPtyData: (cb) => ipcRenderer.on('pty-data', (_e, { ptyId, data }) => cb(ptyId, data)),
  // Window mode
  setWindowMode: (mode) => ipcRenderer.send('set-window-mode', mode),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  // Settings
  openSettings: () => ipcRenderer.send('open-settings'),
  // Terminal shortcut
  setTerminalShortcut: (accelerator) => ipcRenderer.send('set-terminal-shortcut', accelerator),
  onTerminalToggle: (cb) => ipcRenderer.on('terminal-toggle-shortcut', () => cb()),
  onFullscreenChanged: (cb) => ipcRenderer.on('fullscreen-changed', (_e, isFull) => cb(isFull)),
  // Hermes API (main-process proxy to localhost:8642)
  hermesCheckHealth: () => ipcRenderer.invoke('hermes-check-health'),
  hermesSendMessage: (message, sessionId) => ipcRenderer.send('hermes-chat-send', { message, sessionId }),
  hermesChatStop: () => ipcRenderer.send('hermes-chat-stop'),
  onHermesDelta: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('hermes-stream-delta', h);
    return () => ipcRenderer.removeListener('hermes-stream-delta', h);
  },
  onHermesTool: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('hermes-stream-tool', h);
    return () => ipcRenderer.removeListener('hermes-stream-tool', h);
  },
  onHermesEnd: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('hermes-stream-end', h);
    return () => ipcRenderer.removeListener('hermes-stream-end', h);
  },
  onHermesError: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('hermes-stream-error', h);
    return () => ipcRenderer.removeListener('hermes-stream-error', h);
  },
  // Chat window (separate BrowserWindow)
  toggleChatWindow: () => ipcRenderer.send('chat-window-toggle'),
  onChatWindowState: (cb) => {
    const h = (_e, isOpen) => cb(isOpen);
    ipcRenderer.on('chat-window-state', h);
    return () => ipcRenderer.removeListener('chat-window-state', h);
  },
  // Workspace window (separate BrowserWindow)
  toggleWorkspaceWindow: () => ipcRenderer.send('workspace-window-toggle'),
  onWorkspaceWindowState: (cb) => {
    const h = (_e, isOpen) => cb(isOpen);
    ipcRenderer.on('workspace-window-state', h);
    return () => ipcRenderer.removeListener('workspace-window-state', h);
  },
  // External message injection (from Hermes via /chat/message)
  onExternalChatMessage: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('external-chat-message', h);
    return () => ipcRenderer.removeListener('external-chat-message', h);
  },
  // Character position (Shift+drag offset)
  getCharacterPosition: () => ipcRenderer.sendSync('get-character-position'),
  saveCharacterPosition: (pos) => ipcRenderer.send('save-character-position', pos),
  // Character size (scale)
  getCharacterSize: () => ipcRenderer.sendSync('get-character-size'),
  saveCharacterSize: (size) => ipcRenderer.send('save-character-size', size),
  // Real-time updates from chat window
  onCharacterPositionUpdated: (cb) => {
    const h = (_e, pos) => cb(pos);
    ipcRenderer.on('character-position-updated', h);
    return () => ipcRenderer.removeListener('character-position-updated', h);
  },
  onCharacterSizeUpdated: (cb) => {
    const h = (_e, size) => cb(size);
    ipcRenderer.on('character-size-updated', h);
    return () => ipcRenderer.removeListener('character-size-updated', h);
  },
  // Chat session management
  createChatSession: () => ipcRenderer.invoke('create-chat-session'),
  quickChatSession: () => ipcRenderer.invoke('quick-chat-session'),
  openChatSession: (sessionId) => ipcRenderer.invoke('open-chat-session', sessionId),
  deleteChatSession: (sessionId) => ipcRenderer.invoke('delete-chat-session', sessionId),
});
