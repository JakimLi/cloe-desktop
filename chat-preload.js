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

  // ── Native Agent API (mirrors Hermes interface) ──
  nativeCheckHealth: () => ipcRenderer.invoke('native-check-health'),
  nativeGetModels: () => ipcRenderer.invoke('native-get-models'),
  nativeSwitchModel: (model) => ipcRenderer.invoke('native-switch-model', model),
  nativeSendMessage: (message, reqId, cloeSessionId) =>
    ipcRenderer.send('native-chat-send', { message, reqId, cloeSessionId }),
  nativeChatStop: (reqId) => ipcRenderer.send('native-chat-stop', reqId),
  nativeResetSession: (cloeSessionId) => ipcRenderer.invoke('native-reset-session', cloeSessionId),
  nativeReloadHistory: (cloeSessionId) => ipcRenderer.invoke('native-reload-history', cloeSessionId),
  nativeGetThinkingLevel: () => ipcRenderer.invoke('native-get-thinking-level'),
  nativeSetThinkingLevel: (level) => ipcRenderer.invoke('native-set-thinking-level', level),
  nativeGetConfig: () => ipcRenderer.invoke('native-get-config'),
  nativeSaveConfig: (cfg) => ipcRenderer.invoke('native-save-config', cfg),
  nativeCronList: () => ipcRenderer.invoke('native-cron-list'),
  nativeCronCreate: (data) => ipcRenderer.invoke('native-cron-create', data),
  nativeCronUpdate: (id, changes) => ipcRenderer.invoke('native-cron-update', id, changes),
  nativeCronRemove: (id) => ipcRenderer.invoke('native-cron-remove', id),

  // Native agent stream events (each carries reqId)
  onNativeDelta: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('native-stream-delta', h);
    return () => ipcRenderer.removeListener('native-stream-delta', h);
  },
  onNativeTool: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('native-stream-tool', h);
    return () => ipcRenderer.removeListener('native-stream-tool', h);
  },
  onNativeEnd: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('native-stream-end', h);
    return () => ipcRenderer.removeListener('native-stream-end', h);
  },
  onNativeError: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('native-stream-error', h);
    return () => ipcRenderer.removeListener('native-stream-error', h);
  },
  onNativeRetry: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('native-stream-retry', h);
    return () => ipcRenderer.removeListener('native-stream-retry', h);
  },

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
  quickChatSession: () => ipcRenderer.invoke('quick-chat-session'),

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
