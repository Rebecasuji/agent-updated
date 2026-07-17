require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function run() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const startIST = new Date(today + 'T00:00:00+05:30').toISOString();
  const endIST   = new Date(today + 'T23:59:59+05:30').toISOString();

  console.log('Querying activity_logs for:', today, '(', startIST, 'to', endIST, ')');

  const { data, error } = await supabase
    .from('activity_logs')
    .select('id, employee_id, app_name, window_title, website, start_time, end_time, duration_seconds, productive, activity_type')
    .gte('start_time', startIST)
    .lte('start_time', endIST)
    .eq('activity_type', 'app')
    .not('app_name', 'is', null)
    .limit(10);

  if (error) { console.error('Error:', error); return; }
  console.log('Rows returned:', data.length);
  data.forEach(r => console.log(' -', r.app_name, '|', r.window_title?.slice(0,40), '|', r.start_time, '|', r.duration_seconds + 's'));

  // Also check distinct employees
  const { data: emps, error: empErr } = await supabase
    .from('employees')
    .select('id, employee_name, employee_code')
    .limit(10);
  if (!empErr) {
    console.log('\nEmployees:', emps.length);
    emps.forEach(e => console.log(' -', e.employee_name, '|', e.employee_code, '|', e.id));
  }
}
run().catch(console.error);
