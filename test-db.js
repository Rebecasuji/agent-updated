import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.usoxzmpkverbehgeqzkc:Durgadevi%4067@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log("Connected successfully");
    
    const empCode = 'E0048'; // Durgadevi
    const empRes = await client.query('SELECT id FROM employees WHERE emp_code = $1', [empCode]);
    const empUuid = empRes.rows[0].id;
    console.log("Employee UUID:", empUuid);

    // Let's see recent tasks for this employee
    const subRes = await client.query(`SELECT id, title, assigned_to FROM subtasks WHERE assigned_to = $1 ORDER BY created_at DESC LIMIT 5`, [empUuid]);
    console.log("Recent Subtasks assigned_to:");
    console.table(subRes.rows);

    const subMemRes = await client.query(`SELECT s.id, s.title FROM subtasks s JOIN subtask_members sm ON s.id = sm.subtask_id WHERE sm.employee_id = $1 ORDER BY s.created_at DESC LIMIT 5`, [empUuid]);
    console.log("Recent Subtasks subtask_members:");
    console.table(subMemRes.rows);

    
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
