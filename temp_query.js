import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres.bmigbiajnhhknltuvrso:Durgadevi%4067@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const tablesRes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  const tables = tablesRes.rows.map(r => r.table_name);
  const relevantTables = tables.filter(t => t.includes('leave') || t.includes('holiday') || t.includes('od') || t.includes('permission'));
  console.log('Relevant tables:', relevantTables);
  await client.end();
}
run();
