import { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage, powerMonitor, shell, globalShortcut } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import isDev from 'electron-is-dev';
import dotenv from 'dotenv';
import pg from 'pg';
import * as os from 'os';
import * as crypto from 'crypto';
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
  setOnLogClosedCallback,
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
  setCurrentEmployeeId,
} from './screenshotService.js';
import { startDailyScheduler, stopDailyScheduler, triggerDailySummaryEmails } from './dailyScheduler.js';
import { startTimesheetEnforcer, stopTimesheetEnforcer, checkTimesheetSubmitted, getPreviousWorkingDate, setTimesheetDbUrlGetter, getComplianceDetails, updateEnforcerWindow, getCurrentEmployee } from './timesheetEnforcer.js';
import { supabase } from '../src/lib/supabase.js';
import { createClient } from '@supabase/supabase-js';

// Service-role Supabase client for server-side inserts (bypasses RLS)
const serviceSupabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
);

// Export getTimesheetDbUrl for use in other modules
export { getTimesheetDbUrl };

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let windowLocked = false;
let timesheetBrowserOpen = false;
// In-memory login state — avoids reading disk every 100ms in the focus loop
let currentEmployeeCode: string | null = null;

// ─── Global Shortcut Lock Management ─────────────────────────────────────────
// Blocks Alt+Tab, Win+D, Win+Tab etc. when the system is locked
function registerLockShortcuts() {
  try {
    // Block Alt+Tab (app switching)
    globalShortcut.register('Alt+Tab', () => {});
    // Block raw Windows Key (Super)
    globalShortcut.register('Super', () => {});
    // Block Win+D (show desktop)
    globalShortcut.register('Super+D', () => {});
    // Block Win+Tab (Task View)
    globalShortcut.register('Super+Tab', () => {});
    // Block Win+E (File Explorer)
    globalShortcut.register('Super+E', () => {});
    // Block Ctrl+Escape (Start Menu fallback)
    globalShortcut.register('Ctrl+Escape', () => {});
    // Block Alt+F4
    globalShortcut.register('Alt+F4', () => {});
    console.log('[LockShortcuts] Lock shortcuts registered');
  } catch (err) {
    console.error('[LockShortcuts] Failed to register shortcuts:', err);
  }
}

