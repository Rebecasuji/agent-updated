// Mobile App Sync Service
// Fetches and syncs data from TimeGuardAgent mobile app

import { supabase } from './supabase';

export interface CallLog {
  id: string;
  employee_id: string;
  call_start: string;
  call_end: string;
  duration_seconds: number;
  call_type: 'incoming' | 'outgoing' | 'missed';
  contact_name: string | null;
  phone_number: string | null;
  created_at: string;
}

export interface FieldLocation {
  id: string;
  employee_id: string;
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  timestamp: string;
  created_at: string;
}

export interface FieldVisit {
  id: string;
  employee_id: string;
  attendance_id?: string | null;
  client_name: string;
  start_lat: number;
  start_lng: number;
  end_lat?: number | null;
  end_lng?: number | null;
  start_time: string;
  end_time?: string | null;
  status: 'ongoing' | 'completed';
  created_at: string;
}

/**
 * Fetch today's call logs for an employee
 */
export async function getTodayCallLogs(employeeId: string): Promise<CallLog[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.toISOString();

    const { data, error } = await supabase
      .from('call_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('call_start', todayStart)
      .order('call_start', { ascending: false });

    if (error) {
      console.error('[mobileSync] Error fetching call logs:', error);
      return [];
    }

    return (data || []) as CallLog[];
  } catch (err) {
    console.error('[mobileSync] Exception fetching call logs:', err);
    return [];
  }
}

/**
 * Fetch call logs for a date range
 */
export async function getCallLogsDateRange(
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<CallLog[]> {
  try {
    const { data, error } = await supabase
      .from('call_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('call_start', startDate)
      .lte('call_start', endDate)
      .order('call_start', { ascending: false });

    if (error) {
      console.error('[mobileSync] Error fetching call logs range:', error);
      return [];
    }

    return (data || []) as CallLog[];
  } catch (err) {
    console.error('[mobileSync] Exception fetching call logs range:', err);
    return [];
  }
}

/**
 * Get call statistics for today
 */
export async function getTodayCallStats(employeeId: string) {
  try {
    const callLogs = await getTodayCallLogs(employeeId);

    const stats = {
      totalCalls: callLogs.length,
      incoming: callLogs.filter(c => c.call_type === 'incoming').length,
      outgoing: callLogs.filter(c => c.call_type === 'outgoing').length,
      missed: callLogs.filter(c => c.call_type === 'missed').length,
      totalDuration: callLogs.reduce((sum, c) => sum + c.duration_seconds, 0),
      avgDuration: callLogs.length > 0
        ? Math.round(callLogs.reduce((sum, c) => sum + c.duration_seconds, 0) / callLogs.length)
        : 0,
    };

    return stats;
  } catch (err) {
    console.error('[mobileSync] Exception getting call stats:', err);
    return {
      totalCalls: 0,
      incoming: 0,
      outgoing: 0,
      missed: 0,
      totalDuration: 0,
      avgDuration: 0,
    };
  }
}

export async function getCallLogsByDate(employeeId: string, dateString: string): Promise<CallLog[]> {
  try {
    const startOfDay = new Date(`${dateString}T00:00:00`).toISOString();
    const endOfDay = new Date(`${dateString}T23:59:59.999`).toISOString();

    const { data, error } = await supabase
      .from('call_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('call_start', startOfDay)
      .lte('call_start', endOfDay)
      .order('call_start', { ascending: false });

    if (error) {
      console.error('[mobileSync] Error fetching call logs by date:', error);
      return [];
    }

    return (data || []) as CallLog[];
  } catch (err) {
    console.error('[mobileSync] Exception fetching call logs by date:', err);
    return [];
  }
}

export async function getCallStatsByDate(employeeId: string, dateString: string) {
  try {
    const callLogs = await getCallLogsByDate(employeeId, dateString);

    return {
      totalCalls: callLogs.length,
      incoming: callLogs.filter(c => c.call_type === 'incoming').length,
      outgoing: callLogs.filter(c => c.call_type === 'outgoing').length,
      missed: callLogs.filter(c => c.call_type === 'missed').length,
      totalDuration: callLogs.reduce((sum, c) => sum + c.duration_seconds, 0),
      avgDuration: callLogs.length > 0
        ? Math.round(callLogs.reduce((sum, c) => sum + c.duration_seconds, 0) / callLogs.length)
        : 0,
    };
  } catch (err) {
    console.error('[mobileSync] Exception getting call stats by date:', err);
    return {
      totalCalls: 0,
      incoming: 0,
      outgoing: 0,
      missed: 0,
      totalDuration: 0,
      avgDuration: 0,
    };
  }
}

/**
 * Fetch today's field locations
 */
export async function getTodayFieldLocations(employeeId: string): Promise<FieldLocation[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.toISOString();

    const { data, error } = await supabase
      .from('field_locations')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('timestamp', todayStart)
      .order('timestamp', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[mobileSync] Error fetching field locations:', error);
      return [];
    }

    return (data || []) as FieldLocation[];
  } catch (err) {
    console.error('[mobileSync] Exception fetching field locations:', err);
    return [];
  }
}

/**
 * Fetch today's field visits
 */
export async function getTodayFieldVisits(employeeId: string): Promise<FieldVisit[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.toISOString();

    const { data, error } = await supabase
      .from('field_visits')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('created_at', todayStart)
      .order('start_time', { ascending: false });

    if (error) {
      console.error('[mobileSync] Error fetching field visits:', error);
      return [];
    }

    return (data || []) as FieldVisit[];
  } catch (err) {
    console.error('[mobileSync] Exception fetching field visits:', err);
    return [];
  }
}

/**
 * Get the latest field location for an employee
 */
export async function getLatestFieldLocation(employeeId: string): Promise<FieldLocation | null> {
  try {
    const { data, error } = await supabase
      .from('field_locations')
      .select('*')
      .eq('employee_id', employeeId)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[mobileSync] Error fetching latest location:', error);
      return null;
    }

    return (data || null) as FieldLocation | null;
  } catch (err) {
    console.error('[mobileSync] Exception fetching latest location:', err);
    return null;
  }
}

