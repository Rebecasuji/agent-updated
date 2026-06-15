import { ipcMain } from 'electron';
import { mainWindow } from './main.js';

let isOnline = true;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

const CHECK_URL = 'https://ogqmojvzeyasqoqhkpuz.supabase.co';

export function setupAutoReconnect() {
  // Start a simple periodic connectivity check from the main process.
  // This avoids referencing `window` (not available in the main process).
  if (monitorInterval) return;

  const check = async () => {
    try {
      // Use global fetch (Node/Electron newer versions) to probe connectivity
      const res = await fetch(CHECK_URL, { method: 'HEAD' });
      if (!isOnline) {
        isOnline = true;
        console.log('✅ Reconnected');
        mainWindow?.webContents.send('connection-restored');
      }
      return true;
    } catch (err) {
      if (isOnline) {
        isOnline = false;
        console.log('📡 Connection lost - offline mode activated');
        mainWindow?.webContents.send('connection-lost');
      }
      return false;
    }
  };

  // Initial check
  void check();

  monitorInterval = setInterval(() => {
    void check();
  }, 5000);

  // IPC handler for connection retry
  ipcMain.handle('retry-connection', async () => {
    if (mainWindow) {
      await mainWindow.webContents.reload();
    }
    return true;
  });
}

export function getConnectionStatus() {
  return isOnline;
}

export function clearReconnectIntervals() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
