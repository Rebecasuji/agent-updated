require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('Supabase URL:', supabaseUrl);
console.log('Anon Key:', supabaseKey ? supabaseKey.slice(0, 30) + '...' : 'NOT SET');

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const startOfDayIST = new Date(today + 'T00:00:00+05:30').toISOString();
  const endOfDayIST = new Date(today + 'T23:59:59+05:30').toISOString();

  console.log('\n=== TESTING SUPABASE JS CLIENT ===');
  console.log('Date:', today, 'IST');
  console.log('Range:', startOfDayIST, 'to', endOfDayIST);

  const { data, error } = await supabase
    .from('employee_tool_usage')
    .select('*')
    .gte('start_time', startOfDayIST)
    .lte('start_time', endOfDayIST)
    .order('start_time', { ascending: false });

  if (error) {
    console.error('\n❌ SUPABASE ERROR:', JSON.stringify(error, null, 2));
  } else {
    console.log('\n✅ ROWS RETURNED:', data?.length ?? 0);
    data?.forEach(r => console.log(' -', r.tool_name, '|', r.employee_name, '|', r.start_time));
  }

  // Try fetching all rows without filter
  console.log('\n=== NO FILTER QUERY ===');
  const { data: all, error: err2 } = await supabase.from('employee_tool_usage').select('id, tool_name').limit(5);
  if (err2) {
    console.error('❌ No filter error:', JSON.stringify(err2, null, 2));
  } else {
    console.log('✅ All rows (no filter):', all?.length, all);
  }
}

run().catch(console.error);
