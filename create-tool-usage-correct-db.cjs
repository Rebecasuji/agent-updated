const { Client } = require('pg');

// CORRECT database — the one the frontend uses
const connectionString = 'postgresql://postgres.ogqmojvzeyasqoqhkpuz:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    console.log('✅ Connected to correct DB (ogqmojvzeyasqoqhkpuz)');

    // 1. Create the table in the correct DB
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_tool_usage (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        employee_id UUID,
        employee_name TEXT,
        employee_code TEXT,
        tool_name TEXT NOT NULL,
        file_name TEXT,
        website TEXT,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ,
        total_duration_seconds INTEGER DEFAULT 0,
        active_duration_seconds INTEGER DEFAULT 0,
        date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Table created/verified');

    // 2. Disable RLS
    await client.query(`ALTER TABLE employee_tool_usage DISABLE ROW LEVEL SECURITY`);
    console.log('✅ RLS disabled');

    // 3. Grant permissions
    await client.query(`GRANT SELECT, INSERT ON employee_tool_usage TO anon, authenticated`);
    console.log('✅ Permissions granted');

    // 4. Get an employee to use for test data
    const empRes = await client.query(`SELECT id, employee_name, employee_code FROM employees LIMIT 5`);
    console.log('\nEmployees in correct DB:', empRes.rows.length);
    empRes.rows.forEach(r => console.log(' -', r.employee_name, '|', r.employee_code, '|', r.id));

    if (empRes.rows.length === 0) {
      console.log('No employees — skipping test data insert');
      return;
    }

    const emp = empRes.rows[0];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    console.log('\nInserting test data for:', emp.employee_name, '| Date:', today);

    // 5. Clear any old test data for today
    await client.query(`DELETE FROM employee_tool_usage WHERE employee_code = $1 AND date::text LIKE $2`, [emp.employee_code, '%2026-07-11%']);

    // 6. Insert realistic test records using NOW() so timestamps are clearly today
    const testRecords = [
      { tool: 'Chrome',    file: 'Gmail - Google Chrome',             website: 'mail.google.com', mins: 60 },
      { tool: 'Excel',     file: 'Monthly_Report.xlsx - Excel',       website: null,              mins: 50 },
      { tool: 'VS Code',   file: 'main.ts - Visual Studio Code',      website: null,              mins: 40 },
      { tool: 'Teams',     file: 'Microsoft Teams - Team Meeting',     website: null,              mins: 30 },
      { tool: 'Chrome',    file: 'YouTube - Google Chrome',           website: 'youtube.com',     mins: 10 },
      { tool: 'Outlook',   file: 'Inbox - Outlook',                   website: null,              mins: 20 },
    ];

    for (let i = 0; i < testRecords.length; i++) {
      const rec = testRecords[i];
      const startTime = new Date(Date.now() - (180 - i * 25) * 60 * 1000).toISOString();
      const endTime   = new Date(Date.now() - (180 - i * 25 - rec.mins) * 60 * 1000).toISOString();
      await client.query(`
        INSERT INTO employee_tool_usage 
          (employee_id, employee_name, employee_code, tool_name, file_name, website, start_time, end_time, total_duration_seconds, active_duration_seconds, date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_DATE)
      `, [emp.id, emp.employee_name, emp.employee_code,
          rec.tool, rec.file, rec.website,
          startTime, endTime, rec.mins * 60, Math.floor(rec.mins * 60 * 0.9)]);
      console.log(`  ✅ Inserted: ${rec.tool} — ${rec.file}`);
    }

    // 7. Verify
    const checkRes = await client.query(`SELECT id, tool_name, employee_name, start_time FROM employee_tool_usage ORDER BY start_time DESC LIMIT 10`);
    console.log('\n=== FINAL ROWS IN CORRECT DB ===');
    checkRes.rows.forEach(r => console.log(' -', r.tool_name, '|', r.employee_name, '|', r.start_time));

    // 8. Test the same IST range query the frontend uses
    const startOfDayIST = new Date(today + 'T00:00:00+05:30').toISOString();
    const endOfDayIST   = new Date(today + 'T23:59:59+05:30').toISOString();
    const rangeRes = await client.query(
      `SELECT id, tool_name FROM employee_tool_usage WHERE start_time >= $1 AND start_time <= $2`,
      [startOfDayIST, endOfDayIST]
    );
    console.log('\n✅ IST range query returns:', rangeRes.rows.length, 'rows');

  } catch (e) {
    console.error('❌ Error:', e.message);
  } finally {
    await client.end();
  }
}
run();
