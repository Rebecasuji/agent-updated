import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { setupAutoReconnect } from '../electron/autoReconnect.js';
import { setupOfflineCache } from '../electron/offlineCache.js';
import {
  setActivityMonitorWindow,
  startBackgroundMonitoring,
  stopBackgroundMonitoring,
  resetSessionCounters,
  showGlobalWaterReminder,
  setAutoLaunchEnabled,
  getAutoLaunchStatus,
  getCurrentActivity,
  getActivityLogs,
  initializeSessionCounters,
  updateIdleTimeout,
  updateAppClassifications,
  setIdleModalActive,
} from './activityMonitor.mac.js';
import { showIdlePromptWindow } from '../electron/idlePromptWindow.js';
import {
  showFloatingTimer,
  hideFloatingTimer,
  updateFloatingTimer,
} from '../electron/floatingTimer.js';
import { startLocalServer, stopLocalServer } from '../electron/localServer.js';
import {
  startScreenshotService,
  stopScreenshotService,
  getRecentScreenshots,
  updateScreenshotSettings,
} from '../electron/screenshotService.js';
import { startDailyScheduler, stopDailyScheduler, triggerDailySummaryEmails } from '../electron/dailyScheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const sessionCachePath = path.join(app.getPath('userData'), 'session-cache.json');

function saveSessionCache(data: any) {
  try {
    fs.writeFileSync(sessionCachePath, JSON.stringify(data), 'utf8');
  } catch { }
}

function loadSessionCache() {
  try {
    if (fs.existsSync(sessionCachePath)) {
      const data = fs.readFileSync(sessionCachePath, 'utf8');
      return JSON.parse(data);
    }
  } catch { }
  return null;
}

// macOS DMG/App specific handling
function setupMacOSApp() {
  // Request accessibility permissions
  console.log('[Main macOS] Requesting accessibility permissions if needed...');

  // Create app menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'Knockturn Agent',
      submenu: [
        { label: 'About', role: 'about' },
        { type: 'separator' },
        { label: 'Preferences...', accelerator: 'Cmd+,', click: () => showPreferences() },
        { type: 'separator' },
        { label: 'Hide', accelerator: 'Cmd+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Cmd+Option+H', role: 'hideOthers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Cmd+Q', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Cmd+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Cmd+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'Cmd+X', role: 'cut' },
        { label: 'Copy', accelerator: 'Cmd+C', role: 'copy' },
        { label: 'Paste', accelerator: 'Cmd+V', role: 'paste' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../../dist/electron/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    icon: nativeImage.createFromPath(path.join(__dirname, '../../public/assets/icon.png')).resize({ width: 256, height: 256 }),
  });

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../../dist/app/index.html')}`;

  mainWindow.loadURL(startUrl);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) mainWindow.webContents.openDevTools();

  return mainWindow;
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../public/assets/icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open', click: () => mainWindow?.show() },
    { label: 'Status', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else mainWindow?.show();
  });
}

function showPreferences() {
  if (!mainWindow) createWindow();
  else mainWindow.show();
  mainWindow?.webContents.send('navigate-to', 'settings');
}

// App event handlers
app.on('ready', async () => {
  setupMacOSApp();
  createWindow();
  createTray();
  setActivityMonitorWindow(mainWindow!);

  await setupAutoReconnect();
  setupOfflineCache();

  startLocalServer();
  startBackgroundMonitoring();
  startScreenshotService();
  startDailyScheduler();

  // Restore session state
  const cache = loadSessionCache();
  if (cache) {
    initializeSessionCounters(
      cache.activeSeconds || 0,
      cache.idleSeconds || 0,
      cache.productiveSeconds || 0,
      cache.sessionSeconds || 0
    );
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackgroundMonitoring();
  stopScreenshotService();
  stopDailyScheduler();
  stopLocalServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// IPC handlers
ipcMain.handle('get-platform', () => {
  return process.platform; // Returns 'darwin' for macOS
});

ipcMain.handle('get-activity', () => getCurrentActivity());
ipcMain.handle('get-activity-logs', () => getActivityLogs());
ipcMain.handle('reset-session', () => {
  resetSessionCounters();
  return true;
});

ipcMain.handle('set-idle-timeout', (_, minutes: number) => {
  updateIdleTimeout(minutes);
  return true;
});

ipcMain.handle('update-app-classifications', (_, classifications: any) => {
  updateAppClassifications(classifications);
  return true;
});

ipcMain.handle('set-idle-modal-active', (_, active: boolean) => {
  setIdleModalActive(active);
  return true;
});

ipcMain.handle('set-auto-launch', (_, enabled: boolean) => {
  return setAutoLaunchEnabled(enabled);
});

ipcMain.handle('get-auto-launch-status', () => {
  return getAutoLaunchStatus();
});

ipcMain.handle('show-floating-timer', () => {
  showFloatingTimer();
  return true;
});

ipcMain.handle('hide-floating-timer', () => {
  hideFloatingTimer();
  return true;
});

ipcMain.handle('update-floating-timer', (_, data: any) => {
  updateFloatingTimer(data);
  return true;
});

ipcMain.handle('get-recent-screenshots', () => {
  return getRecentScreenshots();
});

ipcMain.handle('update-screenshot-settings', (_, settings: any) => {
  updateScreenshotSettings(settings);
  return true;
});

ipcMain.handle('trigger-daily-emails', () => {
  triggerDailySummaryEmails();
  return true;
});

ipcMain.on('show-water-reminder', () => {
  showGlobalWaterReminder();
});

// Save session on close
  mainWindow?.webContents.on('before-input-event', (event: any, input: any) => {
  if (input.control && input.key.toLowerCase() === 's' && process.platform === 'darwin') {
    event.preventDefault();
    const activity = getCurrentActivity();
    saveSessionCache({
      activeSeconds: activity.activeSeconds,
      idleSeconds: activity.idleSeconds,
      productiveSeconds: activity.productiveSeconds,
      sessionSeconds: activity.sessionSeconds,
    });
  }
});
