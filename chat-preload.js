const { contextBridge, ipcRenderer } = require('electron');

// Cache for session ID — may arrive before the React app registers its listener
let _cachedSessionId = null;
let _sessionCb = null;

ipcRenderer.on('chat-window-session', (_e, id) => {
  _cachedSessionId = id;
  if (_sessionCb) _sessionCb(id);
});

contextBridge.exposeInMainWorld('electronAPI', {
  // Hermes API proxy
  hermesCheckHealth: () => ipcRenderer.invoke('hermes-check-health'),
  hermesGetModels: () => ipcRenderer.invoke('hermes-chat-models'),
  hermesSwitchModel: (model) => ipcRenderer.invoke('hermes-switch-model', model),
  hermesSendMessage: (message, sessionId, model, reqId, cloeSessionId) =>
    ipcRenderer.send('hermes-chat-send', { message, sessionId, model, reqId, cloeSessionId }),
  hermesChatStop: (reqId) => ipcRenderer.send('hermes-chat-stop', reqId),

  // Stream events (each carries reqId for precise routing)
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

  // Session ID — set by launcher when creating the window.
  // Uses cached delivery so it works even if the IPC arrives before React mounts.
  onChatWindowSession: (cb) => {
    _sessionCb = cb;
    if (_cachedSessionId) {
      Promise.resolve().then(() => cb(_cachedSessionId));
    }
    return () => { _sessionCb = null; };
  },
  getPendingSessionId: () => Promise.resolve(_cachedSessionId),

  // Window control
  closeWindow: () => ipcRenderer.send('chat-window-close'),
  minimizeWindow: () => ipcRenderer.send('chat-window-minimize'),
  toggleChatWindow: () => ipcRenderer.send('chat-window-toggle'),

  // Config
  getChatNickname: () => ipcRenderer.invoke('get-chat-nickname'),

  // Avatar
  selectChatAvatar: () => ipcRenderer.invoke('chat-select-avatar'),
  saveChatAvatar: (dataUrl) => ipcRenderer.invoke('chat-save-avatar', dataUrl),
  getChatAvatar: () => ipcRenderer.invoke('chat-get-avatar'),
  removeChatAvatar: () => ipcRenderer.invoke('chat-remove-avatar'),

  // Opacity toggle
  setChatOpacity: (opacity) => ipcRenderer.send('chat-set-opacity', opacity),
  getChatOpacity: () => ipcRenderer.invoke('chat-get-opacity'),

  // Fullscreen penetration
  setFullscreenPenetrate: (enabled) => ipcRenderer.send('chat-set-fullscreen-penetrate', enabled),
  getFullscreenPenetrate: () => ipcRenderer.invoke('chat-get-fullscreen-penetrate'),

  // External message injection
  onExternalChatMessage: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('external-chat-message', h);
    return () => ipcRenderer.removeListener('external-chat-message', h);
  },

  // Context usage HUD
  onContextUsage: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('context-usage', h);
    return () => ipcRenderer.removeListener('context-usage', h);
  },
});
