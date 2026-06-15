import { supabase } from './db.js';

export async function fetchAllMonitoringData(targetDateStr) {
  const startOfDay = new Date(`${targetDateStr}T00:00:00.000Z`).toISOString();
  const endOfDay = new Date(`${targetDateStr}T23:59:59.999Z`).toISOString();

  console.log(`Fetching monitoring data between ${startOfDay} and ${endOfDay}`);

  // Fetch all employees
  const { data: employees } = await supabase.from('employees').select('*');
  
  // Fetch work sessions
  const { data: sessions } = await supabase.from('work_sessions')
    .select('*')
    .gte('started_work_time', startOfDay)
    .lte('started_work_time', endOfDay);

  // Fetch activity logs (contains app usage, websites, window titles, locations, calls)
  const { data: activityLogs } = await supabase.from('activity_logs')
    .select('*')
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay);

  // Fetch idle alerts (idle logs and warnings)
  const { data: idleAlerts } = await supabase.from('idle_alerts')
    .select('*')
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);

  // Fetch screenshots
  const { data: screenshots } = await supabase.from('screenshots')
    .select('id, employee_id, app_name, captured_at') // We don't need the base64 for metadata
    .gte('captured_at', startOfDay)
    .lte('captured_at', endOfDay);

  return {
    employees: employees || [],
    sessions: sessions || [],
    activityLogs: activityLogs || [],
    idleAlerts: idleAlerts || [],
    screenshots: screenshots || [],
  };
}