function unregisterLockShortcuts() {
  try {
    globalShortcut.unregisterAll();
    console.log('[LockShortcuts] Lock shortcuts unregistered');
  } catch (err) {
    console.error('[LockShortcuts] Failed to unregister shortcuts:', err);
  }
}


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
      
      // Force Windows to skip the standard 10-second startup delay for immediate launch
      try {
        execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize" /v "StartupDelayInMSec" /t REG_DWORD /d 0 /f`, { stdio: 'ignore' });
      } catch {}

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
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setVisibleOnAllWorkspaces(false);
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
    show: true, // Show instantly to improve perceived startup time
    minimizable: false,
    maximizable: false,
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

  // Setup tool usage syncing — runs independently of existing tracking
  setOnLogClosedCallback(async (log) => {
    try {
      const emp = getCurrentEmployee();
      if (!emp) return;

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const isApp = log.type === 'app';

      await serviceSupabase.from('employee_tool_usage').insert([{
        employee_id: emp.id,
        employee_name: emp.employee_name,
        employee_code: emp.employee_code,
        tool_name: log.appName || 'Unknown',
        file_name: log.windowTitle || null,
        website: log.website || null,
        start_time: log.startTime,
        end_time: log.endTime || null,
        total_duration_seconds: log.durationSeconds || 0,
        active_duration_seconds: isApp ? (log.durationSeconds || 0) : 0,
        date: today,
      }]);
      console.log('[ToolUsageSync] Logged:', log.appName, log.durationSeconds + 's');
    } catch (err) {
      console.error('[ToolUsageSync] Failed to insert tool usage log:', err);
    }
  });

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

    // Always show, maximize, and bring to front on startup
    mainWindow?.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow?.show();
    mainWindow?.maximize();
    mainWindow?.focus();
    
    // Initialize in-memory employee code from session cache
    currentEmployeeCode = cached?.employee?.employee_code || null;
    console.log('[Startup] currentEmployeeCode:', currentEmployeeCode);

    const isLoggedOut = !currentEmployeeCode;
    if (isLoggedOut) {
      // No active session — show login screen in kiosk mode
      windowLocked = true;
      mainWindow?.setKiosk(true);
      mainWindow?.setAlwaysOnTop(true, 'screen-saver');
      registerLockShortcuts();
    } else {
      // Pop above everything briefly so the user sees the login/plan screen
      mainWindow?.setAlwaysOnTop(true, 'screen-saver');
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(false);
            mainWindow.setVisibleOnAllWorkspaces(false);
          }
        } catch { }
      }, 2000);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Minimise to tray instead of taskbar
  mainWindow.on('minimize', (event: any) => {
    const isLoggedOut = !loadSessionCache()?.employee?.employee_code;
    if (windowLocked || isLoggedOut) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.restore();
      }
    } else {
      mainWindow?.hide();
    }
  });

  mainWindow.on('blur', () => {
    // Only steal focus when explicitly locked — NOT based on disk reads (causes glitching)
    if (windowLocked && !developerMode && !timesheetBrowserOpen) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.setAlwaysOnTop(true, 'screen-saver');
          if (!mainWindow.isKiosk()) mainWindow.setKiosk(true);
        } catch {}
      }
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.setAlwaysOnTop(true, 'screen-saver');
          } catch {}
        }
      }, 50);
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
        if (mainWindow) { 
          mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
          mainWindow.show(); 
          mainWindow.focus(); 
          mainWindow.setVisibleOnAllWorkspaces(false);
        }
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
    if (mainWindow) { 
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.show(); 
      mainWindow.focus(); 
      mainWindow.setVisibleOnAllWorkspaces(false);
    }
  });

  tray.on('double-click', () => {
    if (mainWindow) { 
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.show(); 
      mainWindow.focus(); 
      mainWindow.setVisibleOnAllWorkspaces(false);
    }
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

function logAudit(employeeCode: string, action: string) {
  try {
    const logPath = path.join(app.getPath('userData'), 'agent_audit.log');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] Employee: ${employeeCode} | Action: ${action}\n`;
    fs.appendFileSync(logPath, logEntry, 'utf8');
    console.log(logEntry.trim());
  } catch(e) {
    console.error('[Audit] Failed to write audit log:', e);
  }
}

function resolveIdentity(): { code: string | null, source: string } {
  const cached = loadSessionCache();
  if (cached?.employee?.employee_code) {
    return { code: cached.employee.employee_code, source: 'Session Cache' };
  }
  if (process.env.EMPLOYEE_CODE) {
    return { code: process.env.EMPLOYEE_CODE, source: 'Environment Variable' };
  }
  try {
    const winUser = os.userInfo().username;
    if (winUser) {
      return { code: winUser, source: 'Windows Username' };
    }
  } catch (e) {
    console.error('[Identity] Error getting Windows username:', e);
  }
  return { code: null, source: 'None' };
}

async function getOrCreateDeviceId(): Promise<string> {
  const deviceIdPath = path.join(app.getPath('userData'), 'device_id.txt');
  try {
    if (fs.existsSync(deviceIdPath)) {
      return fs.readFileSync(deviceIdPath, 'utf8').trim();
    }
  } catch (e) {
    console.error('[Device] Error reading device ID', e);
  }
  const newDeviceId = crypto.randomUUID();
  try {
    fs.writeFileSync(deviceIdPath, newDeviceId, 'utf8');
  } catch (e) {
    console.error('[Device] Error writing device ID', e);
  }
  return newDeviceId;
}

async function resolveMachineIdentity(loggedInCode: string | null): Promise<{ code: string | null, source: string }> {
  if (!loggedInCode) return { code: null, source: 'None' };

  const deviceId = await getOrCreateDeviceId();
  const timesheetUrl = process.env.TIMESHEET_DB_URL;
  
  if (!timesheetUrl) return { code: null, source: 'None' };

  try {
    const { Client } = await import('pg');
    const tsClient = new Client({ connectionString: timesheetUrl, ssl: { rejectUnauthorized: false } });
    await tsClient.connect();

    const res = await tsClient.query('SELECT device_id FROM device_registrations WHERE employee_code = $1', [loggedInCode]);

    if (res.rowCount === 0) {
      await tsClient.query('INSERT INTO device_registrations (employee_code, device_id) VALUES ($1, $2)', [loggedInCode, deviceId]);
      await tsClient.end();
      return { code: loggedInCode, source: 'Device Registration (New)' };
    }

    await tsClient.end();
    const registeredDeviceId = res.rows[0].device_id;
    
    if (registeredDeviceId === deviceId) {
      return { code: loggedInCode, source: 'Device Registration (Match)' };
    } else {
      return { code: 'MISMATCH', source: 'Device Registration (Mismatch)' };
    }
  } catch (e) {
    console.error('[Identity] DB Error resolving machine identity:', e);
    return { code: null, source: 'DB Error' };
  }
}

async function logSecurityAnomaly(loggedInCode: string | null, machineCode: string | null, leaveType: string) {
  try {
    const timestamp = new Date().toISOString();
    const deviceName = os.hostname();
    const message = `Credential Sharing Attempt: Login by ${loggedInCode} on device ${deviceName} (Mapped Code: ${machineCode || 'None'}). Employee is on ${leaveType}.`;
    
    console.log(`[SECURITY ANOMALY] ${message}`);
    logAudit(loggedInCode || 'Unknown', `SECURITY ANOMALY: ${message}`);
    
    const timesheetUrl = process.env.TIMESHEET_DB_URL || 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji%4013@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';
    const { Client } = await import('pg');
    const tsClient = new Client({ connectionString: timesheetUrl, ssl: { rejectUnauthorized: false } });
    await tsClient.connect();
    
    const alertId = crypto.randomUUID();
    const dateStr = new Date().toISOString().split('T')[0];
    
    await tsClient.query(`
      INSERT INTO alerts (id, type, message, employee_id, date, created_at, is_read)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [alertId, 'SECURITY_ANOMALY', message, loggedInCode, dateStr, timestamp, false]);
    
    await tsClient.end();
  } catch (err) {
    console.error('[Security] Failed to log anomaly:', err);
  }
}

