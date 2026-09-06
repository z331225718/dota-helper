'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dotaOverlay', Object.freeze({
  getState: () => ipcRenderer.invoke('state:get'),
  hide: () => ipcRenderer.invoke('overlay:hide'),
  setLocked: (enabled) => ipcRenderer.invoke('overlay:set-locked', Boolean(enabled)),
  onLockedChange: (callback) => {
    const listener = (_event, locked) => callback(Boolean(locked));
    ipcRenderer.on('overlay:locked', listener);
    return () => ipcRenderer.removeListener('overlay:locked', listener);
  },
  onStateUpdate: (callback) => {
    const listener = (_event, viewModel) => callback(viewModel);
    ipcRenderer.on('gsi:update', listener);
    return () => ipcRenderer.removeListener('gsi:update', listener);
  }
}));
