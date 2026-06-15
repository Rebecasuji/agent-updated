import { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage, powerMonitor, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import isDev from 'electron-is-dev';
import dotenv from 'dotenv';
import pg from 'pg';

// Define __dirname and __filename before any usage
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize dotenv at startup with multiple fallback paths
function initializeEnvironment() {
  console.log('\n=== ENVIRONMENT DEBUG (STARTUP) ===');
  console.log('cwd:', process.cwd());
  console.log('__dirname:', __dirname);
  console.log('process.execPath:', process.execPath);
  console.log('app.getAppPath():', app.getAppPath?.());
  console.log('process.env.TIMESHEET_DB_URL (before dotenv):', process.env.TIMESHEET_DB_URL ? '(SET)' : '(UNDEFINED)');
  console.log('ENV FILE EXISTS checks:');
  
  const resourcesPath = (process as any).resourcesPath;
  const dotenvCandidates = [
    // Packaged app: resources root (PRIMARY for packaged)
    resourcesPath ? path.join(resourcesPath, '.env') : null,
    resourcesPath ? path.join(resourcesPath, '.env.local') : null,
    // Project root (dev mode)
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
    // __dirname locations (dev)
    path.join(__dirname, '.env.local'),
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env.local'),
    path.join(__dirname, '..', '..', '.env'),
    // Packaged app: next to executable (fallback)
    path.join(path.dirname(process.execPath), '.env.local'),
    path.join(path.dirname(process.execPath), '.env'),
    path.join(path.dirname(process.execPath), '..', '.env.local'),
    path.join(path.dirname(process.execPath), '..', '.env'),
  ].filter(p => p !== null);

  console.log('[TimesheetDB] Initializing environment variables...');
  for (const dotenvPath of dotenvCandidates) {
    const exists = fs.existsSync(dotenvPath);
    console.log(`  ${exists ? '✓' : '✗'} ${dotenvPath}`);
    try {
      if (exists) {
        const result = dotenv.config({ path: dotenvPath });
        console.log(`[TimesheetDB] ✓ Loaded .env from: ${dotenvPath}`);
        console.log('[TimesheetDB] dotenv result:', result);
        if (result.error) console.warn('[TimesheetDB] Warning:', result.error);
        
        // Log immediately after loading
        console.log('\n=== AFTER dotenv.config() ===');
        console.log('process.env.TIMESHEET_DB_URL:', process.env.TIMESHEET_DB_URL ? '(SET, length: ' + process.env.TIMESHEET_DB_URL.length + ')' : '(UNDEFINED)');
        console.log('Loaded environment keys containing TIMESHEET or DATABASE:');
        const relevantKeys = Object.keys(process.env).filter(k => k.includes('TIMESHEET') || k.includes('DATABASE'));
        relevantKeys.forEach(k => {
          console.log(`  ${k}: ${process.env[k] ? '(SET)' : '(UNDEFINED)'}`);
        });
        if (relevantKeys.length === 0) {
          console.log('  (No TIMESHEET or DATABASE keys found)');
        }
        console.log('===\n');
        
        return true;
      }
    } catch (err) {
      console.warn('[TimesheetDB] Error at', dotenvPath, ':', (err as any).message);
    }
  }
  
  // If .env not found in standard locations, try loading from app.getPath('userData')
  try {
    const userDataEnvPath = path.join(app.getPath('userData'), '.env');
    console.log('[TimesheetDB] Attempting fallback load from userData:', userDataEnvPath);
    if (fs.existsSync(userDataEnvPath)) {
      const result = dotenv.config({ path: userDataEnvPath });
      console.log(`[TimesheetDB] ✓ Loaded .env from userData:`, userDataEnvPath);
      console.log('[TimesheetDB] dotenv result:', result);
      console.log('process.env.TIMESHEET_DB_URL:', process.env.TIMESHEET_DB_URL ? '(SET, length: ' + process.env.TIMESHEET_DB_URL.length + ')' : '(UNDEFINED)');
      console.log('===\n');
      return true;
    }
  } catch (err) {
    console.warn('[TimesheetDB] Error loading from userData:', (err as any).message);
  }
  
  console.warn('[TimesheetDB] ⚠ No .env file found in any location');
  console.log('===\n');
  return false;
}

// Call before any database operations
const envInitialized = initializeEnvironment();
console.log('[TimesheetDB] Environment initialization result:', envInitialized);
console.log('[TimesheetDB] TIMESHEET_DB_URL configured:', !!process.env.TIMESHEET_DB_URL);

// Fallback: If environment not initialized, try to copy .env from app root to userData
if (!envInitialized || !process.env.TIMESHEET_DB_URL) {
  console.log('[TimesheetDB] CRITICAL: Environment not initialized properly, attempting recovery...');
  try {
    // Find .env in app resources
    const appRoot = path.dirname(process.execPath);
    const possibleEnvPaths = [
      path.join(appRoot, '.env'),
      path.join(appRoot, '..', '.env'),
      path.join((process as any).resourcesPath || '', '.env'),
      path.join((process as any).resourcesPath || '', 'app', '.env'),
    ];
    
    let sourceEnvPath: string | null = null;
    for (const p of possibleEnvPaths) {
      if (fs.existsSync(p)) {
        console.log('[TimesheetDB] Found .env source at:', p);
        sourceEnvPath = p;
        break;
      }
    }
    
    if (sourceEnvPath) {
      const userDataPath = app.getPath('userData');
      const destEnvPath = path.join(userDataPath, '.env');
      console.log('[TimesheetDB] Copying .env from', sourceEnvPath, 'to', destEnvPath);
      fs.copyFileSync(sourceEnvPath, destEnvPath);
      
      // Now try loading from userData
      const result = dotenv.config({ path: destEnvPath });
      console.log('[TimesheetDB] Recovery: Loaded .env from', destEnvPath);
      console.log('[TimesheetDB] TIMESHEET_DB_URL after recovery:', process.env.TIMESHEET_DB_URL ? '(SET)' : '(UNDEFINED)');
    } else {
      console.error('[TimesheetDB] CRITICAL: Could not find .env file anywhere!');
    }
  } catch (err) {
    console.error('[TimesheetDB] Recovery failed:', (err as any).message);
  }
}

function getTimesheetDbUrl(): string | undefined {
  const url = process.env.TIMESHEET_DB_URL;
  if (!url) {
    console.warn('[TimesheetDB] TIMESHEET_DB_URL is not set');
  }
  return url || undefined;
}

import { setupAutoReconnect } from './autoReconnect.js';
import { setupOfflineCache } from './offlineCache.js';
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
} from './activityMonitor.js';
import { showIdlePromptWindow } from './idlePromptWindow.js';
import {
  createFloatingTimerWindow,
  showFloatingTimer,
  hideFloatingTimer,
  updateFloatingTimer,
} from './floatingTimer.js';
import { startLocalServer, stopLocalServer } from './localServer.js';
import {
  startScreenshotService,
  stopScreenshotService,
  getRecentScreenshots,
  updateScreenshotSettings,
} from './screenshotService.js';
import { startDailyScheduler, stopDailyScheduler, triggerDailySummaryEmails } from './dailyScheduler.js';
import { startTimesheetEnforcer, stopTimesheetEnforcer, checkTimesheetSubmitted, getPreviousWorkingDate, setTimesheetDbUrlGetter, getComplianceDetails } from './timesheetEnforcer.js';

