const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji%4013@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res1 = await client.query('SELECT * FROM leaves LIMIT 2');
  console.log("Leaves:", res1.rows);
  const res2 = await client.query('SELECT * FROM permissions LIMIT 2');
  console.log("Permissions:", res2.rows);

  await client.end();
}

run().catch(console.error);
