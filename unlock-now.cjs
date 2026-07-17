const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY
);

async function unlockInstantly() {
  const { data: employees, error: errEmp } = await supabase.from('employees').select('id, employee_name');
  if (errEmp) {
    console.error('Error fetching employees:', errEmp);
    return;
  }

  const logs = employees.map(emp => ({
    employee_id: emp.id,
    employee_name: emp.employee_name,
    event_type: 'MANUAL_UNLOCK',
    reason: 'Instant global unlock requested by admin'
  }));

  const { error } = await supabase.from('timesheet_lock_logs').insert(logs);

  if (error) {
    console.error('Error inserting manual unlock logs:', error);
  } else {
    console.log(`Successfully inserted MANUAL_UNLOCK logs for ${logs.length} employees.`);
  }
}

unlockInstantly();
