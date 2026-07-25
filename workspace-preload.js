const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window control
  closeWindow: () => ipcRenderer.send('workspace-window-close'),
  moveWindow: (dx, dy) => ipcRenderer.send('workspace-window-move', { dx, dy }),
  // Chat session management
  createChatSession: () => ipcRenderer.invoke('create-chat-session'),
  openChatSession: (sessionId) => ipcRenderer.invoke('open-chat-session', sessionId),
  deleteChatSession: (sessionId) => ipcRenderer.invoke('delete-chat-session', sessionId),
});
