const { Client } = require('pg');

const connectionString = 'postgresql://postgres.ogqmojvzeyasqoqhkpuz:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('Connected to DB');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_tool_usage (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        employee_name TEXT,
        employee_code TEXT,
        tool_name TEXT NOT NULL,
        file_name TEXT,
        website TEXT,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ,
        total_duration_seconds INTEGER DEFAULT 0,
        active_duration_seconds INTEGER DEFAULT 0,
        date DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_employee_tool_usage_emp_id ON employee_tool_usage(employee_id);
      CREATE INDEX IF NOT EXISTS idx_employee_tool_usage_date ON employee_tool_usage(date);
    `);
    console.log('✅ Table employee_tool_usage created successfully');
  } catch (error) {
    console.error('❌ Table creation failed:', error);
  } finally {
    await client.end();
  }
}

run();
