'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, session } = require('electron');
const { GsiServer } = require('./gsi-server');
const {
  discoverDotaInstallations,
  resolveDotaRootFromSelection,
  getConfigStatus,
  installConfig,
  removeConfig
} = require('./gsi-config');
const { SettingsStore } = require('./settings-store');
const { AdviceService } = require('./advice-service');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let overlayWindow = null;
let gsiServer = null;
let settingsStore = null;
let adviceService = null;
let selectedDotaRoot = null;
let isQuitting = false;
let overlayLocked = false;
let overlayBoundsTimer = null;

function assertTrustedSender(event, windows) {
  if (!windows.some((window) => window && !window.isDestroyed() && event.sender === window.webContents)) {
    throw new Error('Untrusted IPC sender');
  }
}

function displayViewModel(viewModel = gsiServer.getViewModel()) {
  return adviceService.decorate(viewModel);
}

function sendViewModel(viewModel) {
  const decorated = displayViewModel(viewModel);
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('gsi:update', decorated);
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
  const handle = (channel, windows, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event, windows());
      return handler(...args);
    });
  };

  const mainOnly = () => [mainWindow];
  const appWindows = () => [mainWindow, overlayWindow];
  const overlayOnly = () => [overlayWindow];

  handle('state:get', appWindows, () => displayViewModel());
  handle('catalog:get', mainOnly, () => adviceService.getCatalog());
  handle('setup:get', mainOnly, () => setupSummary());

  handle('advice:set-role', mainOnly, (role) => {
    adviceService.setRole(role);
    const viewModel = displayViewModel();
    sendViewModel(gsiServer.getViewModel());
    return viewModel;
  });

  handle('roster:set-slot', mainOnly, (side, index, heroId) => {
    adviceService.setRosterSlot(side, index, heroId);
    const viewModel = displayViewModel();
    sendViewModel(gsiServer.getViewModel());
    return viewModel;
  });

  handle('roster:clear', mainOnly, () => {
    adviceService.clearRoster();
    const viewModel = displayViewModel();
    sendViewModel(gsiServer.getViewModel());
    return viewModel;
  });

  handle('setup:choose-directory', mainOnly, async () => {
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

  handle('setup:select', mainOnly, (dotaRoot) => {
    const resolved = resolveDotaRootFromSelection(dotaRoot);
    if (!resolved) throw new Error('Dota 2 目录无效');
    selectedDotaRoot = resolved;
    return setupSummary();
  });

  handle('setup:install', mainOnly, () => {
    if (!selectedDotaRoot) throw new Error('请先选择 Dota 2 目录');
    installConfig(selectedDotaRoot, settingsStore.getOrCreateToken(), gsiServer.getStatus().port);
    return setupSummary();
  });

  handle('setup:remove', mainOnly, () => {
    if (!selectedDotaRoot) throw new Error('请先选择 Dota 2 目录');
    removeConfig(selectedDotaRoot);
    return setupSummary();
  });

  handle('window:always-on-top', mainOnly, (enabled) => {
    mainWindow.setAlwaysOnTop(Boolean(enabled), 'floating');
    return mainWindow.isAlwaysOnTop();
  });

  handle('window:compact', mainOnly, (enabled) => {
    if (enabled) {
      mainWindow.setMinimumSize(420, 560);
      mainWindow.setSize(440, 720, true);
    } else {
      mainWindow.setMinimumSize(920, 680);
      mainWindow.setSize(1180, 780, true);
    }
    return Boolean(enabled);
  });

  handle('overlay:toggle', mainOnly, () => {
    if (overlayWindow?.isVisible()) {
      hideOverlay();
      return false;
    }
    showOverlay();
    return true;
  });

  handle('overlay:hide', overlayOnly, () => {
    hideOverlay();
    return false;
  });

  handle('overlay:set-locked', overlayOnly, (enabled) => setOverlayLocked(enabled));

  handle('demo:load', mainOnly, () => {
    const fixturePath = path.join(app.getAppPath(), 'fixtures', 'live-match.json');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    return displayViewModel(gsiServer.acceptTrustedPayload(fixture));
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
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!isQuitting) app.quit();
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function getInitialOverlayBounds() {
  const saved = settingsStore.get('overlayBounds');
  if (saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) {
    const workArea = screen.getDisplayMatching(saved).workArea;
    const width = Math.min(460, Math.max(350, saved.width));
    const height = Math.min(760, Math.max(480, saved.height));
    return {
      x: Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, saved.x)),
      y: Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, saved.y)),
      width,
      height
    };
  }

  const workArea = screen.getPrimaryDisplay().workArea;
  const width = 390;
  const height = 620;
  return {
    x: workArea.x + workArea.width - width - 20,
    y: workArea.y + 20,
    width,
    height
  };
}

function persistOverlayBounds() {
  clearTimeout(overlayBoundsTimer);
  overlayBoundsTimer = setTimeout(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      settingsStore.set('overlayBounds', overlayWindow.getBounds());
    }
  }, 250);
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    ...getInitialOverlayBounds(),
    minWidth: 350,
    minHeight: 480,
    maxWidth: 460,
    maxHeight: 760,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    fullscreenable: false,
    show: false,
    title: 'Dota 2 对局建议',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlayWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.showInactive();
    overlayWindow.moveTop();
  });
  overlayWindow.on('move', persistOverlayBounds);
  overlayWindow.on('resize', persistOverlayBounds);
  overlayWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      overlayWindow.hide();
    }
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
  overlayWindow.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'));
}

function showOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
  overlayWindow.showInactive();
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.moveTop();
}

function setOverlayLocked(enabled) {
  overlayLocked = Boolean(enabled);
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(overlayLocked, { forward: true });
    overlayWindow.setFocusable(!overlayLocked);
    overlayWindow.webContents.send('overlay:locked', overlayLocked);
  }
  return overlayLocked;
}

function hideOverlay() {
  setOverlayLocked(false);
  overlayWindow?.hide();
}

async function start() {
  settingsStore = new SettingsStore(app.getPath('userData'));
  gsiServer = new GsiServer({ token: settingsStore.getOrCreateToken(), port: 4000 });
  setupSummary();
  adviceService = new AdviceService({ getDotaRoot: () => selectedDotaRoot });

  if (selectedDotaRoot) {
    const currentConfig = getConfigStatus(selectedDotaRoot);
    if (currentConfig.managed) {
      try {
        installConfig(selectedDotaRoot, settingsStore.getOrCreateToken(), 4000);
      } catch {
        // A stale config should not prevent the local listener or UI from starting.
      }
    }
  }

  try {
    await gsiServer.start();
  } catch (error) {
    gsiServer.error = error.code === 'EADDRINUSE'
      ? '端口 4000 已被占用'
      : error.message;
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerIpcHandlers();
  createWindow();
  createOverlayWindow();
  gsiServer.on('update', sendViewModel);
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    if (overlayWindow?.isVisible()) hideOverlay();
    else showOverlay();
  });
  globalShortcut.register('CommandOrControl+Shift+L', () => setOverlayLocked(!overlayLocked));
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
    isQuitting = true;
    globalShortcut.unregisterAll();
    gsiServer?.stop();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
