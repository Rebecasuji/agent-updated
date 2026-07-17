const { Client } = require('pg');
const connectionString = 'postgresql://postgres.qdqypcwnrbdgqagfdeun:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();

    // 1. Get columns of the existing table
    const res = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'employee_daily_app_usage'
      ORDER BY ordinal_position
    `);
    console.log('\n=== employee_daily_app_usage COLUMNS ===');
    res.rows.forEach(r => console.log(r.column_name, '|', r.data_type, '| nullable:', r.is_nullable));

    // 2. Check row count and sample data
    const sampleRes = await client.query(`SELECT * FROM employee_daily_app_usage LIMIT 3`);
    console.log('\n=== SAMPLE DATA ===');
    console.log('Rows:', sampleRes.rows.length);
    if (sampleRes.rows.length > 0) console.log(sampleRes.rows[0]);

    // 3. Check RLS on this table
    const rlsRes = await client.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'employee_daily_app_usage'`);
    console.log('\nRLS enabled on employee_daily_app_usage:', rlsRes.rows[0]?.relrowsecurity);

    // 4. Also list ALL tables with "app" or "usage" in them 
    const tablesRes = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND (table_name LIKE '%app%' OR table_name LIKE '%usage%' OR table_name LIKE '%tool%')
      ORDER BY table_name
    `);
    console.log('\n=== RELATED TABLES ===');
    tablesRes.rows.forEach(r => console.log(' -', r.table_name));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}
run();
