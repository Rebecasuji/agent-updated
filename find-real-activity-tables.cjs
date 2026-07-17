require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function run() {
  // List all tables
  const { Client } = require('pg');
  const client = new Client({
    connectionString: 'postgresql://postgres.ogqmojvzeyasqoqhkpuz:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const tablesRes = await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `);
  console.log('=== ALL TABLES ===');
  tablesRes.rows.forEach(r => console.log(' -', r.table_name));

  // Check activity_logs table
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  console.log('\n=== TODAY:', today, '===');

  for (const t of ['activity_logs', 'work_activity', 'employee_activities', 'activities', 'app_usage', 'activity']) {
    try {
      const res = await client.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`Table ${t}: ${res.rows[0].count} rows`);
    } catch(e) { /* skip */ }
  }

  // Check what columns activity_logs has
  try {
    const colRes = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'activity_logs' ORDER BY ordinal_position
    `);
    console.log('\n=== activity_logs COLUMNS ===');
    colRes.rows.forEach(r => console.log(r.column_name, '|', r.data_type));

    const sampleRes = await client.query(`
      SELECT * FROM activity_logs 
      WHERE created_at >= NOW() - INTERVAL '1 day'
      ORDER BY created_at DESC LIMIT 5
    `);
    console.log('\n=== RECENT activity_logs ROWS ===', sampleRes.rows.length);
    if (sampleRes.rows.length > 0) console.log(JSON.stringify(sampleRes.rows[0], null, 2));
  } catch(e) { console.log('activity_logs error:', e.message); }

  await client.end();
}
run().catch(console.error);
