import { createClient, PostgrestError, SupabaseClient } from '@supabase/supabase-js';

const getSupabaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined') {
    if (import.meta.env.VITE_SUPABASE_URL) return import.meta.env.VITE_SUPABASE_URL;
  }
  return process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
};

const getSupabaseAnonKey = (): string => {
  if (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined') {
    if (import.meta.env.VITE_SUPABASE_ANON_KEY) return import.meta.env.VITE_SUPABASE_ANON_KEY;
  }
  return process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
};

let supabaseClient: SupabaseClient | null = null;

const initializeSupabase = (): SupabaseClient => {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();

  if (!supabaseUrl) {
    throw new Error('Supabase initialization failed: VITE_SUPABASE_URL or SUPABASE_URL is required.');
  }
  if (!supabaseAnonKey) {
    throw new Error('Supabase initialization failed: VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY is required.');
  }

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
};

export const supabase = new Proxy({} as SupabaseClient, {
  get(target, prop) {
    const client = initializeSupabase();
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
  set(target, prop, value) {
    const client = initializeSupabase();
    (client as any)[prop] = value;
    return true;
  },
  has(target, prop) {
    const client = initializeSupabase();
    return prop in client;
  },
  ownKeys(target) {
    return Reflect.ownKeys(initializeSupabase());
  },
  getOwnPropertyDescriptor(target, prop) {
    const descriptor = Object.getOwnPropertyDescriptor(initializeSupabase(), prop);
    if (descriptor) descriptor.configurable = true;
    return descriptor;
  },
});

export interface Employee {
  id: string;
  employee_code: string;
  employee_name: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  position?: string;
  department?: string;
  phone?: string;
  password_hash: string;
  role?: 'user' | 'admin' | 'superadmin' | 'employee';
  productive_apps?: string[];
  shift_start?: string;
  shift_end?: string;
  timesheet_exempt?: boolean;
  created_at: string;
}

export interface AppSettings {
  id: string;
  setting_key: string;
  setting_value: string;
  updated_at?: string;
}

export interface WorkSession {
  id: string;
  employee_id: string;
  session_date: string;
  punched_in: boolean;
  punch_in_time: string | null;
  started_work_time: string | null;
  plan_submitted: boolean;
  plan_text: string;
  active_seconds: number;
  idle_seconds: number;
  productive_seconds: number;
  day_finished?: boolean;
  ended_work_time?: string | null;
  created_at: string;
}

export interface TimesheetLockLog {
  id: string;
  employee_id: string;
  employee_name: string;
  event_type: 'WARNING' | 'LOCKED' | 'MANUAL_LOCK' | 'MANUAL_UNLOCK' | 'AUTO_UNLOCK';
  admin_id: string | null;
  admin_name: string | null;
  reason: string | null;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  session_id: string | null;
  employee_id: string;
  app_name: string;
  window_title: string;
  activity_type: string;
  idle_reason?: string | null;
  logged_at: string;
  cpu_usage?: number;
  memory_usage?: number;
  duration_seconds?: number;
  productive?: boolean;
  website?: string;
}

export async function loginEmployee(
  employeeCode: string,
  employeeName: string,
  password: string
): Promise<{ employee: Employee | null; error: PostgrestError | null }> {
  const normalizedCode = employeeCode.trim().toUpperCase();
  const normalizedName = employeeName.trim();

  try {
    // Try primary database first
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('employee_code', normalizedCode)
      .eq('password_hash', password)
      .maybeSingle() as { data: Employee | null; error: PostgrestError | null };

    if (error) {
      console.error('Login query error:', error);
      // Continue to try login logs fallback
    }

    if (data) {
      // Employee found in employees table
      return { employee: data, error };
    }

    // Fallback: first try login_logs by employee code
    let loginLog: any | null = null;
    let loginError: PostgrestError | null = null;

    const codeResult = await supabase
      .from('login_logs')
      .select('*')
      .eq('employee_code', normalizedCode)
      .eq('password', password)
      .maybeSingle() as { data: any | null; error: PostgrestError | null };

    if (codeResult.error) {
      console.error('Login logs by code error:', codeResult.error);
      loginError = codeResult.error;
    }
    loginLog = codeResult.data;

    if (!loginLog && normalizedName) {
      const nameResult = await supabase
        .from('login_logs')
        .select('*')
        .ilike('username', normalizedName)
        .eq('password', password)
        .maybeSingle() as { data: any | null; error: PostgrestError | null };

      if (nameResult.error) {
        console.error('Login logs by name error:', nameResult.error);
        loginError = loginError || nameResult.error;
      }
      loginLog = nameResult.data || loginLog;
    }

    if (loginLog) {
      // IMPORTANT: Do NOT use a synthetic "emp-XXXX" id here as it breaks screenshot
      // mapping between the agent and the monitoring dashboard.
      // Instead, look up the real employee record by employee_code, or upsert one so
      // every part of the system uses the same real database UUID.

      const empCode = (loginLog.employee_code || normalizedCode).toUpperCase();
      const empName = loginLog.username || normalizedName || empCode;

      // 1. First try to find existing employee by code (without password constraint,
      //    since login_logs may store plain-text passwords while employees stores hashed).
      const { data: existingEmp } = await supabase
        .from('employees')
        .select('*')
        .eq('employee_code', empCode)
        .maybeSingle() as { data: Employee | null; error: PostgrestError | null };

      if (existingEmp) {
        // Employee record already exists — return it with updated password_hash so
        // subsequent direct logins work too.
        console.log(`[Login] Found existing employee record for ${empCode} via login_logs fallback, id=${existingEmp.id}`);
        return { employee: existingEmp, error: null };
      }

      // 2. No employee record yet — upsert one so we get a real UUID.
      const newEmpPayload = {
        employee_code: empCode,
        employee_name: empName,
        password_hash: password,
        role: 'employee' as const,
      };

      const { data: upsertedEmp, error: upsertError } = await supabase
        .from('employees')
        .insert([newEmpPayload])
        .select()
        .maybeSingle() as { data: Employee | null; error: PostgrestError | null };

      if (upsertedEmp) {
        console.log(`[Login] Created employee record for ${empCode} via login_logs fallback, id=${upsertedEmp.id}`);
        return { employee: upsertedEmp, error: null };
      }

      // 3. If upsert failed (e.g. RLS restriction), fall back to a stable deterministic
      //    synthetic id so at least this session is consistent, but log a warning.
      if (upsertError) {
        console.warn(`[Login] Could not upsert employee record for ${empCode}:`, upsertError.message,
          '— falling back to login_logs-based object. Screenshots may not be visible in monitoring.');
      }

      // Stable fallback: use login_logs row id if available, else code-based
      const stableId = loginLog.id || `emp-${empCode}`;
      const fallbackEmployee: Employee = {
        id: stableId,
        employee_code: empCode,
        employee_name: empName,
        password_hash: password,
        created_at: new Date().toISOString(),
      };
      return { employee: fallbackEmployee, error: null };
    }

    return { employee: null, error: loginError };
  } catch (err) {
    console.error('Login exception:', err);
    return { employee: null, error: err as PostgrestError };
  }
}

export async function getTodaySession(employeeId: string): Promise<WorkSession | null> {
  try {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    
    // Check if session exists for today
    // Limit to the most recent matching session to avoid multiple-row errors
    const { data, error } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('session_date', today)
      .order('created_at', { ascending: false })
      .limit(1) as { data: WorkSession[] | null; error: PostgrestError | null };

    const sessionRow = Array.isArray(data) && data.length > 0 ? data[0] : null;

    if (error) {
      console.error('Error fetching today session:', error);
    }

    if (sessionRow) {
      // If started_work_time is null, set it to created_at (original session creation time, not current time)
      if (!sessionRow.started_work_time) {
        const startTime = sessionRow.created_at; // Use session creation time, not now
        console.log('[getTodaySession] Setting started_work_time for session', sessionRow.id, 'to', startTime, '(from created_at)');
        const { data: updatedSession, error: updateError } = await supabase
          .from('work_sessions')
          .update({ started_work_time: startTime })
          .eq('id', sessionRow.id)
          .select()
          .maybeSingle() as { data: WorkSession | null; error: PostgrestError | null };

        if (updateError) {
          console.error('Error updating started_work_time:', updateError);
          // Even if DB update fails, return with the updated time locally
          console.log('[getTodaySession] Returning with local started_work_time:', startTime);
          return { ...sessionRow, started_work_time: startTime };
        }
        console.log('[getTodaySession] DB update succeeded, returning updated session');
        return updatedSession || { ...sessionRow, started_work_time: startTime };
      }
      console.log('[getTodaySession] Session already has started_work_time:', sessionRow.started_work_time);
      return sessionRow;
    }

    // Create new session if doesn't exist
    // On FIRST login of the day, set started_work_time to NOW
    const now = new Date().toISOString();
    const { data: newSession, error: insertError } = await supabase
      .from('work_sessions')
      .insert({
        employee_id: employeeId,
        session_date: today,
        punched_in: false,
        punch_in_time: null,
        started_work_time: now,
        plan_submitted: false,
        plan_text: '',
        active_seconds: 0,
        idle_seconds: 0,
        productive_seconds: 0,
      })
      .select()
      .maybeSingle() as { data: WorkSession | null; error: PostgrestError | null };

    if (insertError) {
      console.error('Error creating today session:', insertError);
      // Return a local session object as fallback
      return {
        id: `session-${employeeId}-${today}`,
        employee_id: employeeId,
        session_date: today,
        punched_in: false,
        punch_in_time: null,
        started_work_time: now,
        plan_submitted: false,
        plan_text: '',
        active_seconds: 0,
        idle_seconds: 0,
        productive_seconds: 0,
        created_at: new Date().toISOString(),
      };
    }

    return newSession;
  } catch (err) {
    console.error('Error in getTodaySession:', err);
    return null;
  }
}

export async function updateSessionPlan(
  sessionId: string,
  planText: string
): Promise<WorkSession | null> {
  const { data, error } = await supabase
    .from('work_sessions')
    .update({ plan_text: planText, plan_submitted: true })
    .eq('id', sessionId)
    .select()
    .maybeSingle() as { data: WorkSession | null; error: PostgrestError | null };

  if (error) {
    console.error('Error updating session plan:', error);
    return null;
  }

  return data;
}

export async function markPlanAsSubmitted(sessionId: string): Promise<WorkSession | null> {
  const { data, error } = await supabase
    .from('work_sessions')
    .update({ plan_submitted: true })
    .eq('id', sessionId)
    .select()
    .maybeSingle() as { data: WorkSession | null; error: PostgrestError | null };

  if (error) {
    console.error('Error marking plan as submitted:', error);
    return null;
  }

  return data;
}

export async function punchInSession(
  sessionId: string,
  punchInTime: string
): Promise<WorkSession | null> {
  const { data, error } = await supabase
    .from('work_sessions')
    .update({ punched_in: true, punch_in_time: punchInTime })
    .eq('id', sessionId)
    .select()
    .maybeSingle() as { data: WorkSession | null; error: PostgrestError | null };

  if (error) {
    console.error('Error punching in session:', error);
    return null;
  }

  return data;
}

export async function syncSessionMetrics(
  sessionId: string,
  activeSeconds: number,
  idleSeconds: number,
  productiveSeconds: number
): Promise<WorkSession | null> {
  const { data, error } = await supabase
    .from('work_sessions')
    .update({
      active_seconds: activeSeconds,
      idle_seconds: idleSeconds,
      productive_seconds: productiveSeconds,
    })
    .eq('id', sessionId)
    .select()
    .maybeSingle() as { data: WorkSession | null; error: PostgrestError | null };

  if (error) {
    console.error('Error syncing session metrics:', error);
    return null;
  }

  return data;
}

export async function finishDay(sessionId: string): Promise<WorkSession | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('work_sessions')
    .update({
      day_finished: true,
      ended_work_time: now,
    })
    .eq('id', sessionId)
    .select()
    .maybeSingle() as { data: WorkSession | null; error: PostgrestError | null };

  if (error) {
    console.error('Error finishing day:', error);
    return null;
  }

  return data;
}

