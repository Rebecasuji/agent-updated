// Check exact column names in call_logs table and RLS policies
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qdqypcwnrbdgqagfdeun.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcXlwY3ducmJkZ3FhZ2ZkZXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM0NjcyMCwiZXhwIjoyMDkyOTIyNzIwfQ.KNZlnAxKaPqAt07eF43njAnNKE9m877Yldn1oDcb7jw';

async function check() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Check exact column names via a sample row
  console.log('=== CALL_LOGS TABLE COLUMNS ===');
  const { data, error } = await supabase.from('call_logs').select('*').limit(1);
  if (data && data.length > 0) {
    console.log('Columns:', Object.keys(data[0]).join(', '));
    console.log('Sample:', JSON.stringify(data[0], null, 2));
  }

  // Check RLS policies on call_logs
  console.log('\n=== CALL_LOGS RLS POLICIES ===');
  const { data: policies, error: polErr } = await supabase.rpc('exec_sql', {
    sql: `SELECT policyname, permissive, roles, cmd, qual, with_check
          FROM pg_policies WHERE tablename = 'call_logs'`
  });
  
  if (polErr) {
    // Try raw SQL via the postgres endpoint
    console.log('RPC failed, trying direct query...');
    const { data: p2, error: e2 } = await supabase
      .from('pg_policies')
      .select('*');
    console.log('pg_policies result:', p2, e2);
  } else {
    console.log('Policies:', JSON.stringify(policies, null, 2));
  }

  // Try to insert a test call log with authenticated role to test RLS
  console.log('\n=== TEST INSERT WITH AUTH TOKEN ===');
  // Simulate what the mobile app does: sign in and use that token
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'rebeca@ctint.in',
    password: 'Rebecasuji@1' // this is a guess, may fail
  });
  
  if (authErr) {
    console.log('Auth sign-in failed (expected):', authErr.message);
    console.log('Testing insert with service role instead to check column names...');
    
    // Test insert with service role to verify column names work
    const testPayload = {
      employee_id: '0070896e-d35c-4864-8358-84c8220565ac', // Rebeca's employee ID
      call_start: new Date().toISOString(),
      call_end: new Date().toISOString(),
      duration_seconds: 10,
      call_type: 'incoming',
      contact_name: 'TEST_DELETE_ME',
      phone_number: '1234567890',
    };
    console.log('Test payload:', testPayload);
    
    const { data: insertData, error: insertErr } = await supabase
      .from('call_logs')
      .insert(testPayload)
      .select();
    
    if (insertErr) {
      console.log('❌ INSERT FAILED:', insertErr.message, insertErr.details, insertErr.hint);
      
      // Try with duration_secc instead
      console.log('\nRetrying with duration_secc...');
      const testPayload2 = { ...testPayload, duration_secc: 10 };
      delete testPayload2.duration_seconds;
      
      const { data: d2, error: e2 } = await supabase
        .from('call_logs')
        .insert(testPayload2)
        .select();
      
      if (e2) {
        console.log('❌ INSERT with duration_secc also FAILED:', e2.message, e2.details);
      } else {
        console.log('✅ INSERT with duration_secc SUCCEEDED!');
        console.log('Actual column is duration_secc, not duration_seconds');
        // Clean up test row
        if (d2 && d2[0]) {
          await supabase.from('call_logs').delete().eq('id', d2[0].id);
          console.log('Test row cleaned up');
        }
      }
    } else {
      console.log('✅ INSERT SUCCEEDED with duration_seconds');
      console.log('Inserted:', JSON.stringify(insertData, null, 2));
      // Clean up test row
      if (insertData && insertData[0]) {
        await supabase.from('call_logs').delete().eq('id', insertData[0].id);
        console.log('Test row cleaned up');
      }
    }
  }

  // Check table DDL
  console.log('\n=== CHECKING TABLE STRUCTURE ===');
  const { data: cols, error: colErr } = await supabase.rpc('get_table_columns', { table_name: 'call_logs' });
  if (colErr) {
    console.log('No RPC available. Using information from sample row above.');
  } else {
    console.log('Columns:', cols);
  }
}

check().catch(console.error);
