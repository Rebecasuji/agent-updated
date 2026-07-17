const { Client } = require('pg');

async function checkSchema() {
  const client = new Client({
    connectionString: 'postgresql://postgres.cwjkvasixpmieeuaield:Rebecasuji%4013@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'
  });

  try {
    await client.connect();
    
    // Get all tables in the public schema
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log("Tables in public schema:");
    console.log(tables);
    
    // Get columns for each table
    for (const table of tables) {
      const columnsRes = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
      `, [table]);
      
      console.log(`\nTable: ${table}`);
      columnsRes.rows.forEach(col => {
        console.log(`  - ${col.column_name} (${col.data_type})`);
      });
    }
  } catch (error) {
    console.error('Error connecting to database:', error);
  } finally {
    await client.end();
  }
}

checkSchema();