async function checkSkipConditions(identity: { code: string | null, source: string }): Promise<string | null> {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);
  const dayOfWeek = istDate.getDay();
  const dateStr = istDate.getFullYear() + '-' + String(istDate.getMonth()+1).padStart(2, '0') + '-' + String(istDate.getDate()).padStart(2, '0');

  let skipReason: string | null = null;
  let anomalyDetected = false;
  const machineIdentity = await resolveMachineIdentity(identity.code);

  // Anomaly: device doesn't match the registered machine for this employee
  if (machineIdentity.source === 'Device Registration (Mismatch)') {
    anomalyDetected = true;
  }
  // Legacy check for Session Cache-based identity
  if (identity.source === 'Session Cache') {
    if (!machineIdentity.code || machineIdentity.code === 'MISMATCH') {
      anomalyDetected = true;
    }
  }

  // 1. Check if Sunday
  if (dayOfWeek === 0) {
    skipReason = 'Agent Skipped: Sunday';
  }

  // 2. Check LMS database for Approved Leave / Permission
  else if (identity.code) {
    const lmsUrl = process.env.LMS_DB_URL;
    if (lmsUrl) {
      const { Client } = await import('pg');
      const client = new Client({ connectionString: lmsUrl, ssl: { rejectUnauthorized: false } });
      try {
        await client.connect();
        
        // Check for full-day leaves
        // Dates stored as UTC midnight = 18:30 prev day UTC for IST.
        // Convert stored timestamps to IST date for comparison.
        const leaveQuery = `
          SELECT status, leave_type FROM leaves 
          WHERE user_id = $1 
          AND status = 'Approved' 
          AND DATE(start_date AT TIME ZONE 'Asia/Kolkata') <= $2::date
          AND DATE(end_date AT TIME ZONE 'Asia/Kolkata') >= $2::date
        `;
        const leaveResult = await client.query(leaveQuery, [identity.code, dateStr]);
        if (leaveResult.rows.length > 0) {
          const leaveType = leaveResult.rows[0].leave_type || 'Leave';
          const isCompOff = leaveType.toLowerCase().includes('comp off');
          if (anomalyDetected) {
            await logSecurityAnomaly(identity.code, machineIdentity.code, `Approved ${isCompOff ? 'Comp Off' : 'Leave'}`);
            skipReason = null; // Deny exemption, continue monitoring!
          } else {
            skipReason = `Agent Skipped: Approved ${isCompOff ? 'Comp Off' : 'Leave'} (${leaveType})`;
          }
        }

        // Check for intra-day permissions
        if (!skipReason && !anomalyDetected) {
          const permQuery = `
            SELECT from_time, to_time FROM permissions
            WHERE user_id = $1
            AND status = 'Approved'
            AND DATE(permission_date) = $2
          `;
          const permResult = await client.query(permQuery, [identity.code, dateStr]);
          
          if (permResult.rows.length > 0) {
            const currentHours = istDate.getHours();
            const currentMinutes = istDate.getMinutes();
            const currentSeconds = istDate.getSeconds();
            const currentTotalSeconds = currentHours * 3600 + currentMinutes * 60 + currentSeconds;

            for (const row of permResult.rows) {
               if (row.from_time && row.to_time) {
                  const [fh, fm, fsVal] = row.from_time.split(':').map(Number);
                  const [th, tm, tsVal] = row.to_time.split(':').map(Number);
                  const fromTotal = fh * 3600 + fm * 60 + (fsVal || 0);
                  const toTotal = th * 3600 + tm * 60 + (tsVal || 0);

                  if (currentTotalSeconds >= fromTotal && currentTotalSeconds <= toTotal) {
                     if (anomalyDetected) {
                       await logSecurityAnomaly(identity.code, machineIdentity.code, 'Approved Permission');
                       skipReason = null;
                     } else {
                       skipReason = 'Agent Skipped: Approved Permission';
                     }
                     break;
                  }
               }
            }
          }
        } else if (!skipReason && anomalyDetected) {
          // If anomaly is detected but no leave was found, we still check permissions to see if they are abusing it
          const permQuery = `
            SELECT from_time, to_time FROM permissions
            WHERE user_id = $1
            AND status = 'Approved'
            AND DATE(permission_date) = $2
          `;
          const permResult = await client.query(permQuery, [identity.code, dateStr]);
          if (permResult.rows.length > 0) {
            const currentHours = istDate.getHours();
            const currentMinutes = istDate.getMinutes();
            const currentSeconds = istDate.getSeconds();
            const currentTotalSeconds = currentHours * 3600 + currentMinutes * 60 + currentSeconds;

            for (const row of permResult.rows) {
               if (row.from_time && row.to_time) {
                  const [fh, fm, fsVal] = row.from_time.split(':').map(Number);
                  const [th, tm, tsVal] = row.to_time.split(':').map(Number);
                  const fromTotal = fh * 3600 + fm * 60 + (fsVal || 0);
                  const toTotal = th * 3600 + tm * 60 + (tsVal || 0);

                  if (currentTotalSeconds >= fromTotal && currentTotalSeconds <= toTotal) {
                     await logSecurityAnomaly(identity.code, machineIdentity.code, 'Approved Permission');
                     skipReason = null; // Deny
                     break;
                  }
               }
            }
          }
        }
      } catch (err) {
        console.error('[LeaveCheck] Error checking LMS DB:', err);
      } finally {
        await client.end();
      }
    }
  }

  console.log('\n--- Intra-Day Debug Logs ---');
  console.log(`IST Timestamp: ${istString}`);
  console.log(`Identity Source Used: ${identity.source}`);
  console.log(`Employee Code Resolved: ${identity.code || 'None'}`);
  console.log(`Machine Code Detected: ${machineIdentity.code || 'None'}`);
  console.log(`Security Anomaly Status: ${anomalyDetected ? 'DETECTED' : 'CLEAN'}`);
  console.log(`LMS Skip Decision: ${skipReason || 'None (Normal Working Day)'}`);
  console.log('----------------------------\n');

  return skipReason;
}

