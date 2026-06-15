// Check auth vs employees ID mismatch
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qdqypcwnrbdgqagfdeun.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcXlwY3ducmJkZ3FhZ2ZkZXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM0NjcyMCwiZXhwIjoyMDkyOTIyNzIwfQ.KNZlnAxKaPqAt07eF43njAnNKE9m877Yldn1oDcb7jw';

async function check() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // List auth users
  console.log('=== AUTH USERS ===');
  const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
  
  if (authError) {
    console.log('ERROR listing auth users:', authError.message);
  } else {
    authUsers.users.forEach(u => {
      console.log(`Auth UID: ${u.id} | Email: ${u.email}`);
    });
  }

  // Compare with employees
  console.log('\n=== EMPLOYEES WITH EMAIL ===');
  const { data: emps } = await supabase
    .from('employees')
    .select('id, employee_name, email')
    .not('email', 'is', null);
  
  emps.forEach(emp => {
    const authUser = authUsers?.users.find(u => u.email === emp.email);
    console.log(`Employee: ${emp.employee_name} | emp.id: ${emp.id} | email: ${emp.email} | Auth UID: ${authUser?.id || 'NOT FOUND'} | MATCH: ${emp.id === authUser?.id}`);
  });

  // Check what employee_id the orphaned call logs belong to
  console.log('\n=== ORPHANED CALL LOG employee_id ===');
  const orphanId = 'd8624966-6f9a-4cf1-82bd-05496b443000';
  const authUser = authUsers?.users.find(u => u.id === orphanId);
  console.log(`employee_id ${orphanId} maps to auth user: ${authUser?.email || 'NOT FOUND'}`);
  
  // Today's call logs
  console.log('\n=== TODAY CALL LOGS ===');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: todayLogs } = await supabase
    .from('call_logs')
    .select('*')
    .gte('call_start', today.toISOString());
  
  console.log(`Today's call logs: ${todayLogs?.length || 0}`);
  todayLogs?.forEach(log => {
    console.log(`  - employee_id: ${log.employee_id} | type: ${log.call_type} | contact: ${log.contact_name} | number: ${log.phone_number} | time: ${log.call_start}`);
  });
}

check().catch(console.error);