// Export getTimesheetDbUrl for use in other modules
export { getTimesheetDbUrl };

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let windowLocked = false;

// Session persistence path
const sessionCachePath = path.join(app.getPath('userData'), 'session-cache.json');

function saveSessionCache(data: any) {
  try {
    fs.writeFileSync(sessionCachePath, JSON.stringify(data), 'utf8');
  } catch { }
}

function loadSessionCache(): any {
  try {
    if (fs.existsSync(sessionCachePath)) {
      return JSON.parse(fs.readFileSync(sessionCachePath, 'utf8'));
    }
  } catch { }
  return null;
}

function clearSessionCache() {
  try {
    if (fs.existsSync(sessionCachePath)) fs.unlinkSync(sessionCachePath);
  } catch { }
}

// Register with Windows startup via Registry (robust fallback)
function registerWindowsStartup() {
  if (process.platform !== 'win32') return;

  // Clean up old startup keys to prevent opening old/incorrect versions
  try {
    execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "TimeStrap Agent" /f', { stdio: 'ignore' });
  } catch { }
  try {
    execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "electron.app.Knockturn Agent" /f', { stdio: 'ignore' });
  } catch { }
  try {
    execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "electron.app.Electron" /f', { stdio: 'ignore' });
  } catch { }
  try {
    execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "TimeChampAgent" /f', { stdio: 'ignore' });
  } catch { }

  if (app.isPackaged) {
    // Production: use Windows Registry for significantly faster startup
    try {
      const regValue = `"${process.execPath}"`;
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Knockturn Agent" /t REG_SZ /d "${regValue}" /f`, { stdio: 'ignore' });
      
      // Also keep the Electron built-in login item just as a secondary safety net
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: [],
        openAsHidden: false,
      });
    } catch (err) {
      console.error('Failed to register startup via Registry:', err);
    }
  } else {
    // Dev mode: use Windows Registry to auto-start the app on boot
    try {
      const regValue = `"${process.execPath}" "${path.resolve('.')}"`;
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "KnockturnAgent" /t REG_SZ /d "${regValue}" /f`, { stdio: 'ignore' });
      console.log('[Startup] Registered dev auto-launch via Registry');
    } catch (err) {
      console.error('Failed to register dev startup via Registry:', err);
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Initialize auto-reconnect and offline cache
setupAutoReconnect();
setupOfflineCache();

async function resolveStartUrl() {
  const localUrl = 'http://localhost:5013';
  if (isDev) {
    try {
      const response = await fetch(localUrl, { method: 'HEAD' });
      if (response.ok || response.status === 404) {
        return localUrl;
      }
    } catch {
      console.warn('Dev server unavailable, falling back to built index.html');
    }
  }

  const indexPath = path.join(__dirname, '../app/index.html');
  return `file://${indexPath}`;
}

async function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    fullscreen: false,
    show: false,
    minimizable: false,
    maximizable: true,
    closable: false,
    skipTaskbar: false,
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: true,  // Enable DevTools
    },
  });

  const startUrl = await resolveStartUrl();
  await mainWindow.loadURL(startUrl);

  // Open DevTools when page finishes loading (more reliable)
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page loaded, attempting to open DevTools...');
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
        console.log('[Main] DevTools opened successfully');
      }
    } catch (err) {
      console.error('[Main] Failed to open DevTools on page load:', err);
    }
  });

  // Also try opening immediately with a delay as backup
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[Main] Backup: Opening DevTools with delay...');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    } catch (err) {
      console.error('[Main] Backup: Failed to open DevTools:', err);
    }
  }, 1000);

  // Add keyboard shortcuts for DevTools (F12, Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // F12 to toggle DevTools
    if (input.key.toLowerCase() === 'f12') {
      try {
        mainWindow?.webContents.toggleDevTools();
        console.log('[Main] F12: Toggling DevTools');
        event.preventDefault();
      } catch (err) {
        console.error('[Main] Failed to toggle DevTools with F12:', err);
      }
    }
    // Ctrl+Shift+I also toggles DevTools
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      try {
        mainWindow?.webContents.toggleDevTools();
        console.log('[Main] Ctrl+Shift+I: Toggling DevTools');
        event.preventDefault();
      } catch (err) {
        console.error('[Main] Failed to toggle DevTools with Ctrl+Shift+I:', err);
      }
    }
  });

  // Set the window reference for activity monitor (actual monitoring starts later via IPC)
  setActivityMonitorWindow(mainWindow);

  mainWindow.once('ready-to-show', () => {
    // Pass session cache to renderer so it can auto-restore —
    // but only if the cached session is from today
    const cached = loadSessionCache();
    const today = new Date().toISOString().slice(0, 10);
    if (cached && cached.session?.session_date === today) {
      mainWindow?.webContents.send('session-restored', cached);
    } else if (cached) {
      // Stale session from a different day — clear it so user starts fresh
      console.log(`[Main] Stale session cache from ${cached.session?.session_date}, today is ${today}. Clearing.`);
      clearSessionCache();
    }

    // Always show and bring to front on startup (like TimeChamp)
    mainWindow?.show();
    mainWindow?.focus();
    // Pop above everything briefly so the user sees the login/plan screen
    mainWindow?.setAlwaysOnTop(true, 'screen-saver');
    setTimeout(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
        }
      } catch { }
    }, 2000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Minimise to tray instead of taskbar
  mainWindow.on('minimize', () => {
    if (!windowLocked) {
      mainWindow?.hide();
    }
  });

  // Prevent close → hide to tray
  mainWindow.on('close', (event: any) => {
    if (windowLocked && !isQuitting) {
      event.preventDefault();
      return;
    }
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Block Alt+F4 / Alt+Space when locked
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (windowLocked) {
      if (input.alt && input.key.toLowerCase() === 'f4') {
        event.preventDefault();
        return;
      }
      if (input.alt && input.key === ' ') {
        event.preventDefault();
        return;
      }
    }
  });

  return mainWindow;
}

