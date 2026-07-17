import pg from 'pg';

const timesheetDbUrl = 'postgresql://postgres.cwjkvasixpmieeuaield:Rebecasuji%4013@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require';

async function test(empCode, dateStr) {
  const { Client } = pg;
  const client = new Client({
    connectionString: timesheetDbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    
    // Get employee UUID
    let empId = null;
    const columns = ['employee_code', 'emp_code', 'empid'];
    
    for (const col of columns) {
      try {
        const empRes = await client.query(`SELECT id FROM employees WHERE ${col} = $1`, [empCode]);
        if (empRes.rows.length > 0) {
          empId = empRes.rows[0].id;
          console.log(`Found employee by "${col}": ${empId}`);
          break;
        }
      } catch (e) {
        console.error(`Error querying column ${col}:`, e.message);
      }
    }
    
    if (!empId) {
      console.log('Employee not found');
      return;
    }

    const entriesRes = await client.query(
      "SELECT status FROM time_entries WHERE employee_id = $1 AND date = $2 AND status NOT IN ('draft', 'rejected')",
      [empId, dateStr]
    );
    console.log('time_entries:', entriesRes.rows);

    const dailySubRes = await client.query(
      "SELECT id FROM daily_submissions WHERE employee_id = $1 AND date = $2",
      [empId, dateStr]
    );
    console.log('daily_submissions:', dailySubRes.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

test('E0048', '2026-07-09');