let isAgentRunning = false;
let resumptionInterval: NodeJS.Timeout | null = null;
let lastSkipReason: string | null = null;

async function startAgent() {
  if (isAgentRunning) return;
  isAgentRunning = true;
  
  console.log('[Agent] Starting normal operation...');
  
  // Initialize timesheet enforcer with URL getter
  setTimesheetDbUrlGetter(getTimesheetDbUrl);

  if (mainWindow === null || mainWindow.isDestroyed()) {
    await createWindow();
  } else {
    mainWindow.show();
    mainWindow.maximize();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(false);
      }
    }, 2000);
  }

  // Always update the enforcer's window reference in case window was recreated
  updateEnforcerWindow(mainWindow);

  const cached = loadSessionCache();
  const empCode = cached?.employee?.employee_code || null;
  if (empCode && mainWindow && !mainWindow.isDestroyed()) {
    startTimesheetEnforcer(empCode, mainWindow);
  }

  // Create the floating timer window (hidden until session starts)
  createFloatingTimerWindow();

  if (!tray || tray.isDestroyed()) {
    try { createTray(); } catch (e) { console.error('Tray creation failed:', e); }
  }

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
}

async function stopAgent() {
  if (!isAgentRunning) return;
  isAgentRunning = false;
  console.log('[Agent] Stopping normal operation...');

  stopBackgroundMonitoring();
  stopFloatingTimerUpdates();
  stopLocalServer();
  stopScreenshotService();
  stopDailyScheduler();
  stopTimesheetEnforcer();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

let lastCheckedDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function setupResumptionCheck() {
  if (resumptionInterval) return;
  console.log('[Agent] Starting lightweight background resume poller...');
  
  // Check every 1 minute (60000 ms)
  resumptionInterval = setInterval(async () => {
    // 1. Midnight Sign-Out Check
    const currentDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (currentDate !== lastCheckedDate) {
      console.log('[Midnight] Date changed from', lastCheckedDate, 'to', currentDate, '- forcing sign out');
      lastCheckedDate = currentDate;
      
      await stopAgent();
      clearSessionCache();
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setVisibleOnAllWorkspaces(false);
      }
      return; // Stop processing and wait for fresh login
    }

    // 2. Normal Poller Logic
    const identity = resolveIdentity();
    const skipReason = await checkSkipConditions(identity);
    
    if (skipReason !== lastSkipReason) {
      if (skipReason) {
        logAudit(identity.code || 'Unknown', skipReason);
        await stopAgent();
      } else {
        logAudit(identity.code || 'Unknown', 'Agent Resumed: Working Day');
        await startAgent();
      }
      lastSkipReason = skipReason;
    }
  }, 60 * 1000);
}

