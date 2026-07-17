const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_KEY);

async function checkLogs() {
  const { data, error } = await supabase
    .from('timesheet_lock_logs')
    .select('employee_id, employee_name, event_type, created_at, reason')
    .order('created_at', { ascending: false })
    .limit(10);
    
  console.log('--- LATEST 10 LOGS ---');
  console.log(data);
}
checkLogs();
