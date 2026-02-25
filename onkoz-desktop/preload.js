'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Exposer uniquement les fonctions nécessaires à la titlebar
contextBridge.exposeInMainWorld('electronAPI', {
  minimize:  () => ipcRenderer.send('title:minimize'),
  maximize:  () => ipcRenderer.send('title:maximize'),
  close:     () => ipcRenderer.send('title:close'),
  reload:    () => ipcRenderer.send('title:reload'),
  devtools:  () => ipcRenderer.send('title:devtools'),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_e, state) => cb(state)),
});
