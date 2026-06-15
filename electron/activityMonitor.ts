import { app, powerMonitor, BrowserWindow, Notification } from 'electron';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { showIdlePromptWindow } from './idlePromptWindow.js';

let activeWinModule: any | null = null;
let siModule: any | null = null;

export type ActivityState = 'productive' | 'idle' | 'away' | 'non_productive' | 'neutral';

export interface WindowInfo {
  appName: string;
  windowTitle: string;
  website?: string;
}

export interface SystemActivity {
  activeWindow: WindowInfo;
  idleTimeMs: number;
  systemIdleSeconds: number;
  isIdle: boolean;
  state: ActivityState;
  activeSeconds: number;
  productiveSeconds: number;
  idleSeconds: number;
  awaySeconds: number;
  sessionSeconds: number;
  lastActivityAt: string;
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
}

export interface ActivityLog {
  appName: string;
  windowTitle: string;
  website?: string;
  type: 'app' | 'idle' | 'away';
  productive: boolean;
  startTime: string;
  endTime?: string;
  durationSeconds: number;
  cpuUsage?: number;
  memoryUsage?: number;
}

let idleThresholdSeconds = 60 * 10; // Default 10 minutes
const activityFileName = 'activity-logs.json';

// Track the current date for midnight rollover detection
let currentTrackingDate: string = new Date().toISOString().slice(0, 10);

// Health reminder interval reference so we can clear it on stop
let healthReminderInterval: NodeJS.Timeout | null = null;
const maxStoredLogs = 200;

// Browser URL events received from Chrome extension or local server
let lastBrowserUrl: { url: string; title: string } | null = null;

export function updateBrowserUrl(url: string, title: string) {
  lastBrowserUrl = { url, title };
}

// Dynamic app classifications
const appClassifications = new Map<string, 'productive' | 'non_productive' | 'neutral'>();

export function updateIdleTimeout(minutes: number) {
  idleThresholdSeconds = Math.max(1, minutes) * 60;
  console.log(`[Monitor] Updated idle threshold to ${idleThresholdSeconds} seconds`);
}

export function updateAppClassifications(classifications: Array<{ name: string; classification: 'productive' | 'non_productive' | 'neutral' }>) {
  appClassifications.clear();
  classifications.forEach(c => {
    appClassifications.set(c.name, c.classification);
  });
  console.log(`[Monitor] Updated classifications map. Count: ${appClassifications.size}`);
}

let currentActivityWindow: BrowserWindow | null = null;
let monitorInterval: NodeJS.Timeout | null = null;
let monitoringStarted = false;
let mainProcessIdlePrompted = false;
let isIdleModalActive = false;
let lastInputTime = Date.now();
let isRefreshInProgress = false;
let currentLog: ActivityLog | null = null;
let activityLogs: ActivityLog[] = [];

// System metrics cache
let lastCpuUsage = 0;
let lastMemoryUsage = 0;

const psScriptPath = path.join(app.getPath('userData'), 'getActiveWindow.ps1');

const psScriptContent = `$definition = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

try {
    Add-Type -TypeDefinition $definition -ErrorAction SilentlyContinue
} catch {}

$hwnd = [Win32]::GetForegroundWindow()
if ($hwnd -and $hwnd -ne [IntPtr]::Zero) {
    $title = New-Object System.Text.StringBuilder 512
    [Win32]::GetWindowText($hwnd, $title, 512) | Out-Null
    
    $processId = [uint32]0
    [Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
    
    if ($processId -gt 0) {
        $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Output "$($proc.ProcessName)|$($title.ToString())"
        }
    }
}`;

function writePsScriptIfNotExist() {
  try {
    fs.writeFileSync(psScriptPath, psScriptContent, { encoding: 'utf8' });
  } catch (err) {
    console.error('Failed to write getActiveWindow.ps1:', err);
  }
}

// PowerShell fallback (cached 1s)
let _fallbackTs = 0;
let _fallbackCache: { ownerName: string; windowTitle: string } = { ownerName: 'Unknown', windowTitle: 'Unknown' };

