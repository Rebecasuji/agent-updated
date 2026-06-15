const { Client } = require('pg');

const connectionString = 'postgresql://postgres.bmigbiajnhhknltuvrso:Durgadevi%4067@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

const client = new Client({ connectionString });

(async () => {
  try {
    await client.connect();
    console.log('✓ Connected to timesheet DB\n');
    
    // Check employees table schema
    console.log('=== Employees table columns ===');
    const schemaRes = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'employees' ORDER BY ordinal_position
    `);
    schemaRes.rows.forEach(r => console.log(`  - ${r.column_name}`));
    
    // First find employee by code E0046
    console.log('\n=== Find Employee by Code E0046 ===');
    const empRes = await client.query(
      "SELECT * FROM employees WHERE id = $1 LIMIT 1",
      ['fb2184c5-bd55-4eb4-9212-c6c16632baef']
    );
    
    if (empRes.rows.length === 0) {
      console.log('Employee not found by UUID!');
      // Try to find by code
      const allEmps = await client.query("SELECT * FROM employees LIMIT 1");
      if (allEmps.rows.length > 0) {
        console.log('Sample employee record:', Object.keys(allEmps.rows[0]));
      }
      process.exit(1);
    }
    
    const employee = empRes.rows[0];
    console.log(`Found employee:`, employee);
    console.log(`Employee ID: ${employee.id}\n`);
    
    const empId = employee.id;
    const today = '2026-06-06';
    
    // Check daily_plans for today
    console.log('=== daily_plans for today ===');
    const plans = await client.query(
      `SELECT * FROM daily_plans WHERE employee_id = $1 AND date = $2`,
      [empId, today]
    );
    console.log(`Found: ${plans.rows.length} records`);
    if (plans.rows.length > 0) {
      plans.rows.forEach((r, i) => {
        console.log(`[${i}] ID: ${r.id}, Date: ${r.date}, Submitted: ${r.submitted_at}`);
      });
    }
    
    // Check daily_submissions for today
    console.log('\n=== daily_submissions for today ===');
    const subs = await client.query(
      `SELECT * FROM daily_submissions WHERE employee_id = $1 AND date = $2`,
      [empId, today]
    );
    console.log(`Found: ${subs.rows.length} records`);
    if (subs.rows.length > 0) {
      subs.rows.forEach((r, i) => {
        console.log(`[${i}] ID: ${r.id}, Date: ${r.date}`);
      });
    }
    
    // Check time_entries for today
    console.log('\n=== time_entries for today ===');
    const entries = await client.query(
      `SELECT id, date, status FROM time_entries WHERE employee_id = $1 AND date::text = $2`,
      [empId, today]
    );
    console.log(`Found: ${entries.rows.length} records`);
    if (entries.rows.length > 0) {
      entries.rows.forEach((r, i) => {
        console.log(`[${i}] ID: ${r.id}, Date: ${r.date}, Status: ${r.status}`);
      });
    }
    
    // Check time_entries without status filter
    console.log('\n=== time_entries for today (all statuses) ===');
    const entriesAll = await client.query(
      `SELECT id, date, status FROM time_entries WHERE employee_id = $1 AND date::text = $2`,
      [empId, today]
    );
    console.log(`Found: ${entriesAll.rows.length} records (all statuses)`);
    
    // Check date range around today
    console.log('\n=== Checking date range 2026-06-04 to 2026-06-08 ===');
    const range = await client.query(
      `SELECT id, date, status FROM time_entries WHERE employee_id = $1 AND date >= $2 AND date <= $3 ORDER BY date DESC`,
      [empId, '2026-06-04', '2026-06-08']
    );
    console.log(`Found: ${range.rows.length} records in this range`);
    range.rows.forEach(r => {
      console.log(`  ${r.date} | status=${r.status}`);
    });
    
    // Check all tables for today
    console.log('\n=== Check ALL 3 tables for today ===');
    const checkQuery = `
      SELECT 
        (SELECT COUNT(*) FROM daily_plans WHERE employee_id = $1 AND date = $2) as daily_plans_count,
        (SELECT COUNT(*) FROM daily_submissions WHERE employee_id = $1 AND date = $2) as daily_submissions_count,
        (SELECT COUNT(*) FROM time_entries WHERE employee_id = $1 AND date::text = $2) as time_entries_count
    `;
    const summary = await client.query(checkQuery, [empId, today]);
    console.log(JSON.stringify(summary.rows[0], null, 2));
    
    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
