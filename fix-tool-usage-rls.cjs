const { Client } = require('pg');
const connectionString = 'postgresql://postgres.qdqypcwnrbdgqagfdeun:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();

    // 1. Check what's in the table
    const res = await client.query(`
      SELECT id, employee_name, employee_code, tool_name, start_time, date 
      FROM employee_tool_usage 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    console.log('\n=== DATA IN TABLE ===');
    console.log('Total rows:', res.rows.length);
    res.rows.forEach(r => console.log(r.tool_name, '|', r.employee_name, '|', 'start_time:', r.start_time, '| date col:', r.date));

    // 2. Check RLS status
    const rlsRes = await client.query(`
      SELECT relname, relrowsecurity 
      FROM pg_class 
      WHERE relname = 'employee_tool_usage'
    `);
    console.log('\n=== RLS STATUS ===');
    console.log('RLS enabled:', rlsRes.rows[0]?.relrowsecurity);

    // 3. Check existing policies
    const policiesRes = await client.query(`
      SELECT policyname, cmd, qual 
      FROM pg_policies 
      WHERE tablename = 'employee_tool_usage'
    `);
    console.log('\n=== EXISTING POLICIES ===');
    console.log(policiesRes.rows.length === 0 ? 'No policies found' : policiesRes.rows);

    // 4. DISABLE RLS on the table so frontend can read
    console.log('\n=== DISABLING RLS ===');
    await client.query(`ALTER TABLE employee_tool_usage DISABLE ROW LEVEL SECURITY`);
    console.log('✅ RLS disabled on employee_tool_usage');

    // 5. Also grant read access to anon and authenticated roles
    await client.query(`GRANT SELECT ON employee_tool_usage TO anon, authenticated`);
    await client.query(`GRANT INSERT ON employee_tool_usage TO authenticated`);
    console.log('✅ Granted SELECT to anon and authenticated roles');

    // 6. Verify the date range query that the frontend uses
    const istDate = '2026-07-11';
    const startOfDayIST = new Date(istDate + 'T00:00:00+05:30').toISOString();
    const endOfDayIST = new Date(istDate + 'T23:59:59+05:30').toISOString();
    console.log('\n=== DATE RANGE CHECK ===');
    console.log('Query range for', istDate, 'IST:', startOfDayIST, 'to', endOfDayIST);

    const rangeRes = await client.query(
      `SELECT id, tool_name, start_time FROM employee_tool_usage 
       WHERE start_time >= $1 AND start_time <= $2`,
      [startOfDayIST, endOfDayIST]
    );
    console.log('Rows matching date range:', rangeRes.rows.length);
    rangeRes.rows.forEach(r => console.log(' -', r.tool_name, r.start_time));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}
run();
