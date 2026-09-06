'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = Object.freeze({
  getState: () => ipcRenderer.invoke('state:get'),
  getSetup: () => ipcRenderer.invoke('setup:get'),
  chooseDotaDirectory: () => ipcRenderer.invoke('setup:choose-directory'),
  selectDotaDirectory: (dotaRoot) => ipcRenderer.invoke('setup:select', dotaRoot),
  installConfig: () => ipcRenderer.invoke('setup:install'),
  removeConfig: () => ipcRenderer.invoke('setup:remove'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:always-on-top', Boolean(enabled)),
  setCompact: (enabled) => ipcRenderer.invoke('window:compact', Boolean(enabled)),
  loadDemo: () => ipcRenderer.invoke('demo:load'),
  onStateUpdate: (callback) => {
    const listener = (_event, viewModel) => callback(viewModel);
    ipcRenderer.on('gsi:update', listener);
    return () => ipcRenderer.removeListener('gsi:update', listener);
  }
});

contextBridge.exposeInMainWorld('dotaHelper', api);
