const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  moveWindow: (dx, dy) => ipcRenderer.send('window-move', { dx, dy }),
  getDataDir: () => ipcRenderer.sendSync('get-data-dir'),
  // PTY
  ptySpawn: (cols, rows) => ipcRenderer.send('pty-spawn', { cols, rows }),
  ptyWrite: (data) => ipcRenderer.send('pty-write', data),
  ptyResize: (cols, rows) => ipcRenderer.send('pty-resize', { cols, rows }),
  onPtyData: (cb) => ipcRenderer.on('pty-data', (_e, data) => cb(data)),
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
  // External message injection (from Hermes via /chat/message)
  onExternalChatMessage: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('external-chat-message', h);
    return () => ipcRenderer.removeListener('external-chat-message', h);
  },
  // Character position (Shift+drag offset)
  getCharacterPosition: () => ipcRenderer.sendSync('get-character-position'),
  saveCharacterPosition: (pos) => ipcRenderer.send('save-character-position', pos),
});
