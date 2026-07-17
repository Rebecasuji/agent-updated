import { BrowserWindow, Notification } from 'electron';
import pg from 'pg';
import { supabase } from '../src/lib/supabase.js';

let enforcerInterval: NodeJS.Timeout | null = null;
let pollFallbackInterval: NodeJS.Timeout | null = null;
let currentEmployee: any = null;

export function getCurrentEmployee() {
  return currentEmployee;
}

let lockSubscription: any = null;
let currentMainWindow: BrowserWindow | null = null;
let appSettings: Record<string, string> = {
  timesheet_check_time: '11:00',
  timesheet_warning_time: '11:30',
  timesheet_lock_time: '12:30',
  enable_lock_screen_enforcement: 'true'
};

// Will be set by main.ts
let getTimesheetDbUrlImpl: (() => string | undefined) | null = null;

export function setTimesheetDbUrlGetter(getter: () => string | undefined) {
  getTimesheetDbUrlImpl = getter;
}

function getTimesheetDbUrl(): string | undefined {
  if (getTimesheetDbUrlImpl) {
    return getTimesheetDbUrlImpl();
  }
  // Hardcoded fallback — the new TimeStrap DB — so it works even in packaged builds
  // that may not load .env correctly
  const url = process.env.TIMESHEET_DB_URL ||
    'postgresql://postgres.cwjkvasixpmieeuaield:Rebecasuji%4013@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require';
  if (!process.env.TIMESHEET_DB_URL) {
    console.warn('[TimesheetEnforcer] TIMESHEET_DB_URL not in env — using hardcoded fallback URL');
  }
  return url;
}

export async function fetchAppSettings() {
  try {
    const { data, error } = await supabase.from('app_settings').select('*');
    if (!error && data) {
      data.forEach((row: any) => {
        appSettings[row.setting_key] = row.setting_value;
      });
      console.log('[TimesheetEnforcer] App settings refreshed. enable_lock_screen_enforcement =', appSettings['enable_lock_screen_enforcement']);
    }
  } catch (err) {
    console.error('[TimesheetEnforcer] Error fetching app settings:', err);
  }
}

export function getPreviousWorkingDate(): string | null {
  // Use IST for accurate date calculation
  const now = new Date();
  const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istString);
  const dayOfWeek = istDate.getDay();

  if (dayOfWeek === 0) return null; // Sunday — no previous working day check

  if (dayOfWeek === 1) {
    // Monday → previous working day is Saturday
    const sat = new Date(istDate);
    sat.setDate(sat.getDate() - 2);
    return sat.toISOString().slice(0, 10);
  }

  const prev = new Date(istDate);
  prev.setDate(prev.getDate() - 1);
  return prev.toISOString().slice(0, 10);
}

