import { BrowserWindow, Notification } from 'electron';
import pg from 'pg';
import { supabase } from '../src/lib/supabase.js';

let enforcerInterval: NodeJS.Timeout | null = null;
let currentEmployee: any = null;
let lockSubscription: any = null;
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
  // Fallback to environment variable
  const url = process.env.TIMESHEET_DB_URL;
  if (!url) {
    console.warn('[TimesheetEnforcer] TIMESHEET_DB_URL not configured');
  }
  return url || undefined;
}

export async function fetchAppSettings() {
  try {
    const { data, error } = await supabase.from('app_settings').select('*');
    if (!error && data) {
      data.forEach((row: any) => {
        appSettings[row.setting_key] = row.setting_value;
      });
    }
  } catch (err) {
    console.error('[TimesheetEnforcer] Error fetching app settings:', err);
  }
}

export function getPreviousWorkingDate(): string | null {
  const now = new Date();
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0) return null; // Sunday
  if (dayOfWeek === 1) { // Monday -> Saturday
    const sat = new Date(now);
    sat.setDate(sat.getDate() - 2);
    return sat.toISOString().slice(0, 10);
  }
  const prev = new Date(now);
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
  const lmsUrl = process.env.LMS_DATABASE_URL || 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji%4013@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';
  if (!lmsUrl) return { isOnLeave: false, reason: null, leaveType: null, startDate: null, endDate: null };

  const { Client } = pg;
  const client = new Client({
    connectionString: lmsUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    
    // Check leaves (Approved Leave, Earned Leave, Casual Leave, Sick Leave, OD, etc.)
    const leavesRes = await client.query(
      `SELECT leave_type, start_date, end_date 
       FROM leaves 
       WHERE user_id = $1 
         AND start_date <= $2 
         AND end_date >= $2 
         AND status = 'Approved'
       ORDER BY CASE 
         WHEN leave_type ILIKE '%Approved Leave%' THEN 1
         WHEN leave_type ILIKE '%Earned Leave%' OR leave_type ILIKE '%EL%' THEN 2
         WHEN leave_type ILIKE '%Casual Leave%' OR leave_type ILIKE '%CL%' THEN 3
         WHEN leave_type ILIKE '%Sick Leave%' OR leave_type ILIKE '%SL%' THEN 4
         WHEN leave_type ILIKE '%OD%' OR leave_type ILIKE '%On Duty%' THEN 5
         ELSE 6 
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
    console.error('[TimesheetEnforcer] ✗ TIMESHEET_DB_URL is not configured');
    return true; // Assume submitted to avoid false locks
  }
  
  const { Client } = pg;
  const client = new Client({
    connectionString: timesheetDbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('[TimesheetEnforcer] ✓ Connected for employee:', empCode);
    
    // Get employee UUID, try multiple columns
    let empId: string | null = null;
    const columns = ['employee_code', 'emp_code', 'empid'];
    
    for (const col of columns) {
      try {
        const empRes = await client.query(`SELECT id FROM employees WHERE ${col} = $1`, [empCode]);
        if (empRes.rows.length > 0) {
          empId = empRes.rows[0].id;
          console.log(`[TimesheetEnforcer] ✓ Found employee by "${col}"`);
          break;
        }
      } catch (e) {
        // Try next column
      }
    }
    
    if (!empId) {
      console.log('[TimesheetEnforcer] Employee not found - not in timesheet system');
      await client.end();
      return true; // Employee not in timesheet system, don't lock
    }

    // Check time_entries statuses
    const entriesRes = await client.query(
      "SELECT status FROM time_entries WHERE employee_id = $1 AND date = $2 AND status NOT IN ('draft', 'rejected')",
      [empId, dateStr]
    );

    const dailySubRes = await client.query(
      "SELECT id FROM daily_submissions WHERE employee_id = $1 AND date = $2",
      [empId, dateStr]
    );

    const submitted = entriesRes.rows.length > 0 || dailySubRes.rows.length > 0;
    console.log('[TimesheetEnforcer]', submitted ? '✓ Timesheet submitted' : '✗ Timesheet NOT submitted');
    return submitted;
  } catch (err) {
    console.error('[TimesheetEnforcer] Error verifying timesheet:', err);
    return true; // assume submitted on error to avoid false positives
  } finally {
    await client.end();
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
          return 'LOCKED';
        } else if (latestEvent.event_type === 'MANUAL_UNLOCK') {
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

export async function startTimesheetEnforcer(empCode: string, mainWindow: BrowserWindow | null) {
  console.log('[TimesheetEnforcer] Starting enforcer for employee code:', empCode);
  if (enforcerInterval) clearInterval(enforcerInterval);
  if (lockSubscription) {
    supabase.removeChannel(lockSubscription);
    lockSubscription = null;
  }

  // Fetch full employee object
  const { data, error } = await supabase.from('employees').select('*').eq('employee_code', empCode).maybeSingle();
  if (error || !data) {
    console.error('[TimesheetEnforcer] Could not fetch employee for', empCode, 'error:', error);
    return;
  }
  currentEmployee = data;

  // Immediately fetch settings
  await fetchAppSettings();

  const evaluateRules = async () => {
    if (!currentEmployee) return;
    if (currentEmployee.role === 'admin' || currentEmployee.role === 'superadmin') return; // Admin bypass
    if (currentEmployee.timesheet_exempt) return; // Exempt bypass
    if (appSettings['enable_lock_screen_enforcement'] !== 'true') return; // Globally disabled

    const prevDate = getPreviousWorkingDate();
    if (!prevDate) return; // Sunday bypass

    const leaveStatus = await checkLeaveStatus(currentEmployee.employee_code, prevDate);
    if (leaveStatus.isOnLeave) {
      console.log('[TimesheetEnforcer] Leave bypass for', currentEmployee.employee_code, prevDate, 'Reason:', leaveStatus.reason);
      return; // Leave bypass
    }

    const todayDate = new Date().toISOString().slice(0, 10);
    const manualOverride = await getManualOverrideState(currentEmployee.id, todayDate);
    
    console.log('[TimesheetEnforcer] Manual override state for', currentEmployee.employee_code, currentEmployee.id, todayDate, '=>', manualOverride);
    if (manualOverride === 'LOCKED') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timesheet-lock', { date: prevDate, manual: true });
      }
      return; // Manually locked by admin
    } else if (manualOverride === 'UNLOCKED_TODAY') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timesheet-unlock');
      }
      return; // Manually unlocked today
    }

    const isSubmitted = await checkTimesheetSubmitted(currentEmployee.employee_code, prevDate);
    console.log('[TimesheetEnforcer] Submitted check for', currentEmployee.employee_code, prevDate, '=>', isSubmitted);
    if (isSubmitted) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timesheet-status', { submitted: true, date: prevDate });
        mainWindow.webContents.send('timesheet-unlock'); // Just in case it's locked
      }
      return; // Already submitted
    }

    // Parse times
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const checkTimeParts = appSettings['timesheet_check_time'].split(':');
    const checkMins = parseInt(checkTimeParts[0]) * 60 + parseInt(checkTimeParts[1]);

    const warnTimeParts = appSettings['timesheet_warning_time'].split(':');
    const warnMins = parseInt(warnTimeParts[0]) * 60 + parseInt(warnTimeParts[1]);

    const lockTimeParts = appSettings['timesheet_lock_time'].split(':');
    const lockMins = parseInt(lockTimeParts[0]) * 60 + parseInt(lockTimeParts[1]);

    if (currentMins >= lockMins) {
      // TRIGGER LOCK
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timesheet-lock', { date: prevDate });
      }
    } else if (currentMins >= warnMins) {
      // TRIGGER WARNING POPUP
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timesheet-warning', { date: prevDate });
      }
    } else if (currentMins >= checkMins) {
      // Initial Check - Maybe send a status or a native notification
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timesheet-status', { submitted: false, date: prevDate });
      }
    }
  };

  // Run once immediately (useful for persistence on restart)
  evaluateRules();

  // Run every minute
  enforcerInterval = setInterval(() => {
    fetchAppSettings(); // refreshing settings periodically
    evaluateRules();
  }, 60000);

  // Setup Realtime Subscription for immediate Manual Lock / Unlock
  lockSubscription = supabase
    .channel('timesheet_lock_logs_changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'timesheet_lock_logs', filter: `employee_id=eq.${currentEmployee.id}` },
      (payload) => {
        console.log('[TimesheetEnforcer] Realtime lock log received:', payload);
        const newLog = payload.new;
        if (!newLog) return;
        
        const prevDate = getPreviousWorkingDate();
        if (!prevDate) return;

        if (newLog.event_type === 'MANUAL_LOCK') {
          if (mainWindow && !mainWindow.isDestroyed()) {
             // Display warning message immediately
             mainWindow.webContents.send('timesheet-warning', { date: prevDate, manual: true });
             // Then show lock screen after a brief delay
             setTimeout(() => {
               if (mainWindow && !mainWindow.isDestroyed()) {
                 mainWindow.webContents.send('timesheet-lock', { date: prevDate, manual: true });
               }
             }, 5000); // 5 seconds
          }
        } else if (newLog.event_type === 'MANUAL_UNLOCK') {
          if (mainWindow && !mainWindow.isDestroyed()) {
             mainWindow.webContents.send('timesheet-unlock');
          }
        }
      }
    )
    .subscribe();
}

export function stopTimesheetEnforcer() {
  if (enforcerInterval) clearInterval(enforcerInterval);
  if (lockSubscription) {
    supabase.removeChannel(lockSubscription);
    lockSubscription = null;
  }
  currentEmployee = null;
}