// ─── App ready ────────────────────────────────────────────────────────────────
app.on('ready', async () => {
  if (!gotLock) return;

  console.log('[App] Ready event fired');
  console.log(`[App] isDev: ${isDev}, isPackaged: ${app.isPackaged}`);
  console.log(`[App] App path: ${app.getAppPath()}`);

  const identity = resolveIdentity();
  const skipReason = await checkSkipConditions(identity);
  lastSkipReason = skipReason;

  if (skipReason) {
    console.log(`[Startup] ${skipReason}`);
    logAudit(identity.code || 'Unknown', skipReason);
  } else {
    await startAgent();
  }

  // Focus-stealing loop — only runs when windowLocked is explicitly true
  // Does NOT read from disk (avoids glitching when user is working normally)
  setInterval(() => {
    if (developerMode) return;
    if (timesheetBrowserOpen) return;
    if (!windowLocked) return; // Only lock when explicitly told to by the renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (!mainWindow.isFocused()) {
          mainWindow.show();
          mainWindow.focus();
        }
        if (!mainWindow.isAlwaysOnTop()) {
          mainWindow.setAlwaysOnTop(true, 'screen-saver');
        }
        if (!mainWindow.isKiosk()) {
          mainWindow.setKiosk(true);
        }
      } catch {}
    }

    // Force close Start Menu if it tries to open while locked
    if (process.platform === 'win32') {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
          const { exec } = require('child_process');
          exec('taskkill /IM StartMenuExperienceHost.exe /F', { windowsHide: true }, () => {});
        }
      } catch {}
    }
  }, 100);

  // --- Watchdog via WMI (survives Task Manager End Task — runs in WMI service tree) ---
  try {
    if (app.isPackaged) {
      const exePath = process.execPath;
      const exeName = path.basename(exePath); // e.g. "Knockturn Employee Agent.exe"
      const watchdogPath = path.join(app.getPath('userData'), 'watchdog.vbs');

      // Self-contained VBS — no args, paths hard-coded, Chr(34) handles spaces in exePath
      const watchdogScript = [
        'Set objShell = CreateObject("WScript.Shell")',
        'Set objWMI = GetObject("winmgmts:\\\\.\\root\\cimv2")',
        'WScript.Sleep 3000',
        'Do',
        '    WScript.Sleep 2000',
        `    Set procs = objWMI.ExecQuery("SELECT * FROM Win32_Process WHERE Name = '${exeName.replace(/'/g, "''")}'")`,
        '    If procs.Count = 0 Then',
        `        objShell.Run Chr(34) & "${exePath.replace(/\\/g, '\\\\').replace(/"/g, '""')}" & Chr(34), 1, False`,
        '        WScript.Quit',
        '    End If',
        'Loop',
      ].join('\r\n');

      fs.writeFileSync(watchdogPath, watchdogScript, 'utf8');
      console.log('[Watchdog] VBS written to:', watchdogPath);
      console.log('[Watchdog] Monitoring exe:', exeName);

      // Launch via PowerShell WMI — creates process UNDER WMI service, not Electron
      // This is the only reliable way to escape a Windows Job Object without admin rights
      const { spawn } = require('child_process');
      const wmiFn = `([wmiclass]'Win32_Process').Create('wscript.exe /nologo "${watchdogPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"')`;
      const wdog = spawn('powershell.exe', [
        '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', wmiFn
      ], { detached: true, windowsHide: true, stdio: 'ignore' });
      wdog.unref();
      console.log('[Watchdog] WMI watchdog spawn issued');
    }
  } catch (err) {
    console.error('[Watchdog] Failed to setup watchdog:', err);
  }
  // -------------------------------------------------------------------------------------


  // ALWAYS run the poller to handle intra-day transitions (like permissions)
  setupResumptionCheck();

  powerMonitor.on('suspend', () => {
    console.log('[Power] System suspending...');
    // Agent stays as-is (will be frozen by OS). Poller handles things later.
  });

  powerMonitor.on('resume', async () => {
    console.log('[Power] System resuming...');
    // Ensure that if it's a new day or skip condition changed while asleep, it takes effect instantly
    const identity = resolveIdentity();
    const skipReason = await checkSkipConditions(identity);
    lastSkipReason = skipReason;

    if (skipReason) {
      console.log(`[PowerResume] ${skipReason}`);
      logAudit(identity.code || 'Unknown', skipReason);
      await stopAgent();
    } else {
      console.log('[PowerResume] Resuming normal operations...');
      await startAgent();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!isAgentRunning) return;
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setVisibleOnAllWorkspaces(false);
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
    if (mainWindow && !developerMode) {
      mainWindow.setKiosk(true);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.show();
      mainWindow.focus();
      registerLockShortcuts();
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('exit-kiosk', async () => {
  try {
    if (mainWindow) {
      mainWindow.setKiosk(false);
      mainWindow.setAlwaysOnTop(false);
      unregisterLockShortcuts();
      if (isAgentRunning) { mainWindow.show(); mainWindow.focus(); }
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('show-water-reminder', async () => {
  try { showGlobalWaterReminder(); return true; } catch { return false; }
});

ipcMain.handle('show-e0048-reminder', async (_event, message: string) => {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Activity Reminder',
        body: message,
        icon: path.join(__dirname, '../public/icon.ico') // Fallback icon
      }).show();
    }
    return true;
  } catch (err) {
    console.error('Failed to show E0048 reminder:', err);
    return false;
  }
});

ipcMain.handle('request-show-window', async () => {
  try {
    if (mainWindow && isAgentRunning) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.show();
      mainWindow.moveTop();
      mainWindow.focus();
      // Keep on top briefly so it pops above everything (even fullscreen apps)
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      setTimeout(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(false);
            mainWindow.setVisibleOnAllWorkspaces(false);
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
ipcMain.handle('reset-session-counters', async () => {
  try {
    resetSessionCounters();
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

ipcMain.handle('set-current-employee', async (_, employeeId: string | null) => {
  try {
    setCurrentEmployeeId(employeeId);
    return true;
  } catch (e) {
    console.error('[IPC] Failed to set current employee ID for screenshots:', e);
    return false;
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
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.show();
      mainWindow.restore();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setVisibleOnAllWorkspaces(false);
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

let developerMode = false;

ipcMain.handle('toggle-developer-mode', () => {
  developerMode = !developerMode;
  console.log('[DevMode] Toggled to:', developerMode);
  
  if (developerMode) {
    mainWindow?.setKiosk(false);
    mainWindow?.setAlwaysOnTop(false);
    unregisterLockShortcuts();
  } else {
    // Restore based on state
    const isLoggedOut = !loadSessionCache()?.employee?.employee_code;
    if (windowLocked || isLoggedOut) {
      mainWindow?.setKiosk(true);
      mainWindow?.setAlwaysOnTop(true, 'screen-saver');
      registerLockShortcuts();
    }
  }
  return developerMode;
});

ipcMain.handle('close-window', async () => {
  try {
    if (mainWindow) { isQuitting = true; mainWindow.close(); }
    return true;
  } catch { return false; }
});

// Explicit state tracking to avoid Electron Windows async state bugs
let _isClosable = true;
let _isMinimizable = true;

ipcMain.handle('set-window-minimizable', async (_, minimizable: boolean) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setMinimizable(minimizable);
    _isMinimizable = minimizable;
    if (!developerMode) {
      if (minimizable) {
        mainWindow.setKiosk(false);
        mainWindow.setAlwaysOnTop(false);
        unregisterLockShortcuts();
      } else {
        mainWindow.setKiosk(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        registerLockShortcuts();
      }
    }
    windowLocked = !(_isClosable && _isMinimizable);
  }
});

ipcMain.handle('set-window-closable', async (_, closable: boolean) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(closable);
    _isClosable = closable;
    if (!developerMode) {
      if (closable) {
        mainWindow.setKiosk(false);
        mainWindow.setAlwaysOnTop(false);
        unregisterLockShortcuts();
      } else {
        mainWindow.setKiosk(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        registerLockShortcuts();
      }
    }
    windowLocked = !(_isClosable && _isMinimizable);
  }
  return true;
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
    console.error('[TimesheetIPC] open-timesheet-browser: no TIMESHEET_URL configured');
    return false;
  }

  try {
    // Temporarily exit kiosk on mainWindow so the timesheet window can be shown
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setKiosk(false);
      mainWindow.setAlwaysOnTop(false);
      // DO NOT unregisterLockShortcuts() — we still want to block Alt+Tab, Start menu, etc.
    }

    const timesheetWin = new BrowserWindow({
      width: 1280,
      height: 900,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      kiosk: true, // Make timesheet window kiosk so taskbar is hidden
      show: false,
      title: 'TimeStrap — Fill Your Timesheet',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    timesheetWin.maximize();
    timesheetWin.loadURL(timesheetUrl);
    timesheetBrowserOpen = true;
    timesheetWin.once('ready-to-show', () => {
      timesheetWin.show();
      timesheetWin.focus();
    });

    // Aggressive focus stealing for the timesheet window
    timesheetWin.on('blur', () => {
      if (developerMode) return;
      if (timesheetWin && !timesheetWin.isDestroyed()) {
        try {
          timesheetWin.show();
          timesheetWin.focus();
          timesheetWin.setAlwaysOnTop(true, 'screen-saver');
          if (!timesheetWin.isKiosk()) timesheetWin.setKiosk(true);
        } catch {}
      }
    });

    const timesheetFocusLoop = setInterval(() => {
      if (developerMode) return;
      if (timesheetWin && !timesheetWin.isDestroyed()) {
        try {
          if (!timesheetWin.isFocused()) {
            timesheetWin.show();
            timesheetWin.focus();
          }
          if (!timesheetWin.isAlwaysOnTop()) {
            timesheetWin.setAlwaysOnTop(true, 'screen-saver');
          }
          if (!timesheetWin.isKiosk()) {
            timesheetWin.setKiosk(true);
          }
        } catch {}
      }
    }, 100);

    // When employee closes the timesheet window, re-lock the main window
    timesheetWin.on('closed', () => {
      clearInterval(timesheetFocusLoop);
      timesheetBrowserOpen = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setKiosk(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.show();
        mainWindow.focus();
        registerLockShortcuts();
      }
    });

    return true;
  } catch (error) {
    console.error('[TimesheetIPC] open-timesheet-browser failed:', error);
    // Re-lock if anything fails
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setKiosk(true);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      registerLockShortcuts();
    }
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
  try { 
    saveSessionCache(data);
    // Update in-memory login state so the focus loop knows the user is logged in
    currentEmployeeCode = data?.employee?.employee_code || null;
    console.log('[Session] currentEmployeeCode set to:', currentEmployeeCode);
    
    // Immediate post-login LMS validation
    const identity = resolveIdentity();
    if (identity.code) {
      checkSkipConditions(identity).then(async (skipReason) => {
        if (skipReason) {
          console.log(`[Post-Login Check] ${skipReason}`);
          logAudit(identity.code || 'Unknown', skipReason);
          lastSkipReason = skipReason;
          await stopAgent();
        }
      }).catch(err => {
        console.error('[Post-Login Check] Error during validation:', err);
      });
    }
    
    return true; 
  } catch { return false; }
});

ipcMain.handle('load-session-cache', async () => {
  try { return loadSessionCache(); } catch { return null; }
});

ipcMain.handle('clear-session-cache', async () => {
  try {
    clearSessionCache();
    currentEmployeeCode = null; // Clear in-memory login state
    console.log('[Session] currentEmployeeCode cleared');
    return true;
  } catch { return false; }
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
  const timestrapDbUrl = 'postgresql://postgres.cwjkvasixpmieeuaield:Rebecasuji%4013@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';
  
  console.log('\n[TimesheetDB] check-timesheet-db called for:', employeeCode);
  console.log('[TimesheetDB] Using TIMESTRAP_DATABASE_URL explicitly for Plan of the Day step 3 verification.');
  
  const { Client } = pg;
  const client = new Client({
    connectionString: timestrapDbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('[TimesheetDB] ✓ Connected to TimeStrap database');

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

    // Check daily_plans ONLY
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
  const timestrapDbUrl = 'postgresql://postgres.cwjkvasixpmieeuaield:Rebecasuji%4013@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';
  const result: any = {
    ok: false,
    timesheetDbUrl: true,
    employeeCode,
    details: {},
    errors: [],
    configStatus: {
      urlLoaded: true,
      connectionAttempted: false,
      connectionSuccess: false
    }
  };

  console.log(`[TimesheetDB DEBUG] Starting diagnosis for employee: ${employeeCode}`);
  console.log('[TimesheetDB DEBUG] Using TIMESTRAP_DATABASE_URL explicitly for Plan of the Day step 3 verification.');

  const { Client } = pg;
  const client = new Client({
    connectionString: timestrapDbUrl,
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

    // ONLY Check daily_plans
    try {
      const planRes = await client.query(`SELECT id FROM daily_plans WHERE employee_id = $1 AND "date" = $2`, [employeeId, today]);
      result.details.daily_plans = planRes.rows.length;
      console.log('[TimesheetDB DEBUG] daily_plans found:', planRes.rows.length);
    } catch (e) {
      result.errors.push('daily_plans check failed: ' + ((e as any).message || e));
    }

    result.ok = (result.details.daily_plans || 0) > 0;
    console.log('[TimesheetDB DEBUG] Final result:', {
      submitted: result.ok,
      daily_plans: result.details.daily_plans
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