/**
 * Subscribe to real-time call log updates for an employee
 */
export function subscribeToCallLogs(employeeId: string, callback: (logs: CallLog[]) => void) {
  // Set up real-time listener for call log changes
  const channel = supabase.channel(`call_logs:${employeeId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'call_logs', filter: `employee_id=eq.${employeeId}` },
      () => {
        getTodayCallLogs(employeeId).then(callback);
      }
    )
    .subscribe();

  return channel;
}

/**
 * Get call summary by contact
 */
export async function getCallSummaryByContact(employeeId: string): Promise<
  Array<{ contact: string; count: number; totalDuration: number }>
> {
  try {
    const callLogs = await getTodayCallLogs(employeeId);

    const contactMap = new Map<string, { count: number; totalDuration: number }>();

    callLogs.forEach(log => {
      const contact = log.contact_name || log.phone_number || 'Unknown';
      const existing = contactMap.get(contact) || { count: 0, totalDuration: 0 };
      contactMap.set(contact, {
        count: existing.count + 1,
        totalDuration: existing.totalDuration + log.duration_seconds,
      });
    });

    const result = Array.from(contactMap.entries())
      .map(([contact, data]) => ({ contact, ...data }))
      .sort((a, b) => b.count - a.count);

    return result;
  } catch (err) {
    console.error('[mobileSync] Exception getting call summary:', err);
    return [];
  }
}

/**
 * Fetch field locations for an employee for a specific date
 */
export async function getFieldLocationsByDate(employeeId: string, dateStr: string): Promise<FieldLocation[]> {
  try {
    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from('field_locations')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('timestamp', startOfDay.toISOString())
      .lte('timestamp', endOfDay.toISOString())
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Error fetching field locations:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Failed to get field locations:', err);
    return [];
  }
}

/**
 * Format duration in seconds to readable format
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}