function getWindowViaFallback(): { ownerName: string; windowTitle: string } {
  const now = Date.now();
  if (now - _fallbackTs < 1000) return _fallbackCache;
  _fallbackTs = now;
  try {
    const raw = execSync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psScriptPath}"`,
      { timeout: 800, encoding: 'utf8', windowsHide: true }
    ).trim();

    if (raw && raw.includes('|')) {
      const sep = raw.indexOf('|');
      _fallbackCache = {
        ownerName: raw.slice(0, sep).trim(),
        windowTitle: raw.slice(sep + 1).trim(),
      };
    }
  } catch {
    // keep previous cache
  }
  return _fallbackCache;
}

// Load systeminformation module lazily
async function getSysInfo(): Promise<{ cpu: number; mem: number }> {
  try {
    if (!siModule) {
      siModule = await import('systeminformation');
    }
    const [cpuLoad, mem] = await Promise.all([
      siModule.currentLoad(),
      siModule.mem(),
    ]);
    lastCpuUsage = Math.round(cpuLoad.currentLoad ?? 0);
    lastMemoryUsage = Math.round(((mem.used ?? 0) / (mem.total ?? 1)) * 100);
  } catch {
    // keep cached values
  }
  return { cpu: lastCpuUsage, mem: lastMemoryUsage };
}

// Update sys metrics every 10 seconds (not on every tick)
let sysMetricsCounter = 0;

const activityState: SystemActivity = {
  activeWindow: { appName: 'Unknown', windowTitle: 'Unknown' },
  idleTimeMs: 0,
  systemIdleSeconds: 0,
  isIdle: false,
  state: 'away',
  activeSeconds: 0,
  productiveSeconds: 0,
  idleSeconds: 0,
  awaySeconds: 0,
  sessionSeconds: 0,
  lastActivityAt: new Date().toISOString(),
  timestamp: new Date().toISOString(),
  cpuUsage: 0,
  memoryUsage: 0,
};

const dataPath = path.join(app.getPath('userData'), activityFileName);

function loadLogsFromDisk() {
  try {
    if (fs.existsSync(dataPath)) {
      const content = fs.readFileSync(dataPath, { encoding: 'utf8' });
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) activityLogs = parsed.slice(-maxStoredLogs);
    }
  } catch (error) {
    console.error('Failed to load activity logs:', error);
  }
}

function saveLogsToDisk() {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(activityLogs.slice(-maxStoredLogs), null, 2), { encoding: 'utf8' });
  } catch (error) {
    console.error('Failed to save activity logs:', error);
  }
}

function normalizeAppName(raw?: string): string {
  if (!raw) return 'Unknown';
  const s = raw.replace(/\.exe$/i, '').replace(/^Microsoft\s+/i, '').trim();
  if (/chrome/i.test(s))   return 'Chrome';
  if (/edge/i.test(s))     return 'Microsoft Edge';
  if (/firefox/i.test(s))  return 'Firefox';
  if (/brave/i.test(s))    return 'Brave';
  if (/safari/i.test(s))   return 'Safari';
  if (/\bcode\b/i.test(s)) return 'VS Code';
  if (/electron|knockturn/i.test(s)) return 'Knockturn Agent';
  if (/teams/i.test(s))    return 'Teams';
  if (/slack/i.test(s))    return 'Slack';
  if (/zoom/i.test(s))     return 'Zoom';
  if (/excel/i.test(s))    return 'Excel';
  if (/winword/i.test(s))  return 'Word';
  if (/powerpnt/i.test(s)) return 'PowerPoint';
  if (/outlook/i.test(s))  return 'Outlook';
  if (/powershell|windowsterminal|cmd\.exe/i.test(s)) return 'Terminal';
  return s || 'Unknown';
}

