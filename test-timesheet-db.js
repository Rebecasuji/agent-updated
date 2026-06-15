import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.bmigbiajnhhknltuvrso:Durgadevi%4067@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log("Connected successfully to timesheet db");
    
    const tablesRes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    console.log("Tables:");
    console.log(tablesRes.rows.map(r => r.table_name).join(', '));

    const timesheetTables = tablesRes.rows.filter(r => r.table_name.includes('timesheet') || r.table_name.includes('time') || r.table_name.includes('sheet'));
    
    const t = 'daily_submissions';
    const res = await client.query(`SELECT * FROM ${t} ORDER BY submitted_at DESC LIMIT 5`);
    console.log(`\nTable ${t}:`);
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
