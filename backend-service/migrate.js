import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  await client.connect();
  console.log('Connected to Supabase Postgres...');

  const sql = `
    -- Summary Tables
    CREATE TABLE IF NOT EXISTS employee_daily_summary (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
      employee_code TEXT NOT NULL,
      date DATE NOT NULL,
      login_time TIMESTAMP WITH TIME ZONE,
      logout_time TIMESTAMP WITH TIME ZONE,
      total_session_seconds INTEGER DEFAULT 0,
      active_seconds INTEGER DEFAULT 0,
      productive_seconds INTEGER DEFAULT 0,
      non_productive_seconds INTEGER DEFAULT 0,
      idle_seconds INTEGER DEFAULT 0,
      away_seconds INTEGER DEFAULT 0,
      productivity_percentage NUMERIC(5,2) DEFAULT 0,
      top_application TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS employee_daily_app_usage (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      app_name TEXT NOT NULL,
      duration_seconds INTEGER DEFAULT 0,
      is_productive BOOLEAN,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(employee_id, date, app_name)
    );

    CREATE TABLE IF NOT EXISTS employee_monthly_summary (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
      month_year TEXT NOT NULL, -- Format: YYYY-MM
      total_active_seconds INTEGER DEFAULT 0,
      total_productive_seconds INTEGER DEFAULT 0,
      total_idle_seconds INTEGER DEFAULT 0,
      total_away_seconds INTEGER DEFAULT 0,
      average_productivity NUMERIC(5,2) DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(employee_id, month_year)
    );

    CREATE TABLE IF NOT EXISTS report_archives (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      export_date DATE NOT NULL,
      status TEXT NOT NULL, -- 'SUCCESS', 'FAILED'
      archive_url TEXT,
      archive_size_bytes BIGINT DEFAULT 0,
      records_exported INTEGER DEFAULT 0,
      records_deleted INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(export_date)
    );
  `;

  try {
    await client.query(sql);
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

runMigration();
