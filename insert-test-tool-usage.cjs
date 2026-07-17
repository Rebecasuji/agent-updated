const { Client } = require('pg');
const connectionString = 'postgresql://postgres.qdqypcwnrbdgqagfdeun:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    
    // 1. Get employees to use their real IDs
    const empRes = await client.query(`SELECT id, employee_name, employee_code FROM employees LIMIT 5`);
    console.log('Employees found:', empRes.rows.length);
    
    if (empRes.rows.length === 0) {
      console.log('No employees found — cannot insert test data.');
      return;
    }
    
    const today = new Date().toISOString().slice(0, 10);
    const emp = empRes.rows[0]; // Use first employee

    console.log('Using employee:', emp.employee_name, '|', emp.employee_code, '|', emp.id);

    // 2. Insert sample tool usage records
    const testRecords = [
      {
        employee_id: emp.id,
        employee_name: emp.employee_name,
        employee_code: emp.employee_code,
        tool_name: 'Chrome',
        file_name: 'Gmail - Google Chrome',
        website: 'mail.google.com',
        start_time: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        total_duration_seconds: 600,
        active_duration_seconds: 580,
        date: today,
      },
      {
        employee_id: emp.id,
        employee_name: emp.employee_name,
        employee_code: emp.employee_code,
        tool_name: 'Excel',
        file_name: 'Monthly_Report.xlsx - Microsoft Excel',
        website: null,
        start_time: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        total_duration_seconds: 600,
        active_duration_seconds: 550,
        date: today,
      },
      {
        employee_id: emp.id,
        employee_name: emp.employee_name,
        employee_code: emp.employee_code,
        tool_name: 'VS Code',
        file_name: 'main.ts - Visual Studio Code',
        website: null,
        start_time: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        total_duration_seconds: 480,
        active_duration_seconds: 460,
        date: today,
      },
      {
        employee_id: emp.id,
        employee_name: emp.employee_name,
        employee_code: emp.employee_code,
        tool_name: 'Teams',
        file_name: 'Microsoft Teams - Meeting',
        website: null,
        start_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
        total_duration_seconds: 1200,
        active_duration_seconds: 1200,
        date: today,
      },
    ];

    for (const rec of testRecords) {
      await client.query(`
        INSERT INTO employee_tool_usage 
          (employee_id, employee_name, employee_code, tool_name, file_name, website, start_time, end_time, total_duration_seconds, active_duration_seconds, date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        rec.employee_id, rec.employee_name, rec.employee_code,
        rec.tool_name, rec.file_name, rec.website,
        rec.start_time, rec.end_time,
        rec.total_duration_seconds, rec.active_duration_seconds, rec.date
      ]);
      console.log(`✅ Inserted: ${rec.tool_name} for ${rec.employee_name}`);
    }

    // 3. Verify
    const checkRes = await client.query(`SELECT id, tool_name, employee_name, date FROM employee_tool_usage ORDER BY created_at DESC LIMIT 10`);
    console.log('\n--- Records in DB ---');
    checkRes.rows.forEach(r => console.log(r.tool_name, '|', r.employee_name, '|', r.date));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
