import pg from 'pg';

const timesheetDbUrl = 'postgresql://postgres.cwjkvasixpmieeuaield:Rebecasuji%4013@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require';
const empCode = 'E0041';
const dateStr = '2026-07-15';

async function check() {
  const { Client } = pg;
  const client = new Client({
    connectionString: timesheetDbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to DB');

    const empRes = await client.query(`SELECT id, employee_code, email FROM employees WHERE employee_code = $1 LIMIT 1`, [empCode]);
    if (empRes.rows.length === 0) {
      console.log('Employee NOT FOUND — this is why it returns true/skips lock!');
      return;
    }
    const empId = empRes.rows[0].id;
    console.log(`Found employee UUID: ${empId}`);

    // Show ALL daily_submissions for this employee recently
    const allSubs = await client.query(
      `SELECT * FROM daily_submissions WHERE employee_id = $1 ORDER BY date DESC LIMIT 10`,
      [empId]
    );
    console.log('\nAll recent daily_submissions:');
    allSubs.rows.forEach(r => console.log(` - date: ${r.date}, status: ${r.status}, id: ${r.id}`));

    // Show ALL time_entries for this employee recently  
    const allEntries = await client.query(
      `SELECT date, status FROM time_entries WHERE employee_id = $1 ORDER BY date DESC LIMIT 10`,
      [empId]
    );
    console.log('\nAll recent time_entries:');
    allEntries.rows.forEach(r => console.log(` - date: ${r.date}, status: ${r.status}`));

    // Check columns of daily_submissions
    const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'daily_submissions'`);
    console.log('\ndaily_submissions columns:', cols.rows.map(r => r.column_name).join(', '));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    try { await client.end(); } catch {}
  }
}

check();
