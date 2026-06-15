const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji%4013@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);
  console.log("Tables:");
  res.rows.forEach(r => console.log(r.table_name));

  await client.end();
}

run().catch(console.error);
