// Debug script to check call_logs table in Supabase
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qdqypcwnrbdgqagfdeun.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcXlwY3ducmJkZ3FhZ2ZkZXVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNDY3MjAsImV4cCI6MjA5MjkyMjcyMH0.E0gPigcfwjjg8cCKtC0fDQQjNqIW-YwpM-XcXN8GQj4';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcXlwY3ducmJkZ3FhZ2ZkZXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM0NjcyMCwiZXhwIjoyMDkyOTIyNzIwfQ.KNZlnAxKaPqAt07eF43njAnNKE9m877Yldn1oDcb7jw';

async function debug() {
  // Use service role key for unrestricted access
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log('=== DEBUGGING CALL LOGS ===\n');

  // 1. Check if call_logs table exists by trying to query it
  console.log('1. Checking call_logs table...');
  const { data: callLogs, error: callError } = await supabase
    .from('call_logs')
    .select('*')
    .limit(10);
  
  if (callError) {
    console.log('   ❌ ERROR querying call_logs:', callError.message);
    console.log('   ⚠️  The call_logs table may not exist! Need to create it.');
  } else {
    console.log(`   ✅ call_logs table exists. Found ${callLogs.length} records`);
    if (callLogs.length > 0) {
      console.log('   Sample record:', JSON.stringify(callLogs[0], null, 2));
    }
  }

  // 2. List all employees with their IDs
  console.log('\n2. Listing employees...');
  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('id, employee_name, email, first_name, last_name');
  
  if (empError) {
    console.log('   ❌ ERROR:', empError.message);
  } else {
    console.log(`   Found ${employees.length} employees:`);
    employees.forEach(emp => {
      console.log(`   - ID: ${emp.id} | Name: ${emp.employee_name} | Email: ${emp.email} | First: ${emp.first_name} Last: ${emp.last_name}`);
    });
  }

  // 3. Check call_logs for each employee
  if (!callError && employees) {
    console.log('\n3. Call logs per employee:');
    for (const emp of employees) {
      const { data: logs, error } = await supabase
        .from('call_logs')
        .select('*')
        .eq('employee_id', emp.id);
      
      if (error) {
        console.log(`   ${emp.employee_name}: ERROR - ${error.message}`);
      } else {
        console.log(`   ${emp.employee_name} (${emp.id}): ${logs.length} call logs`);
      }
    }
  }

  // 4. Check all call_logs regardless of employee_id
  if (!callError) {
    console.log('\n4. ALL call_logs (any employee_id):');
    const { data: allLogs, error: allErr } = await supabase
      .from('call_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (allErr) {
      console.log('   ERROR:', allErr.message);
    } else {
      console.log(`   Total records: ${allLogs.length}`);
      allLogs.forEach(log => {
        console.log(`   - employee_id: ${log.employee_id} | type: ${log.call_type} | contact: ${log.contact_name} | number: ${log.phone_number} | duration: ${log.duration_secc || log.duration_seconds}s | time: ${log.call_start}`);
      });
    }
  }

  // 5. Check RLS policies (try with anon key)
  console.log('\n5. Testing with ANON key (simulating dashboard)...');
  const anonSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: anonLogs, error: anonError } = await anonSupabase
    .from('call_logs')
    .select('*')
    .limit(5);
  
  if (anonError) {
    console.log('   ❌ ANON key cannot read call_logs:', anonError.message);
    console.log('   ⚠️  RLS policy is blocking reads! Need to add SELECT policy for anon.');
  } else {
    console.log(`   ✅ ANON key can read call_logs. Found ${anonLogs.length} records`);
  }
}

debug().catch(console.error);