export async function checkLeaveStatus(empCode: string, dateStr: string): Promise<{
  isOnLeave: boolean;
  reason: string | null;
  leaveType: string | null;
  startDate: string | null;
  endDate: string | null;
}> {
  const lmsUrl = process.env.LMS_DB_URL || 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji%4013@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';
  if (!lmsUrl) return { isOnLeave: false, reason: null, leaveType: null, startDate: null, endDate: null };

  const { Client } = pg;
  const client = new Client({
    connectionString: lmsUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    
    // Check leaves (Approved Leave, Earned Leave, Casual Leave, Sick Leave, OD, etc.)
    // Dates stored as UTC midnight (18:30 UTC prev day = midnight IST)
    // Must convert to IST before comparing with IST dateStr
    const leavesRes = await client.query(
      `SELECT leave_type, start_date, end_date 
       FROM leaves 
       WHERE user_id = $1 
         AND DATE(start_date AT TIME ZONE 'Asia/Kolkata') <= $2::date
         AND DATE(end_date AT TIME ZONE 'Asia/Kolkata') >= $2::date
         AND status = 'Approved'
       ORDER BY CASE 
         WHEN leave_type ILIKE '%Comp Off%' THEN 1
         WHEN leave_type ILIKE '%Approved Leave%' THEN 2
         WHEN leave_type ILIKE '%Earned Leave%' OR leave_type ILIKE '%EL%' THEN 3
         WHEN leave_type ILIKE '%Casual Leave%' OR leave_type ILIKE '%CL%' THEN 4
         WHEN leave_type ILIKE '%Sick Leave%' OR leave_type ILIKE '%SL%' THEN 5
         WHEN leave_type ILIKE '%OD%' OR leave_type ILIKE '%On Duty%' THEN 6
         ELSE 7 
       END ASC LIMIT 1`,
      [empCode, dateStr]
    );

    if (leavesRes.rows.length > 0) {
      const row = leavesRes.rows[0];
      return { 
        isOnLeave: true, 
        reason: `Approved Leave (${row.leave_type})`,
        leaveType: row.leave_type,
        startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : dateStr,
        endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : dateStr
      };
    }

    // Check permissions
    const permRes = await client.query(
      `SELECT permission_type, permission_date FROM permissions WHERE user_id = $1 AND permission_date = $2 AND status = 'Approved' LIMIT 1`,
      [empCode, dateStr]
    );

    if (permRes.rows.length > 0) {
      const row = permRes.rows[0];
      return { 
        isOnLeave: true, 
        reason: `Approved Permission (${row.permission_type})`,
        leaveType: 'Permission',
        startDate: row.permission_date ? row.permission_date.toISOString().split('T')[0] : dateStr,
        endDate: row.permission_date ? row.permission_date.toISOString().split('T')[0] : dateStr
      };
    }

    return { isOnLeave: false, reason: null, leaveType: null, startDate: null, endDate: null };
  } catch (err) {
    console.error('[TimesheetEnforcer] Error verifying LMS leave:', err);
    return { isOnLeave: false, reason: null, leaveType: null, startDate: null, endDate: null };
  } finally {
    try { await client.end(); } catch {}
  }
}

export async function checkTimesheetSubmitted(empCode: string, dateStr: string): Promise<boolean> {
  const timesheetDbUrl = getTimesheetDbUrl();
  if (!timesheetDbUrl) {
    console.error('[TimesheetEnforcer] ✗ TIMESHEET_DB_URL is not configured and no fallback available');
    return true; // Assume submitted to avoid false locks
  }
  
  const { Client } = pg;
  const client = new Client({
    connectionString: timesheetDbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('[TimesheetEnforcer] ✓ Connected to TimeStrap DB for employee:', empCode, 'date:', dateStr);
    
    // Find employee
    const empRes = await client.query(`SELECT id FROM employees WHERE employee_code = $1 LIMIT 1`, [empCode]);
    
    if (empRes.rows.length === 0) {
      console.log('[TimesheetEnforcer] Employee not found in TimeStrap — not in timesheet system, skipping lock');
      return true; // Employee not in timesheet system, don't lock
    }
    
    const empId = empRes.rows[0].id;
    console.log(`[TimesheetEnforcer] ✓ Found employee UUID: ${empId}`);

    // IMPORTANT: daily_submissions table does NOT have a status column.
    // Columns are: id, employee_id, date, total_hours, submitted_at
    // A row with submitted_at populated means the timesheet was submitted.
    // A row WITHOUT submitted_at (null) means it was saved/drafted but not finally submitted.
    const dailySubRes = await client.query(
      `SELECT id, submitted_at, total_hours FROM daily_submissions WHERE employee_id = $1 AND date = $2 LIMIT 1`,
      [empId, dateStr]
    );

    if (dailySubRes.rows.length > 0) {
      const row = dailySubRes.rows[0];
      if (row.submitted_at) {
        console.log('[TimesheetEnforcer] ✓ Timesheet submitted (daily_submissions has submitted_at:', row.submitted_at + ')');
        return true;
      }
      // Row exists but no submitted_at — this is a draft/saved state, check time_entries too
      console.log('[TimesheetEnforcer] daily_submissions row found but submitted_at is null — checking time_entries...');
    } else {
      console.log('[TimesheetEnforcer] No row in daily_submissions for date:', dateStr);
    }

    // Check time_entries — must explicitly be submitted or approved
    const entriesRes = await client.query(
      `SELECT status FROM time_entries WHERE employee_id = $1 AND date = $2 AND status IN ('submitted', 'approved') LIMIT 1`,
      [empId, dateStr]
    );

    if (entriesRes.rows.length > 0) {
      console.log('[TimesheetEnforcer] ✓ Timesheet submitted (found in time_entries, status:', entriesRes.rows[0].status + ')');
      return true;
    }

    console.log('[TimesheetEnforcer] ✗ Timesheet NOT submitted for ' + dateStr);
    return false;
  } catch (err) {
    console.error('[TimesheetEnforcer] Error verifying timesheet:', err);
    return true; // assume submitted on error to avoid false positives
  } finally {
    try { await client.end(); } catch {}
  }
}

export async function getManualOverrideState(empId: string, todayDateStr: string): Promise<'LOCKED' | 'UNLOCKED_TODAY' | 'NONE'> {
  try {
    const { data, error } = await supabase
      .from('timesheet_lock_logs')
      .select('event_type, created_at')
      .eq('employee_id', empId)
      .in('event_type', ['MANUAL_LOCK', 'MANUAL_UNLOCK'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[TimesheetEnforcer] Error checking manual override:', error);
      return 'NONE';
    }

    if (data && data.length > 0) {
      const latestEvent = data[0];
      const eventTime = new Date(latestEvent.created_at).getTime();
      const now = Date.now();
      
      // If the manual event was within the last 18 hours, consider it valid for today
      if (now - eventTime < 18 * 60 * 60 * 1000) {
        if (latestEvent.event_type === 'MANUAL_LOCK') {
          console.log('[TimesheetEnforcer] Manual override state: LOCKED');
          return 'LOCKED';
        } else if (latestEvent.event_type === 'MANUAL_UNLOCK') {
          console.log('[TimesheetEnforcer] Manual override state: UNLOCKED_TODAY');
          return 'UNLOCKED_TODAY';
        }
      }
    }
    return 'NONE';
  } catch (err) {
    return 'NONE';
  }
}

export async function getComplianceDetails(empCode: string, empId: string, dateStr: string): Promise<any> {
  let emp: any = null;
  // Try by empId first (most reliable), then fallback to empCode
  if (empId) {
    const { data } = await supabase.from('employees').select('id, employee_name, employee_code').eq('id', empId).maybeSingle();
    emp = data;
  }
  if (!emp && empCode) {
    const { data } = await supabase.from('employees').select('id, employee_name, employee_code').eq('employee_code', empCode).maybeSingle();
    emp = data;
  }
  if (!emp) return { error: 'Employee not found', employeeCode: empCode, employeeId: empId };

  // Use the resolved employee_code from DB (most reliable)
  const resolvedCode = emp.employee_code || empCode;

  const isSubmitted = await checkTimesheetSubmitted(resolvedCode, dateStr);
  const leaveStatus = await checkLeaveStatus(resolvedCode, dateStr);
  const todayDate = new Date().toISOString().slice(0, 10);
  const manualOverride = await getManualOverrideState(emp.id, todayDate);

  // Get lock/warning logs for this date
  const { data: logs } = await supabase
    .from('timesheet_lock_logs')
    .select('event_type, created_at')
    .eq('employee_id', emp.id)
    .gte('created_at', dateStr + 'T00:00:00Z')
    .lte('created_at', dateStr + 'T23:59:59Z')
    .order('created_at', { ascending: false });

  let lastWarningTime = null;
  let lastLockTime = null;

  if (logs) {
    const warning = logs.find(l => l.event_type === 'WARNING');
    if (warning) lastWarningTime = new Date(warning.created_at).toLocaleTimeString();
    const lock = logs.find(l => l.event_type === 'LOCKED');
    if (lock) lastLockTime = new Date(lock.created_at).toLocaleTimeString();
  }

  return {
    employeeName: emp.employee_name || 'Unknown',
    employeeCode: resolvedCode || '-',
    dateChecked: dateStr,
    timesheetSubmitted: isSubmitted,
    leaveStatus: leaveStatus.isOnLeave ? 'Approved' : 'Not Approved',
    leaveType: leaveStatus.leaveType || '-',
    startDate: leaveStatus.startDate || '-',
    endDate: leaveStatus.endDate || '-',
    exemptionReason: leaveStatus.reason || '-',
    warningStatus: lastWarningTime ? 'Warned' : 'None',
    lockStatus: lastLockTime ? 'Locked' : 'None',
    lastWarningTime: lastWarningTime || '-',
    lastLockTime: lastLockTime || '-',
    manualLockStatus: manualOverride === 'LOCKED' ? 'Active' : 'None',
    manualUnlockStatus: manualOverride === 'UNLOCKED_TODAY' ? 'Active' : 'None',
  };
}

// ─── Helper: send lock signal to mainWindow safely ────────────────────────────
function sendLockToWindow(date: string, manual: boolean = false) {
  const win = currentMainWindow;
  if (win && !win.isDestroyed()) {
    console.log('[TimesheetEnforcer] Sending timesheet-lock to renderer. date:', date, 'manual:', manual);
    win.webContents.send('timesheet-lock', { date, manual });
    // Also bring window to front so the lock screen is visible
    try {
      if (!win.isVisible()) win.show();
      win.focus();
    } catch {}
  } else {
    console.warn('[TimesheetEnforcer] mainWindow not available to send timesheet-lock');
  }
}

function sendUnlockToWindow() {
  const win = currentMainWindow;
  if (win && !win.isDestroyed()) {
    console.log('[TimesheetEnforcer] Sending timesheet-unlock to renderer');
    win.webContents.send('timesheet-unlock');
  } else {
    console.warn('[TimesheetEnforcer] mainWindow not available to send timesheet-unlock');
  }
}

// ─── Setup Realtime subscription for instant manual lock/unlock ───────────────
function setupRealtimeSubscription(empId: string) {
  // Always clean up existing subscription first to avoid duplicates
  if (lockSubscription) {
    try {
      supabase.removeChannel(lockSubscription);
    } catch {}
    lockSubscription = null;
  }

  // Use a unique channel name per employee to avoid collisions
  const channelName = `timesheet_lock_${empId}`;
  console.log('[TimesheetEnforcer] Setting up Realtime subscription on channel:', channelName);

  lockSubscription = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'timesheet_lock_logs',
        filter: `employee_id=eq.${empId}`
      },
      (payload) => {
        console.log('[TimesheetEnforcer] ⚡ Realtime lock log received:', payload.new);
        const newLog = payload.new as any;
        if (!newLog || !newLog.event_type) return;

        const prevDate = getPreviousWorkingDate();
        // For manual events, use today's date as context if no previous working date
        const lockDate = prevDate || new Date().toISOString().slice(0, 10);

        if (newLog.event_type === 'MANUAL_LOCK') {
          console.log('[TimesheetEnforcer] ⚡ MANUAL_LOCK received — locking instantly');
          sendLockToWindow(lockDate, true);
        } else if (newLog.event_type === 'MANUAL_UNLOCK') {
          console.log('[TimesheetEnforcer] ⚡ MANUAL_UNLOCK received — unlocking instantly');
          sendUnlockToWindow();
        } else if (newLog.event_type === 'AUTO_UNLOCK') {
          console.log('[TimesheetEnforcer] ⚡ AUTO_UNLOCK received');
          sendUnlockToWindow();
        }
      }
    )
    .subscribe((status, err) => {
      console.log('[TimesheetEnforcer] Realtime subscription status:', status, err || '');
      if (status === 'SUBSCRIBED') {
        console.log('[TimesheetEnforcer] ✓ Realtime subscription active for employee:', empId);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        console.warn('[TimesheetEnforcer] ⚠ Realtime channel issue, will rely on 60s polling fallback');
      }
    });
}

export async function startTimesheetEnforcer(empCode: string, mainWindow: BrowserWindow | null) {
  console.log('[TimesheetEnforcer] Starting enforcer for employee code:', empCode);

  // Store the mainWindow reference globally so it can be used anytime
  currentMainWindow = mainWindow;

  // Clear any existing intervals
  if (enforcerInterval) {
    clearInterval(enforcerInterval);
    enforcerInterval = null;
  }
  if (pollFallbackInterval) {
    clearInterval(pollFallbackInterval);
    pollFallbackInterval = null;
  }

  // Fetch full employee object from the main (agent) Supabase DB
  const { data, error } = await supabase.from('employees').select('*').eq('employee_code', empCode).maybeSingle();
  if (error || !data) {
    console.error('[TimesheetEnforcer] Could not fetch employee for', empCode, 'error:', error);
    return;
  }
  currentEmployee = data;
  console.log('[TimesheetEnforcer] Employee loaded:', currentEmployee.employee_name, '| ID:', currentEmployee.id);

  // Immediately fetch app settings
  await fetchAppSettings();

  let lastLoggedDate = '';
  let loggedWarningToday = false;
  let loggedLockToday = false;
  let loggedPreCheckToday = false;
  let wasLockedToday = false;

  const logLockEvent = async (eventType: string, reason?: string) => {
    if (!currentEmployee) return;
    try {
      await supabase.from('timesheet_lock_logs').insert([{
        employee_id: currentEmployee.id,
        employee_name: currentEmployee.employee_name,
        event_type: eventType,
        reason: reason
      }]);
    } catch (err) {
      console.error('[TimesheetEnforcer] Failed to log event', eventType, err);
    }
  };

  const evaluateRules = async () => {
    if (!currentEmployee) return;

    // Admin / superadmin bypass
    if (currentEmployee.role === 'admin' || currentEmployee.role === 'superadmin') {
      console.log('[TimesheetEnforcer] Skipping — admin role');
      return;
    }
    // Exempt employee bypass
    if (currentEmployee.timesheet_exempt) {
      console.log('[TimesheetEnforcer] Skipping — timesheet_exempt flag set');
      return;
    }

    // Refresh settings and check global enforcement toggle
    await fetchAppSettings();
    if (appSettings['enable_lock_screen_enforcement'] !== 'true') {
      console.log('[TimesheetEnforcer] Lock enforcement is globally disabled — skipping');
      // If currently locked, unlock
      sendUnlockToWindow();
      return;
    }

    let prevDate = getPreviousWorkingDate();
    if (!prevDate) {
      console.log('[TimesheetEnforcer] Today is Sunday — no previous working day check');
      return;
    }

    const nowIST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(nowIST);
    const todayDate = istDate.getFullYear() + '-' + String(istDate.getMonth() + 1).padStart(2, '0') + '-' + String(istDate.getDate()).padStart(2, '0');

    // Reset daily tracking on new day
    if (lastLoggedDate !== todayDate) {
      lastLoggedDate = todayDate;
      loggedWarningToday = false;
      loggedLockToday = false;
      loggedPreCheckToday = false;
      wasLockedToday = false;
      console.log('[TimesheetEnforcer] New day detected:', todayDate, '— reset daily state');
    }

    // ── BYPASS: Employee is on Approved Leave TODAY ────────────────────────────
    const leaveStatusToday = await checkLeaveStatus(currentEmployee.employee_code, todayDate);
    if (leaveStatusToday.isOnLeave) {
      console.log('[TimesheetEnforcer] Bypass: Employee on approved leave today');
      if (!loggedPreCheckToday) {
        loggedPreCheckToday = true;
        await logLockEvent('PRE_LOCK_CHECK', `APPROVED_LEAVE (Today: ${leaveStatusToday.reason})`);
      }
      sendUnlockToWindow();
      return;
    }

    // ── FIND ACTUAL PREVIOUS REQUIRED WORKING DAY ───────────────────────────
    let loops = 0;
    while (prevDate && loops < 14) {
      const leaveStatusPrev = await checkLeaveStatus(currentEmployee.employee_code, prevDate);
      if (leaveStatusPrev.isOnLeave) {
        console.log(`[TimesheetEnforcer] ${prevDate} was a leave day (${leaveStatusPrev.reason}) — skipping back one day.`);
        const d = new Date(prevDate + 'T00:00:00+05:30'); // Parse as IST
        d.setDate(d.getDate() - 1);
        if (d.getDay() === 0) d.setDate(d.getDate() - 1); // Skip Sunday
        prevDate = d.toISOString().slice(0, 10);
        loops++;
      } else {
        break; // Found a required working day
      }
    }
    
    if (!prevDate) return;


    // ── MANUAL OVERRIDE (highest priority over auto-lock) ─────────────────────
    const manualOverride = await getManualOverrideState(currentEmployee.id, todayDate);
    if (manualOverride === 'LOCKED') {
      console.log('[TimesheetEnforcer] Manual override: LOCKED — applying lock via poll fallback');
      if (!loggedPreCheckToday) {
        loggedPreCheckToday = true;
        await logLockEvent('PRE_LOCK_CHECK', 'MANUAL_OVERRIDE (Locked)');
      }
      sendLockToWindow(prevDate, true);
      wasLockedToday = true;
      return;
    } else if (manualOverride === 'UNLOCKED_TODAY') {
      console.log('[TimesheetEnforcer] Manual override: UNLOCKED_TODAY — sending unlock');
      if (!loggedPreCheckToday) {
        loggedPreCheckToday = true;
        await logLockEvent('PRE_LOCK_CHECK', 'MANUAL_OVERRIDE (Unlocked)');
      }
      sendUnlockToWindow();
      return;
    }

    // ── CHECK TIMESHEET SUBMISSION ─────────────────────────────────────────────
    const isSubmitted = await checkTimesheetSubmitted(currentEmployee.employee_code, prevDate);
    if (isSubmitted) {
      if (!loggedPreCheckToday) {
        loggedPreCheckToday = true;
        await logLockEvent('PRE_LOCK_CHECK', 'TIMESHEET_SUBMITTED');
      }
      const win = currentMainWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send('timesheet-status', { submitted: true, date: prevDate });
        win.webContents.send('timesheet-unlock'); // Unlock if previously locked
      }
      if (wasLockedToday) {
        await logLockEvent('AUTO_UNLOCK', 'Timesheet submitted successfully');
        wasLockedToday = false;
      }
      return;
    }

    // ── TIMESHEET MISSING — evaluate lock time ─────────────────────────────────
    if (!loggedPreCheckToday) {
      loggedPreCheckToday = true;
      await logLockEvent('PRE_LOCK_CHECK', 'TIMESHEET_MISSING');
    }

    const currentMinsIST = istDate.getHours() * 60 + istDate.getMinutes();

    const [checkH, checkM] = (appSettings['timesheet_check_time'] || '11:00').split(':').map(Number);
    const checkMins = checkH * 60 + checkM;

    const [warnH, warnM] = (appSettings['timesheet_warning_time'] || '11:30').split(':').map(Number);
    const warnMins = warnH * 60 + warnM;

    const [lockH, lockM] = (appSettings['timesheet_lock_time'] || '12:30').split(':').map(Number);
    const lockMins = lockH * 60 + lockM;

    console.log(`[TimesheetEnforcer] IST time: ${istDate.getHours()}:${String(istDate.getMinutes()).padStart(2,'0')} (${currentMinsIST}min) | Lock threshold: ${lockMins}min`);

    if (currentMinsIST >= lockMins) {
      // ── LOCK ──
      console.log('[TimesheetEnforcer] ⚠ Past lock time — locking system');
      sendLockToWindow(prevDate, false);
      if (!loggedLockToday) {
        loggedLockToday = true;
        wasLockedToday = true;
        await logLockEvent('LOCKED', `Auto Lock: timesheet missing for ${prevDate} after ${appSettings['timesheet_lock_time']} IST`);
      }
    } else if (currentMinsIST >= warnMins) {
      // ── WARNING ──
      const win = currentMainWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send('timesheet-reminder', { date: prevDate });
      }
      if (!loggedWarningToday) {
        loggedWarningToday = true;
        await logLockEvent('WARNING', `Auto Warning: timesheet missing for ${prevDate}`);
      }
    } else if (currentMinsIST >= checkMins) {
      // ── INITIAL STATUS ──
      const win = currentMainWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send('timesheet-status', { submitted: false, date: prevDate });
      }
    }
  };

  // ── Setup Realtime subscription immediately ────────────────────────────────
  setupRealtimeSubscription(currentEmployee.id);

  // ── Run evaluate rules once immediately on startup ─────────────────────────
  evaluateRules();

  // ── Primary polling: every 60 seconds (fallback for Realtime failures) ─────
  enforcerInterval = setInterval(async () => {
    evaluateRules();
  }, 60000);

  // ── Realtime reconnect watchdog: re-subscribe every 5 minutes to ensure
  //    the subscription stays alive in packaged/installed apps ─────────────────
  pollFallbackInterval = setInterval(() => {
    if (currentEmployee) {
      console.log('[TimesheetEnforcer] Realtime watchdog: refreshing subscription for', currentEmployee.id);
      setupRealtimeSubscription(currentEmployee.id);
    }
  }, 5 * 60 * 1000);
}

export function stopTimesheetEnforcer() {
  if (enforcerInterval) { clearInterval(enforcerInterval); enforcerInterval = null; }
  if (pollFallbackInterval) { clearInterval(pollFallbackInterval); pollFallbackInterval = null; }
  if (lockSubscription) {
    try { supabase.removeChannel(lockSubscription); } catch {}
    lockSubscription = null;
  }
  currentEmployee = null;
  currentMainWindow = null;
}

// Export for use when mainWindow reference changes (e.g., after re-create)
export function updateEnforcerWindow(mainWindow: BrowserWindow | null) {
  currentMainWindow = mainWindow;
  console.log('[TimesheetEnforcer] mainWindow reference updated');
}