function parseWebsite(appName: string, title: string): string | undefined {
  // If we have browser URL from extension, use it
  if (lastBrowserUrl) {
    try {
      const u = new URL(lastBrowserUrl.url);
      return u.hostname.replace(/^www\./, '');
    } catch {}
  }

  if (!title) return undefined;
  const browsers = ['Chrome', 'Microsoft Edge', 'Firefox', 'Brave', 'Safari', 'Browser'];
  if (!browsers.includes(appName)) return undefined;

  const cleaned = title
    .replace(/( - Google Chrome| - Microsoft Edge| - Mozilla Firefox| - Brave| - Apple Safari)$/i, '')
    .trim();
  if (!cleaned || /^(new tab|about:blank)$/i.test(cleaned)) return undefined;

  const domainMatch = cleaned.match(/([\w-]+\.[a-z]{2,})(\/\S*)?/i);
  if (domainMatch) return domainMatch[1];

  const parts = cleaned.split(' - ').map(p => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

function closeCurrentLog(endTime: Date) {
  if (!currentLog) return;
  currentLog.endTime = endTime.toISOString();
  const dur = Math.max(1, Math.floor((endTime.getTime() - new Date(currentLog.startTime).getTime()) / 1000));
  currentLog.durationSeconds = dur;
  currentLog.cpuUsage = lastCpuUsage;
  currentLog.memoryUsage = lastMemoryUsage;
  activityLogs.unshift(currentLog);
  if (activityLogs.length > maxStoredLogs) activityLogs = activityLogs.slice(0, maxStoredLogs);
  saveLogsToDisk();
  currentLog = null;
}

function startNewLog(appName: string, windowTitle: string, productive: boolean, type: ActivityLog['type'], website?: string) {
  const now = new Date();
  closeCurrentLog(now);
  currentLog = { appName, windowTitle, website, type, productive, startTime: now.toISOString(), durationSeconds: 0 };
}

function getProductiveState(appName: string, isIdle: boolean, website?: string): ActivityState {
  if (isIdle) return 'idle';
  if (!appName || appName === 'Unknown') return 'away';
  if (appName === 'Knockturn Agent') return 'productive';
  
  // 1. Check website classification if website is provided
  if (website) {
    const webClassification = appClassifications.get(website);
    if (webClassification) return webClassification;

    // Check substring match for websites (e.g. key 'youtube.com' matches website 'www.youtube.com' or 'youtube.com/watch')
    for (const [key, val] of appClassifications.entries()) {
      if (website.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(website.toLowerCase())) {
        return val;
      }
    }
  }

  // 2. Check direct app name classification
  const classification = appClassifications.get(appName);
  if (classification) return classification;

  // Check substring match for app names (e.g. key 'VS Code' matches appName 'Visual Studio Code')
  for (const [key, val] of appClassifications.entries()) {
    if (appName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(appName.toLowerCase())) {
      return val;
    }
  }

  // Default classifications if not configured:
  const lowerApp = appName.toLowerCase();
  if (lowerApp.includes('chrome') || lowerApp.includes('edge') || lowerApp.includes('firefox') || lowerApp.includes('brave') || lowerApp.includes('safari')) {
    return 'neutral';
  }

  const defaultProductive = ['vs code', 'visual studio code', 'code', 'figma', 'excel', 'word', 'slack', 'teams'];
  if (defaultProductive.some(p => lowerApp.includes(p))) {
    return 'productive';
  }

  return 'neutral'; // Fallback to neutral
}

// Promise with timeout to prevent hanging
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

function sendStateUpdate() {
  if (currentActivityWindow?.webContents && !currentActivityWindow.webContents.isDestroyed()) {
    const stateToSend = isIdleModalActive ? { ...activityState, state: 'idle' as const } : activityState;
    currentActivityWindow.webContents.send('activity-update', stateToSend);
  }
}

async function refreshActivity() {
  // Prevent overlapping executions to avoid timer getting stuck
  if (isRefreshInProgress) return;
  isRefreshInProgress = true;

  try {
    // Midnight rollover: if the date changed, reset counters for the new day
    const todayStr = new Date().toISOString().slice(0, 10);
    if (todayStr !== currentTrackingDate) {
      console.log(`[Monitor] Day changed from ${currentTrackingDate} to ${todayStr} G�� resetting counters`);
      resetSessionCounters();
      currentTrackingDate = todayStr;
    }

    let ownerName = 'Unknown';
    let windowTitle = 'Unknown';

    // Primary: active-win (most reliable, no external service needed)
    try {
      if (!activeWinModule) {
        activeWinModule = await import('active-win');
      }
      let active: any = null;
      try {
        // Add timeout of 800ms to prevent hanging
        active = await withTimeout(
          activeWinModule.activeWindow(),
          800,
          null
        );
      } catch {
        if (typeof activeWinModule.activeWindowSync === 'function') {
          try {
            active = activeWinModule.activeWindowSync();
          } catch {
            active = null;
          }
        }
      }

      if (active?.owner?.name) {
        ownerName = normalizeAppName(active.owner.name);
        windowTitle = active.title || 'Unknown';
      }
    } catch (err) {
      console.warn('[Monitor] active-win failed, using PowerShell fallback');
    }

    // Fallback: PowerShell Win32 API
    if (ownerName === 'Unknown' || ownerName === '') {
      const fb = getWindowViaFallback();
      ownerName = normalizeAppName(fb.ownerName);
      windowTitle = fb.windowTitle || 'Unknown';
    }

    // Update system metrics every 10 ticks (~10s)
    sysMetricsCounter++;
    if (sysMetricsCounter >= 10) {
      sysMetricsCounter = 0;
      getSysInfo().catch(() => {});
    }

    const website = parseWebsite(ownerName, windowTitle);
    const systemIdleSeconds = powerMonitor.getSystemIdleTime();
    const now = Date.now();
    let isIdle = systemIdleSeconds >= idleThresholdSeconds;
    
    // Force idle state if the modal is currently active, so that all activity
    // during the prompt is correctly logged as idle until dismissed.
    if (isIdleModalActive) {
      isIdle = true;
    }

    const state = isIdleModalActive ? 'idle' : getProductiveState(ownerName, isIdle, website);

    if (isIdle) {
      if (!mainProcessIdlePrompted) {
        mainProcessIdlePrompted = true;
        showIdlePromptWindow(Date.now() - (activityState.idleSeconds * 1000));
      }
    } else {
      mainProcessIdlePrompted = false;
    }

    if (!isIdle) lastInputTime = now;

    const logType: ActivityLog['type'] = isIdle ? 'idle' : (!ownerName || ownerName === 'Unknown') ? 'away' : 'app';
    const shouldUpdate =
      !currentLog ||
      currentLog.appName !== ownerName ||
      currentLog.windowTitle !== windowTitle ||
      currentLog.type !== logType;

    if (shouldUpdate) {
      startNewLog(ownerName, windowTitle, state === 'productive', logType, website);
    }

    activityState.activeWindow = { appName: ownerName, windowTitle, website };
    activityState.systemIdleSeconds = systemIdleSeconds;
    activityState.idleTimeMs = Math.floor(systemIdleSeconds * 1000);
    activityState.isIdle = isIdle;
    activityState.state = state;
    activityState.lastActivityAt = new Date(lastInputTime).toISOString();
    activityState.timestamp = new Date().toISOString();
    activityState.cpuUsage = lastCpuUsage;
    activityState.memoryUsage = lastMemoryUsage;

    activityState.sessionSeconds += 1;
    if (state === 'productive' || state === 'non_productive' || state === 'neutral') activityState.activeSeconds += 1;
    if (state === 'productive') activityState.productiveSeconds += 1;
    if (state === 'idle')       activityState.idleSeconds += 1;
    if (state === 'away')       activityState.awaySeconds += 1;

    sendStateUpdate();
  } catch (error) {
    console.error('Error refreshing activity state:', error);
  } finally {
    isRefreshInProgress = false;
  }
}

// G��G�� Exported helpers G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��

export function setActivityMonitorWindow(window: BrowserWindow) {
  currentActivityWindow = window;
}

export function setIdleModalActive(active: boolean) {
  isIdleModalActive = active;
  console.log(`[Monitor] Idle modal active status set to: ${active}`);
}

export function getCurrentActivity(): SystemActivity {
  if (isIdleModalActive) {
    return { ...activityState, state: 'idle' };
  }
  return activityState;
}

export function getActivityLogs(): ActivityLog[] {
  if (currentLog) return [currentLog, ...activityLogs].slice(0, maxStoredLogs);
  return activityLogs.slice(0, maxStoredLogs);
}

export function resetSessionCounters() {
  activityState.sessionSeconds = 0;
  activityState.activeSeconds = 0;
  activityState.productiveSeconds = 0;
  activityState.idleSeconds = 0;
  activityState.awaySeconds = 0;
  activityLogs = [];
  currentLog = null;
  lastInputTime = Date.now();
  console.log('[Monitor] Session counters reset');
}

export function initializeSessionCounters(
  activeSeconds: number,
  idleSeconds: number,
  productiveSeconds: number,
  sessionSeconds: number
) {
  activityState.activeSeconds = activeSeconds;
  activityState.idleSeconds = idleSeconds;
  activityState.productiveSeconds = productiveSeconds;
  activityState.sessionSeconds = sessionSeconds;
  activityState.awaySeconds = Math.max(0, sessionSeconds - (activeSeconds + idleSeconds));
  lastInputTime = Date.now() - (idleSeconds * 1000);
  console.log(`[Monitor] Session counters initialized: session=${sessionSeconds}, active=${activeSeconds}, idle=${idleSeconds}`);
}

export function setAutoLaunchEnabled(enabled: boolean) {
  if (!app.isPackaged) return true;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: ['--background'],
      openAsHidden: true,
    });
    return true;
  } catch (error) {
    console.error('Error setting auto-launch:', error);
    return false;
  }
}

