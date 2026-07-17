const { Client } = require('pg');
const connectionString = 'postgresql://postgres.qdqypcwnrbdgqagfdeun:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const res = await client.query('SELECT * FROM employee_tool_usage ORDER BY created_at DESC LIMIT 5');
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
