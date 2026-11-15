// Small, explicit bridge from the web app to the desktop shell.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notabeneDesktop', {
  platform: process.platform,
  backup: {
    write: (name, data) => ipcRenderer.invoke('backup:write', name, data),
    list: () => ipcRenderer.invoke('backup:list'),
    read: (name) => ipcRenderer.invoke('backup:read', name),
    remove: (name) => ipcRenderer.invoke('backup:remove', name),
    openFolder: () => ipcRenderer.invoke('backup:folder'),
  },
  focus: () => ipcRenderer.send('window:focus'),
  takeAction: () => ipcRenderer.invoke('action:take'),
  onAction: (cb) => ipcRenderer.on('nb-action', (_e, a) => cb(a)),
});
