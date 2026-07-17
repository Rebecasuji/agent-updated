const { Client } = require('pg');
const connectionString = 'postgresql://postgres.qdqypcwnrbdgqagfdeun:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    
    // Check which Supabase project this is (which schema tables live in)
    const tablesRes = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('information_schema','pg_catalog')
      ORDER BY table_schema, table_name
    `);
    console.log('\n=== ALL TABLES ===');
    tablesRes.rows.forEach(r => console.log(r.table_schema + '.' + r.table_name));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}
run();
