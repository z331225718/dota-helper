'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const { GsiServer } = require('./gsi-server');
const {
  discoverDotaInstallations,
  resolveDotaRootFromSelection,
  getConfigStatus,
  installConfig,
  removeConfig
} = require('./gsi-config');
const { SettingsStore } = require('./settings-store');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let gsiServer = null;
let settingsStore = null;
let selectedDotaRoot = null;

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Untrusted IPC sender');
  }
}

function setupSummary() {
  const installations = discoverDotaInstallations();
  if (!selectedDotaRoot && installations.length === 1) selectedDotaRoot = installations[0];

  return {
    installations: installations.map((dotaRoot) => ({ dotaRoot, ...getConfigStatus(dotaRoot) })),
    selectedDotaRoot,
    selectedStatus: selectedDotaRoot ? getConfigStatus(selectedDotaRoot) : null
  };
}

function registerIpcHandlers() {
  const handle = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event);
      return handler(...args);
    });
  };

  handle('state:get', () => gsiServer.getViewModel());
  handle('setup:get', () => setupSummary());

  handle('setup:choose-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Dota 2 或 Steam 库目录',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return setupSummary();

    const resolved = resolveDotaRootFromSelection(result.filePaths[0]);
    if (!resolved) throw new Error('没有在所选目录下找到 Dota 2 的 game/dota/cfg 目录');
    selectedDotaRoot = resolved;
    return setupSummary();
  });

  handle('setup:select', (dotaRoot) => {
    const resolved = resolveDotaRootFromSelection(dotaRoot);
    if (!resolved) throw new Error('Dota 2 目录无效');
    selectedDotaRoot = resolved;
    return setupSummary();
  });

  handle('setup:install', () => {
    if (!selectedDotaRoot) throw new Error('请先选择 Dota 2 目录');
    installConfig(selectedDotaRoot, settingsStore.getOrCreateToken(), gsiServer.getStatus().port);
    return setupSummary();
  });

  handle('setup:remove', () => {
    if (!selectedDotaRoot) throw new Error('请先选择 Dota 2 目录');
    removeConfig(selectedDotaRoot);
    return setupSummary();
  });

  handle('window:always-on-top', (enabled) => {
    mainWindow.setAlwaysOnTop(Boolean(enabled), 'floating');
    return mainWindow.isAlwaysOnTop();
  });

  handle('window:compact', (enabled) => {
    if (enabled) {
      mainWindow.setMinimumSize(420, 560);
      mainWindow.setSize(440, 720, true);
    } else {
      mainWindow.setMinimumSize(920, 680);
      mainWindow.setSize(1180, 780, true);
    }
    return Boolean(enabled);
  });

  handle('demo:load', () => {
    const fixturePath = path.join(app.getAppPath(), 'fixtures', 'live-match.json');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    return gsiServer.acceptTrustedPayload(fixture);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 920,
    minHeight: 680,
    backgroundColor: '#0d1110',
    autoHideMenuBar: true,
    show: false,
    title: 'Personal Dota Helper',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

async function start() {
  settingsStore = new SettingsStore(app.getPath('userData'));
  gsiServer = new GsiServer({ token: settingsStore.getOrCreateToken(), port: 4000 });

  try {
    await gsiServer.start();
  } catch (error) {
    gsiServer.error = error.code === 'EADDRINUSE'
      ? '端口 4000 已被占用'
      : error.message;
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
  registerIpcHandlers();
  gsiServer.on('update', (viewModel) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('gsi:update', viewModel);
  });
}

if (hasSingleInstanceLock) {
  app.whenReady().then(start);
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('before-quit', () => {
    gsiServer?.stop();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
