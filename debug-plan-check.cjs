const { Client } = require('pg');

const connectionString = 'postgresql://postgres.bmigbiajnhhknltuvrso:Durgadevi%4067@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

const client = new Client({
  connectionString
});

(async () => {
  try {
    await client.connect();
    console.log('✓ Connected to timesheet DB\n');
    
    // First check what tables exist
    console.log('=== Database Tables ===');
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    if (tables.rows.length === 0) {
      console.log('No public tables found');
    } else {
      tables.rows.forEach(r => console.log(`  - ${r.table_name}`));
    }
    
    // Check schema of daily_plans
    if (tables.rows.some(t => t.table_name === 'daily_plans')) {
      console.log('\n=== daily_plans Schema ===');
      const schema = await client.query(`
        SELECT column_name, data_type FROM information_schema.columns 
        WHERE table_name = 'daily_plans' ORDER BY ordinal_position
      `);
      schema.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    }
    
    const empId = 'fb2184c5-bd55-4eb4-9212-c6c16632baef';
    const today = '2026-06-06';
    
    // Try simpler queries
    console.log(`\n=== Checking daily_plans (employee: ${empId.substring(0,8)}..., date: ${today}) ===`);
    try {
      const res = await client.query(
        'SELECT * FROM daily_plans WHERE employee_id = $1 LIMIT 5',
        [empId]
      );
      console.log(`Found ${res.rows.length} total records for this employee`);
      if (res.rows.length > 0) {
        console.log('Sample:', JSON.stringify(res.rows[0], null, 2));
      }
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
    
    console.log('\n=== Checking time_entries ===');
    try {
      const res = await client.query(
        'SELECT * FROM time_entries WHERE employee_id = $1 LIMIT 5',
        [empId]
      );
      console.log(`Found ${res.rows.length} total records for this employee`);
      if (res.rows.length > 0) {
        res.rows.forEach((r, i) => {
          console.log(`[${i}] ${r.date || 'NO_DATE'} | status=${r.status}`);
        });
      }
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
    
    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
