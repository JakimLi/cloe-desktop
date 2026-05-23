const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Hermes API proxy
  hermesCheckHealth: () => ipcRenderer.invoke('hermes-check-health'),
  hermesSendMessage: (message, sessionId) => ipcRenderer.send('hermes-chat-send', { message, sessionId }),
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
  // Window control
  closeWindow: () => ipcRenderer.send('chat-window-close'),
  minimizeWindow: () => ipcRenderer.send('chat-window-minimize'),
  // Config
  getChatNickname: () => ipcRenderer.invoke('get-chat-nickname'),
  // External message injection (from Hermes via /chat/message)
  onExternalChatMessage: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('external-chat-message', h);
    return () => ipcRenderer.removeListener('external-chat-message', h);
  },
});
