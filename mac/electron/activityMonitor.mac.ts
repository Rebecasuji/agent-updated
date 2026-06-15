import { app, BrowserWindow, Notification } from 'electron';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
// Note: Idle prompt handled natively on macOS
// import { showIdlePromptWindow } from '../electron/idlePromptWindow.js';

/**
 * macOS Activity Monitor
 * Uses AppleScript and native macOS APIs for monitoring
 */

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
let currentTrackingDate: string = new Date().toISOString().slice(0, 10);

let healthReminderInterval: NodeJS.Timeout | null = null;
const maxStoredLogs = 200;

let lastBrowserUrl: { url: string; title: string } | null = null;
const appClassifications = new Map<string, 'productive' | 'non_productive' | 'neutral'>();

let currentActivityWindow: BrowserWindow | null = null;
let monitorInterval: NodeJS.Timeout | null = null;
let monitoringStarted = false;
let mainProcessIdlePrompted = false;
let isIdleModalActive = false;
let lastInputTime = Date.now();
let isRefreshInProgress = false;
let currentLog: ActivityLog | null = null;
let activityLogs: ActivityLog[] = [];

let lastCpuUsage = 0;
let lastMemoryUsage = 0;
let sysMetricsCounter = 0;

export function updateBrowserUrl(url: string, title: string) {
  lastBrowserUrl = { url, title };
}

export function updateIdleTimeout(minutes: number) {
  idleThresholdSeconds = Math.max(1, minutes) * 60;
  console.log(`[Monitor macOS] Updated idle threshold to ${idleThresholdSeconds} seconds`);
}

export function updateAppClassifications(classifications: Array<{ name: string; classification: 'productive' | 'non_productive' | 'neutral' }>) {
  appClassifications.clear();
  classifications.forEach(c => {
    appClassifications.set(c.name, c.classification);
  });
  console.log(`[Monitor macOS] Updated classifications map. Count: ${appClassifications.size}`);
}

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
    console.error('[Monitor macOS] Failed to load activity logs:', error);
  }
}

function saveLogsToDisk() {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(activityLogs.slice(-maxStoredLogs), null, 2), { encoding: 'utf8' });
  } catch (error) {
    console.error('[Monitor macOS] Failed to save activity logs:', error);
  }
}

function getActiveWindowMac(): { ownerName: string; windowTitle: string } {
  try {
    const script = `
      tell application "System Events"
        set appName to name of first application process whose frontmost is true
        tell process appName
          set windowTitle to name of front window
        end tell
      end tell
      return appName & "|" & windowTitle
    `;

    const result = execSync(
      `osascript -e '${script.replace(/'/g, "\\'")}'`,
      { timeout: 800, encoding: 'utf8', stdio: 'pipe' }
    ).trim();

    if (result && result.includes('|')) {
      const sep = result.indexOf('|');
      return {
        ownerName: result.slice(0, sep).trim(),
        windowTitle: result.slice(sep + 1).trim(),
      };
    }
  } catch (error) {
    console.debug('[Monitor macOS] AppleScript error:', error instanceof Error ? error.message : 'Unknown');
  }

  return { ownerName: 'Unknown', windowTitle: 'Unknown' };
}

function getSystemIdleTimeMac(): number {
  try {
    // Use ioreg to check idle time
    const result = execSync(
      `ioreg -c IOHIDSystem | grep HIDIdleTime | head -1 | sed 's/.*= //' | awk '{print int($0/1000000000)}'`,
      { timeout: 500, encoding: 'utf8', stdio: 'pipe' }
    ).trim();

    const idleSeconds = parseInt(result, 10);
    return !isNaN(idleSeconds) ? idleSeconds : 0;
  } catch (error) {
    console.debug('[Monitor macOS] Failed to get idle time:', error instanceof Error ? error.message : 'Unknown');
    return 0;
  }
}

