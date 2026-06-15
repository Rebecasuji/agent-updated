import { supabase } from './db.js';

export async function deleteOldData(dateStr) {
  const targetDate = new Date(`${dateStr}T23:59:59.999Z`);
  const cutoff48h = new Date(targetDate.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const cutoff7d = new Date(targetDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  console.log(`Deleting general logs older than ${cutoff48h}`);
  console.log(`Deleting screenshots older than ${cutoff7d}`);

  let deletedCount = 0;

  // Delete activity_logs (handles window_titles, call_logs, location_logs, browser_history, apps)
  const { data: actDeleted, error: err1 } = await supabase.from('activity_logs').delete().lt('start_time', cutoff48h).select('id');
  if (err1) throw err1;
  deletedCount += (actDeleted?.length || 0);

  // Delete idle_alerts (handles warnings, idle reasons)
  const { data: idleDeleted, error: err2 } = await supabase.from('idle_alerts').delete().lt('created_at', cutoff48h).select('id');
  if (err2) throw err2;
  deletedCount += (idleDeleted?.length || 0);

  // Delete screenshots
  const { data: ssDeleted, error: err3 } = await supabase.from('screenshots').delete().lt('captured_at', cutoff7d).select('id');
  if (err3) throw err3;
  deletedCount += (ssDeleted?.length || 0);

  return deletedCount;
}
