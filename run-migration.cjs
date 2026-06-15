const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres.qdqypcwnrbdgqagfdeun:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function runMigration() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to DB');
    const sql = fs.readFileSync(path.join(__dirname, 'supabase/migrations/20260601_mobile_tracking_rls.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ Migration executed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await client.end();
  }
}

runMigration();