function getSystemMetricsMac(): { cpu: number; memory: number } {
  try {
    // CPU usage
    const cpuResult = execSync(
      `ps -A -o %cpu | awk '{s+=$1} END {printf "%.0f", s}'`,
      { timeout: 500, encoding: 'utf8', stdio: 'pipe' }
    ).trim();
    const cpu = Math.min(100, parseInt(cpuResult, 10) || 0);

    // Memory usage
    const memResult = execSync(
      `vm_stat | awk '/^Pages free/ {printf "%.0f", ($(NF-1) * 4) / 1024}' | head -1`,
      { timeout: 500, encoding: 'utf8', stdio: 'pipe' }
    ).trim();

    const totalMem = parseInt(
      execSync(`sysctl -n hw.memsize`, { timeout: 500, encoding: 'utf8', stdio: 'pipe' }).trim(),
      10
    ) / 1024 / 1024;

    const freeMem = parseInt(memResult, 10) || 0;
    const memory = Math.max(0, Math.min(100, Math.round(((totalMem - freeMem) / totalMem) * 100)));

    return { cpu, memory };
  } catch (error) {
    console.debug('[Monitor macOS] Failed to get system metrics:', error instanceof Error ? error.message : 'Unknown');
    return { cpu: 0, memory: 0 };
  }
}

function normalizeAppName(raw?: string): string {
  if (!raw) return 'Unknown';
  const s = raw.trim();
  if (/chrome/i.test(s)) return 'Chrome';
  if (/safari/i.test(s)) return 'Safari';
  if (/firefox/i.test(s)) return 'Firefox';
  if (/brave/i.test(s)) return 'Brave';
  if (/edge/i.test(s)) return 'Microsoft Edge';
  if (/code/i.test(s)) return 'VS Code';
  if (/knockturn|electron/i.test(s)) return 'Knockturn Agent';
  if (/teams/i.test(s)) return 'Teams';
  if (/slack/i.test(s)) return 'Slack';
  if (/zoom/i.test(s)) return 'Zoom';
  if (/numbers/i.test(s)) return 'Numbers';
  if (/pages/i.test(s)) return 'Pages';
  if (/keynote/i.test(s)) return 'Keynote';
  if (/mail/i.test(s)) return 'Mail';
  if (/terminal|iterm/i.test(s)) return 'Terminal';
  return s || 'Unknown';
}

function parseWebsite(appName: string, title: string): string | undefined {
  if (lastBrowserUrl) {
    try {
      const u = new URL(lastBrowserUrl.url);
      return u.hostname.replace(/^www\./, '');
    } catch {}
  }

  if (!title) return undefined;
  const browsers = ['Chrome', 'Safari', 'Firefox', 'Brave', 'Microsoft Edge', 'Browser'];
  if (!browsers.includes(appName)) return undefined;

  const cleaned = title
    .replace(/( - Google Chrome| - Safari| - Mozilla Firefox| - Brave| - Microsoft Edge)$/i, '')
    .trim();
  if (!cleaned || /^(new tab|start page|about:blank|about:start)$/i.test(cleaned)) return undefined;

  const domainMatch = cleaned.match(/([\w-]+\.[a-z]{2,})(\/\S*)?/i);
  if (domainMatch) return domainMatch[1];

  return undefined;
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

  if (website) {
    const webClassification = appClassifications.get(website);
    if (webClassification) return webClassification;

    for (const [key, val] of appClassifications.entries()) {
      if (website.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(website.toLowerCase())) {
        return val;
      }
    }
  }

  const classification = appClassifications.get(appName);
  if (classification) return classification;

  for (const [key, val] of appClassifications.entries()) {
    if (appName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(appName.toLowerCase())) {
      return val;
    }
  }

  const lowerApp = appName.toLowerCase();
  if (lowerApp.includes('chrome') || lowerApp.includes('safari') || lowerApp.includes('firefox') || lowerApp.includes('brave')) {
    return 'neutral';
  }

  const defaultProductive = ['vs code', 'code', 'figma', 'numbers', 'pages', 'slack', 'teams'];
  if (defaultProductive.some(p => lowerApp.includes(p))) {
    return 'productive';
  }

  return 'neutral';
}

// Note: withTimeout not currently used in macOS version
// function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
//   return Promise.race([
//     promise,
//     new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
//   ]);
// }

function sendStateUpdate() {
  if (currentActivityWindow?.webContents && !currentActivityWindow.webContents.isDestroyed()) {
    const stateToSend = isIdleModalActive ? { ...activityState, state: 'idle' as const } : activityState;
    currentActivityWindow.webContents.send('activity-update', stateToSend);
  }
}

