const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function check() {
  const { data: empData } = await supabase.from('employees').select('id, employee_code, employee_name').eq('employee_code', 'E0041').single();
  if (!empData) {
    console.log('Employee E0041 not found.');
    return;
  }
  
  console.log('Checking manual override for:', empData.employee_code, empData.id);
  
  const { data, error } = await supabase
    .from('timesheet_lock_logs')
    .select('event_type, created_at')
    .eq('employee_id', empData.id)
    .in('event_type', ['MANUAL_LOCK', 'MANUAL_UNLOCK'])
    .order('created_at', { ascending: false })
    .limit(1);
    
  console.log('Latest event:', data);
}

check();