export async function fetchAllEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*') as {
    data: Employee[] | null;
    error: PostgrestError | null;
  };
  if (error) {
    console.error('Error fetching employees:', error);
    return [];
  }
  return data || [];
}

export async function fetchRecentSessions(limit = 50): Promise<WorkSession[]> {
  const { data, error } = await supabase
    .from('work_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit) as {
      data: WorkSession[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching sessions:', error);
    return [];
  }

  return data || [];
}

export async function fetchSessionsByDate(dateString: string): Promise<WorkSession[]> {
  const { data, error } = (await supabase
    .from('work_sessions')
    .select('*')
    .eq('session_date', dateString)
    .order('punch_in_time', { ascending: true })
    .order('created_at', { ascending: false })) as {
      data: WorkSession[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching sessions by date:', error);
    return [];
  }

  return data || [];
}

export async function fetchAllRecentSessions(): Promise<WorkSession[]> {
  const { data, error } = await supabase
    .from('work_sessions')
    .select('*')
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false }) as {
      data: WorkSession[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching all recent sessions:', error);
    return [];
  }

  return data || [];
}


export async function fetchRecentActivityLogs(limit = 100) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .order('logged_at', { ascending: false })
    .limit(limit) as {
      data: ActivityLog[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching activity logs:', error);
    return [];
  }

  const logs = data || [];
  return logs.map(log => {
    if (log.activity_type === 'idle_reason' && !log.idle_reason) {
      const match = log.window_title?.match(/\(Reason:\s*(.+)\)$/);
      log.idle_reason = match ? match[1] : log.window_title;
    }
    return log;
  });
}

export async function fetchActivityLogsByDate(dateString: string) {
  const startOfDay = new Date(`${dateString}T00:00:00`).toISOString();
  const endOfDay = new Date(`${dateString}T23:59:59.999`).toISOString();

  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .gte('logged_at', startOfDay)
    .lte('logged_at', endOfDay)
    .order('logged_at', { ascending: false }) as {
      data: ActivityLog[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching activity logs by date:', error);
    return [];
  }

  const logs = data || [];
  return logs.map(log => {
    if (log.activity_type === 'idle_reason' && !log.idle_reason) {
      const match = log.window_title?.match(/\(Reason:\s*(.+)\)$/);
      log.idle_reason = match ? match[1] : log.window_title;
    }
    return log;
  });
}

export async function fetchEmployeeSessionByDate(employeeId: string, dateString: string): Promise<WorkSession | null> {
  const { data, error } = await supabase
    .from('work_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('session_date', dateString)
    .maybeSingle() as { data: WorkSession | null; error: PostgrestError | null };

  if (error) {
    console.error('Error fetching employee session by date:', error);
    return null;
  }
  return data;
}

export async function fetchEmployeeActivityLogsByDate(employeeId: string, dateString: string) {
  const startOfDay = new Date(`${dateString}T00:00:00`).toISOString();
  const endOfDay = new Date(`${dateString}T23:59:59.999`).toISOString();

  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('logged_at', startOfDay)
    .lte('logged_at', endOfDay)
    .order('logged_at', { ascending: false }) as {
      data: ActivityLog[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching employee activity logs by date:', error);
    return [];
  }

  const logs = data || [];
  return logs.map(log => {
    if (log.activity_type === 'idle_reason' && !log.idle_reason) {
      const match = log.window_title?.match(/\(Reason:\s*(.+)\)$/);
      log.idle_reason = match ? match[1] : log.window_title;
    }
    return log;
  });
}

export async function fetchEmployeeActivity(employeeId: string, limit = 100) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('employee_id', employeeId)
    .order('logged_at', { ascending: false })
    .limit(limit) as {
      data: ActivityLog[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching employee activity:', error);
    return [];
  }

  return data || [];
}

export async function fetchAllEmployeeActivity(limit = 500) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .order('logged_at', { ascending: false })
    .limit(limit) as {
      data: ActivityLog[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching all employee activity:', error);
    return [];
  }

  return data || [];
}

export async function createActivityLog(entry: {
  session_id: string | null;
  employee_id: string;
  app_name: string;
  window_title: string;
  activity_type: string;
  idle_reason?: string | null;
  duration_seconds?: number;
  logged_at: string;
  cpu_usage?: number;
  memory_usage?: number;
  website?: string;
  productive?: boolean;
}) {
  const payload = {
    session_id: entry.session_id,
    employee_id: entry.employee_id,
    app_name: entry.app_name,
    window_title: entry.idle_reason ? `${entry.window_title} (Reason: ${entry.idle_reason})`.trim() : entry.window_title,
    activity_type: entry.activity_type,
    logged_at: entry.logged_at,
    cpu_usage: entry.cpu_usage || 0,
    memory_usage: entry.memory_usage || 0,
    duration_seconds: entry.duration_seconds || 0,
    productive: entry.productive || false,
    website: entry.website || '',
  };

  const { data, error } = await supabase.from('activity_logs').insert([payload]) as {
    data: ActivityLog[] | null;
    error: PostgrestError | null;
  };

  if (error) {
    console.error('Error writing activity log:', error);
    return null;
  }
  return data;
}

export interface IdleAlert {
  id?: string;
  employee_id: string;
  session_id: string;
  idle_since: string;
  response: string;
  reason: string;
  description: string;
  created_at?: string;
}

export async function createIdleAlert(entry: IdleAlert): Promise<boolean> {
  const { error } = await supabase.from('idle_alerts').insert([entry]);
  if (error) {
    console.error('Error creating idle alert:', error);
    return false;
  }
  return true;
}

export async function fetchIdleAlertsByDate(employeeId: string, dateStr: string): Promise<IdleAlert[]> {
  const nextDateStr = new Date(new Date(dateStr).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('idle_alerts')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('created_at', `${dateStr}T00:00:00.000Z`)
    .lt('created_at', `${nextDateStr}T00:00:00.000Z`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching idle alerts:', error);
    return [];
  }
  return data || [];
}

export interface Screenshot {
  id: string;
  employee_id: string;
  session_id: string | null;
  screenshot_data: string;
  captured_at: string;
  app_name: string;
  url?: string;
}

export async function createScreenshot(entry: {
  employee_id: string;
  session_id: string | null;
  screenshot_data: string;
  app_name: string;
  captured_at?: string;
  url?: string;
}) {
  const payload = {
    employee_id: entry.employee_id,
    session_id: entry.session_id,
    screenshot_data: entry.screenshot_data,
    app_name: entry.app_name,
    captured_at: entry.captured_at || new Date().toISOString(),
    url: entry.url || `${entry.app_name}-${entry.captured_at || new Date().toISOString()}`,
  };

  const { data, error } = await supabase.from('screenshots').insert([payload]).select() as {
    data: Screenshot[] | null;
    error: PostgrestError | null;
  };
  if (error) {
    console.error('Error writing screenshot:', error);
    return null;
  }
  return data;
}

export async function getEmployeeScreenshots(employeeId: string, limit = 10): Promise<Screenshot[]> {
  // Primary query: by real UUID
  const { data, error } = await supabase
    .from('screenshots')
    .select('*')
    .eq('employee_id', employeeId)
    .order('captured_at', { ascending: false })
    .limit(limit) as {
      data: Screenshot[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching screenshots:', error);
    return [];
  }

  const primary = data || [];

  // Backward-compatibility: also fetch screenshots stored under the legacy
  // synthetic "emp-XXXX" ID (created before the employee-ID mapping fix).
  // Look up the employee_code to build the legacy ID.
  if (primary.length === 0) {
    try {
      const { data: empRow } = await supabase
        .from('employees')
        .select('employee_code')
        .eq('id', employeeId)
        .maybeSingle() as { data: { employee_code: string } | null; error: PostgrestError | null };

      if (empRow?.employee_code) {
        const legacyId = `emp-${empRow.employee_code.toUpperCase()}`;
        const { data: legacyData } = await supabase
          .from('screenshots')
          .select('*')
          .eq('employee_id', legacyId)
          .order('captured_at', { ascending: false })
          .limit(limit) as { data: Screenshot[] | null; error: PostgrestError | null };
        if (legacyData && legacyData.length > 0) {
          console.log(`[Screenshots] Found ${legacyData.length} screenshots under legacy id ${legacyId}`);
          return legacyData;
        }
      }
    } catch (legacyErr) {
      console.warn('[Screenshots] Legacy ID fallback lookup failed:', legacyErr);
    }
  }

  return primary;
}

export async function getEmployeeScreenshotsByDate(employeeId: string, dateString: string): Promise<Screenshot[]> {
  const startOfDay = new Date(`${dateString}T00:00:00`).toISOString();
  const endOfDay = new Date(`${dateString}T23:59:59.999`).toISOString();

  // Primary query: by real UUID
  const { data, error } = await supabase
    .from('screenshots')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('captured_at', startOfDay)
    .lte('captured_at', endOfDay)
    .order('captured_at', { ascending: false }) as {
      data: Screenshot[] | null;
      error: PostgrestError | null;
    };

  if (error) {
    console.error('Error fetching screenshots by date:', error);
    return [];
  }

  const primary = data || [];

  // Backward-compatibility: also fetch screenshots stored under the legacy
  // synthetic "emp-XXXX" ID (created before the employee-ID mapping fix).
  if (primary.length === 0) {
    try {
      const { data: empRow } = await supabase
        .from('employees')
        .select('employee_code')
        .eq('id', employeeId)
        .maybeSingle() as { data: { employee_code: string } | null; error: PostgrestError | null };

      if (empRow?.employee_code) {
        const legacyId = `emp-${empRow.employee_code.toUpperCase()}`;
        const { data: legacyData } = await supabase
          .from('screenshots')
          .select('*')
          .eq('employee_id', legacyId)
          .gte('captured_at', startOfDay)
          .lte('captured_at', endOfDay)
          .order('captured_at', { ascending: false }) as { data: Screenshot[] | null; error: PostgrestError | null };
        if (legacyData && legacyData.length > 0) {
          console.log(`[Screenshots] Found ${legacyData.length} screenshots under legacy id ${legacyId} for date ${dateString}`);
          return legacyData;
        }
      }
    } catch (legacyErr) {
      console.warn('[Screenshots] Legacy ID fallback lookup failed:', legacyErr);
    }
  }

  return primary;
}

export async function getTimesheetLockLogsByDate(employeeId: string, dateString: string): Promise<TimesheetLockLog[]> {
  const startOfDay = new Date(`${dateString}T00:00:00`).toISOString();
  const endOfDay = new Date(`${dateString}T23:59:59.999`).toISOString();

  const { data, error } = await supabase
    .from('timesheet_locks')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching timesheet lock logs by date:', error);
    return [];
  }

  return data as TimesheetLockLog[];
}

export interface MonitoringSettings {
  id: string;
  idle_timeout_minutes: number;
  idle_alert_countdown_seconds: number;
  screenshot_interval_minutes: number;
  track_apps: boolean;
  track_websites: boolean;
  track_keystrokes: boolean;
  blur_screenshots: boolean;
  updated_at?: string;
}

export interface AppClassification {
  id: string;
  name: string;
  classification: 'productive' | 'non_productive' | 'neutral';
  created_at?: string;
}

export async function getMonitoringSettings(): Promise<MonitoringSettings | null> {
  try {
    const { data, error } = await supabase
      .from('monitoring_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle() as { data: MonitoringSettings | null; error: PostgrestError | null };

    if (error) {
      console.error('Error fetching monitoring settings:', error);
      return null;
    }

    if (!data) {
      // Seed default settings
      const defaultSettings: MonitoringSettings = {
        id: 'default',
        screenshot_interval_minutes: 3,
        idle_timeout_minutes: 1, // Set to 1 minute for easy and fast testing
        idle_alert_countdown_seconds: 30,
        track_apps: true,
        track_websites: true,
        track_keystrokes: true,
        blur_screenshots: false
      };
      
      const { data: inserted, error: insertError } = await supabase
        .from('monitoring_settings')
        .insert([defaultSettings])
        .select()
        .maybeSingle() as { data: MonitoringSettings | null; error: PostgrestError | null };

      if (insertError) {
        console.error('Error seeding monitoring settings:', insertError);
        return defaultSettings; // Return default fallback even if insert fails
      }
      return inserted;
    }

    return data;
  } catch (err) {
    console.error('Unexpected error in getMonitoringSettings:', err);
    return null;
  }
}

export async function updateMonitoringSettings(settings: Partial<MonitoringSettings>): Promise<MonitoringSettings | null> {
  const { data, error } = await supabase
    .from('monitoring_settings')
    .update(settings)
    .eq('id', 'default')
    .select()
    .maybeSingle() as { data: MonitoringSettings | null; error: PostgrestError | null };

  if (error) {
    console.error('Error updating monitoring settings:', error);
    return null;
  }
  return data;
}

export async function getAppClassifications(): Promise<AppClassification[]> {
  const { data, error } = await supabase
    .from('app_classifications')
    .select('*')
    .order('name', { ascending: true }) as { data: AppClassification[] | null; error: PostgrestError | null };

  if (error) {
    console.error('Error fetching app classifications:', error);
    return [];
  }
  return data || [];
}

export async function saveAppClassification(name: string, classification: 'productive' | 'non_productive' | 'neutral'): Promise<AppClassification | null> {
  const { data, error } = await supabase
    .from('app_classifications')
    .upsert({ name, classification }, { onConflict: 'name' })
    .select()
    .maybeSingle() as { data: AppClassification | null; error: PostgrestError | null };

  if (error) {
    console.error('Error saving app classification:', error);
    return null;
  }
  return data;
}

export async function deleteAppClassification(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('app_classifications')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting app classification:', error);
    return false;
  }
  return true;
}

export async function createEmployee(employeeData: Partial<Employee>): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .insert([employeeData])
    .select()
    .maybeSingle() as { data: Employee | null; error: PostgrestError | null };

  if (error) {
    console.error('Error creating employee:', error);
    return null;
  }
  return data;
}

export async function updateEmployee(employeeId: string, employeeData: Partial<Employee>): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .update(employeeData)
    .eq('id', employeeId)
    .select()
    .maybeSingle() as { data: Employee | null; error: PostgrestError | null };

  if (error) {
    console.error('Error updating employee:', error);
    return null;
  }
  return data;
}

export async function updateEmployeeProductiveApps(employeeId: string, appsList: string[]): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .update({ productive_apps: appsList })
    .eq('id', employeeId)
    .select()
    .maybeSingle() as { data: Employee | null; error: PostgrestError | null };

  if (error) {
    console.error('Error updating employee productive apps:', error);
    return null;
  }
  return data;
}

export async function fetchAppSettings(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('app_settings').select('*');
  if (error) {
    console.error('Error fetching app settings:', error);
    return {};
  }
  const settings: Record<string, string> = {};
  if (data) {
    data.forEach((row: AppSettings) => {
      settings[row.setting_key] = row.setting_value;
    });
  }
  return settings;
}

export async function updateAppSetting(key: string, value: string): Promise<boolean> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ setting_key: key, setting_value: value }, { onConflict: 'setting_key' });
  if (error) {
    console.error('Error updating app setting:', error);
    return false;
  }
  return true;
}

export async function logTimesheetLockEvent(
  employeeId: string, 
  employeeName: string, 
  eventType: 'WARNING' | 'LOCKED' | 'MANUAL_LOCK' | 'MANUAL_UNLOCK' | 'AUTO_UNLOCK',
  adminId?: string,
  adminName?: string,
  reason?: string
): Promise<boolean> {
  const { error } = await supabase.from('timesheet_lock_logs').insert([{
    employee_id: employeeId,
    employee_name: employeeName,
    event_type: eventType,
    admin_id: adminId || null,
    admin_name: adminName || null,
    reason: reason || null
  }]);
  if (error) {
    console.error('Error logging timesheet event:', error);
    return false;
  }
  return true;
}

export async function fetchRecentTimesheetLockLogs(limit: number = 200): Promise<TimesheetLockLog[]> {
  const { data, error } = await supabase
    .from('timesheet_lock_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit) as { data: TimesheetLockLog[] | null; error: any };

  if (error) {
    console.error('Error fetching timesheet lock logs:', error);
    return [];
  }

  return data || [];
}