async function refreshActivity() {
  if (isRefreshInProgress) return;
  isRefreshInProgress = true;

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    if (todayStr !== currentTrackingDate) {
      console.log(`[Monitor macOS] Day changed from ${currentTrackingDate} to ${todayStr} — resetting counters`);
      resetSessionCounters();
      currentTrackingDate = todayStr;
    }

    const { ownerName: rawOwner, windowTitle } = getActiveWindowMac();
    const ownerName = normalizeAppName(rawOwner);
    const website = parseWebsite(ownerName, windowTitle);

    sysMetricsCounter++;
    if (sysMetricsCounter >= 10) {
      sysMetricsCounter = 0;
      const metrics = getSystemMetricsMac();
      lastCpuUsage = metrics.cpu;
      lastMemoryUsage = metrics.memory;
    }

    const systemIdleSeconds = getSystemIdleTimeMac();
    const now = Date.now();
    let isIdle = systemIdleSeconds >= idleThresholdSeconds;

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
    if (state === 'idle') activityState.idleSeconds += 1;
    if (state === 'away') activityState.awaySeconds += 1;

    sendStateUpdate();
  } catch (error) {
    console.error('[Monitor macOS] Error refreshing activity state:', error);
  } finally {
    isRefreshInProgress = false;
  }
}

export function setActivityMonitorWindow(window: BrowserWindow) {
  currentActivityWindow = window;
}

export function setIdleModalActive(active: boolean) {
  isIdleModalActive = active;
  console.log(`[Monitor macOS] Idle modal active status set to: ${active}`);
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
  console.log('[Monitor macOS] Session counters reset');
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
  console.log(`[Monitor macOS] Session counters initialized: session=${sessionSeconds}, active=${activeSeconds}, idle=${idleSeconds}`);
}

export function setAutoLaunchEnabled(enabled: boolean): boolean {
  try {
    const launchAgentsDir = path.join(process.env.HOME || '~', 'Library', 'LaunchAgents');
    if (!fs.existsSync(launchAgentsDir)) {
      fs.mkdirSync(launchAgentsDir, { recursive: true });
    }

    const plistPath = path.join(launchAgentsDir, 'com.knockturn.agent.plist');
    const appPath = process.execPath;

    if (enabled) {
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.knockturn.agent</string>
  <key>Program</key>
  <string>${appPath}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>\${HOME}/Library/Logs/knockturn-agent.log</string>
  <key>StandardErrorPath</key>
  <string>\${HOME}/Library/Logs/knockturn-agent-error.log</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>AbandonProcessGroup</key>
  <true/>
</dict>
</plist>`;

      fs.writeFileSync(plistPath, plistContent, 'utf8');

      try {
        execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
      } catch {
        execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
        execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
      }
      return true;
    } else {
      if (fs.existsSync(plistPath)) {
        try {
          execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
        } catch {}
        fs.unlinkSync(plistPath);
      }
      return true;
    }
  } catch (error) {
    console.error('[Monitor macOS] Error setting auto-launch:', error);
    return false;
  }
}

export function getAutoLaunchStatus(): boolean {
  try {
    const launchAgentsDir = path.join(process.env.HOME || '~', 'Library', 'LaunchAgents');
    const plistPath = path.join(launchAgentsDir, 'com.knockturn.agent.plist');
    return fs.existsSync(plistPath);
  } catch {
    return false;
  }
}

export function showGlobalWaterReminder() {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Hydration Reminder',
        body: 'Please drink some water. Stay hydrated and stay productive.',
      }).show();
    }
  } catch {}
}

function scheduleHealthReminder() {
  if (healthReminderInterval) return;
  healthReminderInterval = setInterval(showGlobalWaterReminder, 60 * 60 * 1000);
}

export function startBackgroundMonitoring() {
  if (monitoringStarted) return;
  monitoringStarted = true;
  currentTrackingDate = new Date().toISOString().slice(0, 10);
  loadLogsFromDisk();
  refreshActivity();
  monitorInterval = setInterval(refreshActivity, 1000);
  scheduleHealthReminder();
  console.log('[Monitor macOS] Background monitoring started');
}

export function stopBackgroundMonitoring() {
  monitoringStarted = false;
  if (monitorInterval) clearInterval(monitorInterval);
  if (healthReminderInterval) clearInterval(healthReminderInterval);
  monitorInterval = null;
  healthReminderInterval = null;
  if (currentLog) {
    closeCurrentLog(new Date());
  }
  console.log('[Monitor macOS] Background monitoring stopped');
}
