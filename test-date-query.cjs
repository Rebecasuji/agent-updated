const { Client } = require('pg');

const connectionString = 'postgresql://postgres.bmigbiajnhhknltuvrso:Durgadevi%4067@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';
const client = new Client({ connectionString });

(async () => {
  try {
    await client.connect();
    
    // Check daily_plans schema
    const schema = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'daily_plans' ORDER BY ordinal_position
    `);
    console.log('daily_plans columns:');
    schema.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    
    // Test the exact query that's failing
    console.log('\n=== Testing exact query with to_char ===');
    const empId = 'fb2184c5-bd55-4eb4-9212-c6c16632baef';
    const today = '2026-06-06';
    
    try {
      const res = await client.query(
        `SELECT id FROM daily_plans WHERE employee_id = $1 AND to_char("date", 'YYYY-MM-DD') = $2`,
        [empId, today]
      );
      console.log('Query succeeded! Found:', res.rows.length);
    } catch (e) {
      console.log('Query FAILED:', e.message);
      
      // Try alternative without to_char
      console.log('\n=== Testing with direct date comparison ===');
      const res2 = await client.query(
        `SELECT id FROM daily_plans WHERE employee_id = $1 AND "date" = $2`,
        [empId, today]
      );
      console.log('Direct comparison found:', res2.rows.length);
    }
    
    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