function resolveTrayIconPath() {
  const isWin = process.platform === 'win32';
  const ext = isWin ? 'ico' : 'png';
  const candidates = [
    path.join(__dirname, `../assets/icon.${ext}`),
    path.join(__dirname, `../../assets/icon.${ext}`),
    path.join(process.cwd(), 'assets', `icon.${ext}`),
    path.join(process.cwd(), 'public', 'assets', `icon.${ext}`),
    path.join(app.getAppPath(), 'assets', `icon.${ext}`),
    path.join(app.getAppPath(), 'public', 'assets', `icon.${ext}`),
    path.join(app.getAppPath(), 'dist', 'assets', `icon.${ext}`),
    // Fallbacks
    path.join(__dirname, '../assets/icon.png'),
    path.join(process.cwd(), 'assets', 'icon.png'),
    path.join(process.cwd(), 'public', 'assets', 'icon.png'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function createTray() {
  const iconPath = resolveTrayIconPath();
  let trayIcon = null;

  if (iconPath) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) trayIcon = image;
  }

  try {
    tray = trayIcon ? new Tray(trayIcon) : new Tray(nativeImage.createEmpty());
  } catch (error) {
    console.error('Failed to create tray icon:', error);
    return;
  }

  tray.setToolTip('Knockturn Employee Agent');

  const rebuildMenu = () => Menu.buildFromTemplate([
    {
      label: 'Show Knockturn',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      },
    },
    {
      label: 'Hide to Tray',
      enabled: !windowLocked,
      click: () => {
        if (mainWindow && !windowLocked) mainWindow.hide();
      },
    },
    { type: 'separator' },
    { label: '● Auto-start: ON', enabled: false },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(rebuildMenu());

  tray.on('click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ─── Push activity updates to the floating timer ──────────────────────────────
let floatingUpdateInterval: NodeJS.Timeout | null = null;

function startFloatingTimerUpdates() {
  if (floatingUpdateInterval) return;
  floatingUpdateInterval = setInterval(() => {
    const act = getCurrentActivity();
    const productivityPct =
      act.sessionSeconds > 0
        ? Math.round((act.productiveSeconds / act.sessionSeconds) * 100)
        : 0;
    updateFloatingTimer({
      sessionSeconds: act.sessionSeconds,
      state: act.state,
      currentApp: act.activeWindow.appName,
      productivityPct,
      activeSeconds: act.activeSeconds,
    });
  }, 1000);
}

function stopFloatingTimerUpdates() {
  if (floatingUpdateInterval) {
    clearInterval(floatingUpdateInterval);
    floatingUpdateInterval = null;
  }
}

// ─── App ready ────────────────────────────────────────────────────────────────
app.on('ready', async () => {
  if (!gotLock) return;

  console.log('[App] Ready event fired');
  console.log(`[App] isDev: ${isDev}, isPackaged: ${app.isPackaged}`);
  console.log(`[App] App path: ${app.getAppPath()}`);

  // Initialize timesheet enforcer with URL getter
  setTimesheetDbUrlGetter(getTimesheetDbUrl);

  await createWindow();

  // Create the floating timer window (hidden until session starts)
  createFloatingTimerWindow();

  try { createTray(); } catch (e) { console.error('Tray creation failed:', e); }

  // Register Windows startup
  registerWindowsStartup();

  // Start local fallback server
  startLocalServer();

  // Start background screenshot service
  startScreenshotService();

  // Start daily summary email scheduler
  startDailyScheduler();

  if (mainWindow) {
    mainWindow.webContents.session.preconnect({ url: 'https://ogqmojvzeyasqoqhkpuz.supabase.co' });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-connection-status', async () => {
  return mainWindow?.webContents.session || false;
});

ipcMain.handle('cache-data', async (_, key: string, value: any) => {
  try {
    const cachePath = path.join(app.getPath('userData'), 'cache');
    if (!fs.existsSync(cachePath)) fs.mkdirSync(cachePath, { recursive: true });
    fs.writeFileSync(path.join(cachePath, `${key}.json`), JSON.stringify(value), 'utf8');
    return true;
  } catch { return false; }
});

ipcMain.handle('get-cached-data', async (_, key: string) => {
  try {
    const file = path.join(app.getPath('userData'), 'cache', `${key}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    return null;
  } catch { return null; }
});

ipcMain.handle('enter-kiosk', async () => {
  try {
    if (mainWindow) {
      mainWindow.setKiosk(true);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.show(); mainWindow.focus();
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('exit-kiosk', async () => {
  try {
    if (mainWindow) {
      mainWindow.setKiosk(false);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.show(); mainWindow.focus();
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('show-water-reminder', async () => {
  try { showGlobalWaterReminder(); return true; } catch { return false; }
});

ipcMain.handle('request-show-window', async () => {
  try {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.moveTop();
      mainWindow.focus();
      // Keep on top briefly so it pops above everything (even fullscreen apps)
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(false);
          }
        } catch { }
      }, 500);
    }
    return true;
  } catch { return false; }
});
ipcMain.handle('set-idle-modal-active', async (_, active: boolean) => {
  try { setIdleModalActive(active); return true; } catch { return false; }
});
ipcMain.handle('initialize-session-counters', async (_, active: number, idle: number, productive: number, session: number) => {
  try {
    initializeSessionCounters(active, idle, productive, session);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('get-recent-screenshots', async () => {
  try { 
    const shots = getRecentScreenshots();
    console.log('[IPC] get-recent-screenshots handler called - returning:', shots.length, 'screenshots');
    return shots;
  } catch (err) {
    console.error('[IPC] Error in get-recent-screenshots:', err);
    return [];
  }
});

ipcMain.handle('start-screenshot-service', async () => {
  try { startScreenshotService(); return true; } catch { return false; }
});

ipcMain.handle('stop-screenshot-service', async () => {
  try { stopScreenshotService(); return true; } catch { return false; }
});

ipcMain.handle('get-latest-activity', async () => {
  try { return getCurrentActivity(); } catch { return null; }
});

ipcMain.handle('get-activity-logs', async () => {
  try { return getActivityLogs(); } catch { return []; }
});

ipcMain.handle('set-auto-launch', async (_, enabled: boolean) => {
  try { return setAutoLaunchEnabled(enabled); } catch { return false; }
});

ipcMain.handle('get-auto-launch-status', async () => {
  try { return getAutoLaunchStatus(); } catch { return false; }
});

ipcMain.handle('update-monitoring-settings', async (_, settings: any) => {
  try {
    if (settings.screenshot_interval_minutes !== undefined) {
      updateScreenshotSettings(settings.screenshot_interval_minutes, settings.blur_screenshots);
    }
    if (settings.idle_timeout_minutes !== undefined) {
      updateIdleTimeout(settings.idle_timeout_minutes);
    }
    return true;
  } catch (err) {
    console.error('Failed to update monitoring settings in Main:', err);
    return false;
  }
});

ipcMain.handle('update-app-classifications', async (_, classifications: any[]) => {
  try {
    updateAppClassifications(classifications);
    return true;
  } catch (err) {
    console.error('Failed to update app classifications in Main:', err);
    return false;
  }
});

ipcMain.handle('finish-day', async () => {
  try {
    // Stop background activity monitoring
    stopBackgroundMonitoring();
    return true;
  } catch (err) {
    console.error('Failed to finish day:', err);
    return false;
  }
});

ipcMain.handle('show-idle-reminder', async () => {
  try {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.restore();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.focus();
    }
    const n = new Notification({
      title: 'Idle Time Check',
      body: 'You have been idle. Please enter your activity details.',
      silent: false,
    });
    n.show();
    return true;
  } catch { return false; }
});

ipcMain.handle('get-system-idle-time', async () => {
  try { return powerMonitor.getSystemIdleTime(); } catch { return 0; }
});

ipcMain.handle('minimize-window', async () => {
  try {
    if (mainWindow) {
      if (windowLocked) return false;
      mainWindow.hide(); // hide to tray instead of minimise
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('toggle-maximize-window', async () => {
  try {
    if (mainWindow) {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('close-window', async () => {
  try {
    if (mainWindow) { isQuitting = true; mainWindow.close(); }
    return true;
  } catch { return false; }
});

ipcMain.handle('set-window-minimizable', async (_, minimizable: boolean) => {
  try {
    if (mainWindow) {
      mainWindow.setMinimizable(minimizable);
      if (!minimizable) { mainWindow.show(); mainWindow.focus(); }
      windowLocked = !(mainWindow.isClosable() && mainWindow.isMinimizable());
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('set-window-closable', async (_, closable: boolean) => {
  try {
    if (mainWindow) {
      mainWindow.setClosable(closable);
      windowLocked = !(mainWindow.isClosable() && mainWindow.isMinimizable());
      if (!closable) { mainWindow.show(); mainWindow.focus(); }
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('start-timesheet-poller', async (_, employeeCode: string) => {
  try {
    await startTimesheetEnforcer(employeeCode, mainWindow);
    return true;
  } catch (error) {
    console.error('[TimesheetIPC] start-timesheet-poller failed:', error);
    return false;
  }
});

ipcMain.handle('start-pms-poller', async (_, employeeCode: string) => {
  // PMS Poller has been removed, returning true silently
  return true;
});

ipcMain.handle('stop-timesheet-poller', async () => {
  try {
    stopTimesheetEnforcer();
    return true;
  } catch (error) {
    console.error('[TimesheetIPC] stop-timesheet-poller failed:', error);
    return false;
  }
});

ipcMain.handle('check-timesheets-submitted-batch', async (_, employeeCodes: string[], dateStr: string) => {
  const timesheetDbUrl = getTimesheetDbUrl();
  if (!timesheetDbUrl) {
    console.error('[TimesheetIPC] check-timesheets-submitted-batch: TIMESHEET_DB_URL not configured');
    return { results: {} };
  }

  const { Client } = pg;
  const client = new Client({
    connectionString: timesheetDbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const query = `
      SELECT e.employee_code,
             CASE WHEN COALESCE(te.count, 0) > 0 OR COALESCE(ds.count, 0) > 0 THEN true ELSE false END AS submitted
      FROM employees e
      LEFT JOIN (
        SELECT employee_id, COUNT(*) AS count
        FROM time_entries
        WHERE date = $1 AND status NOT IN ('draft','rejected')
        GROUP BY employee_id
      ) te ON te.employee_id = e.id
      LEFT JOIN (
        SELECT employee_id, COUNT(*) AS count
        FROM daily_submissions
        WHERE date = $1
        GROUP BY employee_id
      ) ds ON ds.employee_id = e.id
      WHERE e.employee_code = ANY($2)
    `;

    const res = await client.query(query, [dateStr, employeeCodes]);
    const results = res.rows.reduce<Record<string, boolean>>((acc, row: any) => {
      if (row.employee_code) {
        acc[row.employee_code] = row.submitted;
      }
      return acc;
    }, {});

    await client.end();
    return { results };
  } catch (error) {
    console.error('[TimesheetIPC] check-timesheets-submitted-batch failed:', error);
    try { await client.end(); } catch {}
    return { results: {} };
  }
});

ipcMain.handle('verify-timesheet-realtime', async (_, employeeCode: string) => {
  try {
    const dateStr = getPreviousWorkingDate();
    if (!dateStr) {
      return { submitted: true };
    }
    const submitted = await checkTimesheetSubmitted(employeeCode, dateStr);
    return { submitted };
  } catch (error) {
    console.error('[TimesheetIPC] verify-timesheet-realtime failed:', error);
    return { submitted: false };
  }
});

ipcMain.handle('get-compliance-details', async (_, employeeCode: string, empId: string, dateStr: string) => {
  try {
    const details = await getComplianceDetails(employeeCode, empId, dateStr);
    return details;
  } catch (error) {
    console.error('[TimesheetIPC] get-compliance-details failed:', error);
    return null;
  }
});

ipcMain.handle('open-timesheet-browser', async () => {
  const timesheetUrl = process.env.TIMESHEET_URL || process.env.TIMESHEET_PORTAL_URL || 'https://timestrap.space';
  if (!timesheetUrl) {
    console.error('[TimesheetIPC] open-timesheet-browser: no TIMESHEET_URL configured and fallback failed');
    return false;
  }

  try {
    const timesheetWin = new BrowserWindow({
      width: 1000,
      height: 800,
      parent: mainWindow || undefined,
      modal: !!mainWindow,
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    // Position it slightly off-center if there's a main window so it feels like a modal overlay
    if (mainWindow) {
      const parentBounds = mainWindow.getBounds();
      const x = Math.max(0, parentBounds.x + (parentBounds.width - 1000) / 2);
      const y = Math.max(0, parentBounds.y + (parentBounds.height - 800) / 2);
      timesheetWin.setBounds({ x: Math.floor(x), y: Math.floor(y), width: 1000, height: 800 });
    }

    timesheetWin.loadURL(timesheetUrl);
    return true;
  } catch (error) {
    console.error('[TimesheetIPC] open-timesheet-browser failed:', error);
    return false;
  }
});

ipcMain.handle('lock-system', async () => {
  try {
    if (process.platform === 'win32') {
      execSync('rundll32.exe user32.dll,LockWorkStation');
      return true;
    }
    console.warn('[TimesheetIPC] lock-system is not implemented for platform:', process.platform);
    return false;
  } catch (error) {
    console.error('[TimesheetIPC] lock-system failed:', error);
    return false;
  }
});

// ─── Floating Timer IPC ───────────────────────────────────────────────────────

ipcMain.handle('show-floating-timer', async () => {
  try {
    showFloatingTimer();
    startFloatingTimerUpdates();
    return true;
  } catch { return false; }
});

ipcMain.handle('hide-floating-timer', async () => {
  try {
    hideFloatingTimer();
    stopFloatingTimerUpdates();
    return true;
  } catch { return false; }
});

// ─── Session Persistence IPC ──────────────────────────────────────────────────

ipcMain.handle('save-session-cache', async (_, data: any) => {
  try { saveSessionCache(data); return true; } catch { return false; }
});

ipcMain.handle('load-session-cache', async () => {
  try { return loadSessionCache(); } catch { return null; }
});

ipcMain.handle('clear-session-cache', async () => {
  try { clearSessionCache(); return true; } catch { return false; }
});

// Debug environment configuration
ipcMain.handle('debug-env', async () => {
  const timesheetDbUrl = process.env.TIMESHEET_DB_URL;
  console.log('\n=== IPC: debug-env called ===');
  console.log('process.cwd():', process.cwd());
  console.log('__dirname:', __dirname);
  console.log('process.execPath:', process.execPath);
  console.log('app.getPath("userData"):', app.getPath('userData'));
  console.log('process.resourcesPath:', (process as any).resourcesPath);
  console.log('TIMESHEET_DB_URL:', timesheetDbUrl ? '(SET, length: ' + timesheetDbUrl.length + ')' : '(UNDEFINED)');
  console.log('isDev:', isDev);
  console.log('app.isPackaged:', app.isPackaged);
  console.log('===\n');
  
  return {
    cwd: process.cwd(),
    dirname: __dirname,
    execPath: process.execPath,
    userDataPath: app.getPath('userData'),
    resourcesPath: (process as any).resourcesPath,
    hasTimesheetUrl: !!timesheetDbUrl,
    timesheetUrlLength: timesheetDbUrl?.length || 0,
    isDev,
    isPackaged: app.isPackaged,
    allEnvKeys: Object.keys(process.env).sort(),
    timesheetEnvKeys: Object.keys(process.env).filter(k => k.includes('TIMESHEET') || k.includes('DATABASE')),
  };
});

// Check external timesheet DB for plan submission
ipcMain.handle('check-timesheet-db', async (_, employeeCode) => {
  const timesheetDbUrl = getTimesheetDbUrl();
  
  console.log('\n[TimesheetDB] check-timesheet-db called for:', employeeCode);
  console.log('[TimesheetDB] URL configured:', !!timesheetDbUrl);
  console.log('[TimesheetDB] process.env.TIMESHEET_DB_URL:', process.env.TIMESHEET_DB_URL ? 'YES (length: ' + process.env.TIMESHEET_DB_URL.length + ')' : 'NO');
  console.log('[TimesheetDB] getTimesheetDbUrl() result:', timesheetDbUrl ? 'YES (length: ' + timesheetDbUrl.length + ')' : 'NO');
  
  if (!timesheetDbUrl) {
    console.error('[TimesheetDB] ✗ TIMESHEET_DB_URL is not configured');
    return false;
  }

  const { Client } = pg;
  const client = new Client({
    connectionString: timesheetDbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('[TimesheetDB] ✓ Connected to database');

    // Try multiple possible employee code column names
    const empCols = ['employee_code', 'emp_code', 'empid'];
    let employeeId: string | null = null;
    
    for (const col of empCols) {
      try {
        const res = await client.query(`SELECT id FROM employees WHERE ${col} = $1 LIMIT 1`, [employeeCode]);
        if (res.rows.length > 0) {
          employeeId = res.rows[0].id;
          console.log(`[TimesheetDB] ✓ Found employee by "${col}"`);
          break;
        }
      } catch (e) {
        // Try next column
      }
    }

    if (!employeeId) {
      console.warn('[TimesheetDB] ✗ Employee not found');
      await client.end();
      return false;
    }

    const today = new Date().toISOString().slice(0, 10);
    console.log(`[TimesheetDB] Checking for submitted plans on ${today}`);

    // Check daily_plans
    try {
      const planRes = await client.query(`SELECT id FROM daily_plans WHERE employee_id = $1 AND "date" = $2`, [employeeId, today]);
      if (planRes.rows.length > 0) {
        console.log('[TimesheetDB] ✓ daily_plans found:', planRes.rows.length);
        await client.end();
        return true;
      }
    } catch (e) {
      console.warn('[TimesheetDB] daily_plans query failed:', (e as any).message);
    }

    // Check daily_submissions
    try {
      const subRes = await client.query(`SELECT id FROM daily_submissions WHERE employee_id = $1 AND "date" = $2`, [employeeId, today]);
      if (subRes.rows.length > 0) {
        console.log('[TimesheetDB] ✓ daily_submissions found:', subRes.rows.length);
        await client.end();
        return true;
      }
    } catch (e) {
      console.warn('[TimesheetDB] daily_submissions query failed:', (e as any).message);
    }

    // Check time_entries
    try {
      const teRes = await client.query(`SELECT id FROM time_entries WHERE employee_id = $1 AND "date"::text = $2 AND status NOT IN ('draft','rejected')`, [employeeId, today]);
      if (teRes.rows.length > 0) {
        console.log('[TimesheetDB] ✓ time_entries found:', teRes.rows.length);
        await client.end();
        return true;
      }
    } catch (e) {
      console.warn('[TimesheetDB] time_entries query failed:', (e as any).message);
    }

    console.log('[TimesheetDB] No submitted plans found');
    await client.end();
    return false;
  } catch (error) {
    console.error('[TimesheetDB] ✗ Error checking timesheet DB:', error);
    try { await client.end(); } catch (e) {}
    return false;
  }
});

// Debug version with detailed diagnostics
ipcMain.handle('check-timesheet-db-debug', async (_, employeeCode) => {
  const timesheetDbUrl = getTimesheetDbUrl();
  const result: any = {
    ok: false,
    timesheetDbUrl: !!timesheetDbUrl,
    employeeCode,
    details: {},
    errors: [],
    configStatus: {
      urlLoaded: !!timesheetDbUrl,
      connectionAttempted: false,
      connectionSuccess: false
    }
  };

  console.log(`[TimesheetDB DEBUG] Starting diagnosis for employee: ${employeeCode}`);

  if (!timesheetDbUrl) {
    console.error('[TimesheetDB DEBUG] ✗ TIMESHEET_DB_URL is not configured');
    result.errors.push('CONFIGURATION_ERROR: TIMESHEET_DB_URL not configured');
    return result;
  }

  console.log('[TimesheetDB DEBUG] ✓ TIMESHEET_DB_URL is configured');

  const { Client } = pg;
  const client = new Client({
    connectionString: timesheetDbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    result.configStatus.connectionAttempted = true;
    await client.connect();
    result.configStatus.connectionSuccess = true;
    console.log('[TimesheetDB DEBUG] ✓ Database connection successful');

    const empCols = ['employee_code', 'emp_code', 'empid'];
    let employeeId: string | null = null;
    let foundCol: string | null = null;

    for (const col of empCols) {
      try {
        const res = await client.query(`SELECT id FROM employees WHERE ${col} = $1 LIMIT 1`, [employeeCode]);
        if (res.rows.length > 0) {
          employeeId = res.rows[0].id;
          foundCol = col;
          console.log(`[TimesheetDB DEBUG] ✓ Found employee by "${col}": ${employeeId}`);
          break;
        }
      } catch (e) {
        result.errors.push(`lookup by ${col} failed: ${(e as any).message || e}`);
      }
    }

    result.details.foundColumn = foundCol;
    result.details.employeeId = employeeId;

    const today = new Date().toISOString().slice(0, 10);
    result.details.date = today;

    if (!employeeId) {
      console.warn('[TimesheetDB DEBUG] ✗ Employee not found');
      await client.end();
      return result;
    }

    console.log('[TimesheetDB DEBUG] Checking submission tables for date:', today);

    try {
      const planRes = await client.query(`SELECT id FROM daily_plans WHERE employee_id = $1 AND "date" = $2`, [employeeId, today]);
      result.details.daily_plans = planRes.rows.length;
      console.log('[TimesheetDB DEBUG] daily_plans found:', planRes.rows.length);
    } catch (e) {
      result.errors.push('daily_plans check failed: ' + ((e as any).message || e));
    }

    try {
      const subRes = await client.query(`SELECT id FROM daily_submissions WHERE employee_id = $1 AND "date" = $2`, [employeeId, today]);
      result.details.daily_submissions = subRes.rows.length;
      console.log('[TimesheetDB DEBUG] daily_submissions found:', subRes.rows.length);
    } catch (e) {
      result.errors.push('daily_submissions check failed: ' + ((e as any).message || e));
    }

    try {
      const teRes = await client.query(`SELECT id FROM time_entries WHERE employee_id = $1 AND "date"::text = $2 AND status NOT IN ('draft','rejected')`, [employeeId, today]);
      result.details.time_entries = teRes.rows.length;
      console.log('[TimesheetDB DEBUG] time_entries found:', teRes.rows.length);
    } catch (e) {
      result.errors.push('time_entries check failed: ' + ((e as any).message || e));
    }

    result.ok = (result.details.daily_plans || result.details.daily_submissions || result.details.time_entries) > 0;
    console.log('[TimesheetDB DEBUG] Final result:', {
      submitted: result.ok,
      daily_plans: result.details.daily_plans,
      daily_submissions: result.details.daily_submissions,
      time_entries: result.details.time_entries
    });
    
    await client.end();
    return result;
  } catch (error) {
    result.errors.push('fatal: ' + ((error as any).message || error));
    console.error('[TimesheetDB DEBUG] Fatal error:', error);
    try { await client.end(); } catch (e) {}
    return result;
  }
});

// ─── Daily Summary Email IPC ──────────────────────────────────────────────────

ipcMain.handle('trigger-daily-summary-emails', async () => {
  try {
    await triggerDailySummaryEmails();
    return true;
  } catch (err) {
    console.error('[Main] Error triggering daily summary emails:', err);
    return false;
  }
});

// ─── App quit ─────────────────────────────────────────────────────────────────

// ─── Start / Stop tracking IPC (called by renderer after plan+punch) ──────────

ipcMain.handle('start-tracking', async () => {
  try {
    startBackgroundMonitoring();
    console.log('[Main] Tracking started via IPC');
    return true;
  } catch { return false; }
});

ipcMain.handle('stop-tracking', async () => {
  try {
    stopBackgroundMonitoring();
    resetSessionCounters();
    console.log('[Main] Tracking stopped via IPC');
    return true;
  } catch { return false; }
});

// ─── App quit ─────────────────────────────────────────────────────────────────

app.on('before-quit', () => {
  isQuitting = true;
  stopBackgroundMonitoring();
  stopFloatingTimerUpdates();
  stopLocalServer();
  stopScreenshotService();
  stopDailyScheduler();
});

export { mainWindow };