export function getAutoLaunchStatus() {
  try {
    return app.getLoginItemSettings({ path: process.execPath }).openAtLogin;
  } catch {
    return false;
  }
}

export function showGlobalWaterReminder() {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Hydration Reminder',
        body: 'Please drink some water =�ƺ. Stay hydrated and stay productive.',
      }).show();
    }
  } catch {}

  try {
    createReminderWindow('Please drink some water =�ƺ');
  } catch {}
}

function createReminderWindow(message: string) {
  const win = new BrowserWindow({
    width: 380, height: 190, frame: false, resizable: false,
    movable: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: true, backgroundColor: '#ffffff',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const html = encodeURIComponent(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"/>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
    <style>body{margin:0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100%;background:#fff}
    .card{padding:24px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 16px 32px rgba(0,0,0,.12)}
    .title{font-size:20px;font-weight:700;color:#111827}
    .msg{color:#4b5563;margin-top:12px;line-height:1.5}
    .btn{margin-top:18px;padding:12px 16px;border:none;border-radius:12px;background:#2563eb;color:#fff;cursor:pointer;font-size:14px}
    </style></head><body><div class="card"><div><div class="title">Please drink some water =�ƺ</div>
    <div class="msg">Stay hydrated to keep your productivity up. Take a quick break!</div></div>
    <button class="btn" onclick="window.close()">OK</button></div></body></html>`);
  win.loadURL(`data:text/html;charset=UTF-8,${html}`);
  win.center();
  win.show();
  setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 10_000);
}

function scheduleHealthReminder() {
  if (healthReminderInterval) return; // already scheduled
  healthReminderInterval = setInterval(showGlobalWaterReminder, 60 * 60 * 1000);
}

export function startBackgroundMonitoring() {
  if (monitoringStarted) return;
  monitoringStarted = true;
  currentTrackingDate = new Date().toISOString().slice(0, 10);
  writePsScriptIfNotExist();
  loadLogsFromDisk();
  // Pre-load systeminformation in background
  getSysInfo().catch(() => {});
  refreshActivity();
  monitorInterval = setInterval(refreshActivity, 1000);
  scheduleHealthReminder();
  console.log('[Monitor] Background monitoring started (self-contained, no ActivityWatch)');
}

export function stopBackgroundMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (healthReminderInterval) {
    clearInterval(healthReminderInterval);
    healthReminderInterval = null;
  }
  // Close out any in-progress activity log
  if (currentLog) {
    closeCurrentLog(new Date());
  }
  monitoringStarted = false;
  console.log('[Monitor] Background monitoring stopped');
}