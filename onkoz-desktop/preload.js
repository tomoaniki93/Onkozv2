'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Contrôles fenêtre
  minimize:       () => ipcRenderer.send('title:minimize'),
  maximize:       () => ipcRenderer.send('title:maximize'),
  close:          () => ipcRenderer.send('title:close'),
  reload:         () => ipcRenderer.send('title:reload'),
  devtools:       () => ipcRenderer.send('title:devtools'),
  onWindowState:  (cb) => ipcRenderer.on('window-state', (_e, state) => cb(state)),

  // Mises à jour
  checkUpdates:   () => ipcRenderer.send('title:check-updates'),
  installUpdate:  () => ipcRenderer.send('title:install-update'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, data) => cb(data)),
});
