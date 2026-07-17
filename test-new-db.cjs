const { Client } = require('pg');

async function testNewDB() {
  const client = new Client({
    connectionString: 'postgresql://postgres.cwjkvasixpmieeuaield:Rebecasuji%4013@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require'
  });

  try {
    await client.connect();
    console.log("Connected to new DB.");
    
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log("Tables:", res.rows.map(r => r.table_name).join(', '));
    
    // Check specific tables if they exist
    const checkTable = async (tableName) => {
      if (res.rows.find(r => r.table_name === tableName)) {
        const cols = await client.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = $1
        `, [tableName]);
        console.log(`\nTable ${tableName} columns:`);
        cols.rows.forEach(c => console.log(` - ${c.column_name} (${c.data_type})`));
      }
    };
    
    await checkTable('timesheets');
    await checkTable('time_entries');
    await checkTable('daily_submissions');
    await checkTable('employees');
    await checkTable('users');
    
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

testNewDB();
