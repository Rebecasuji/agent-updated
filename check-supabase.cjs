const connectionString = 'postgresql://postgres.qdqypcwnrbdgqagfdeun:Rebecasuji%4013@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';
const { Client } = require('pg');
const client = new Client({ connectionString });

(async () => {
  try {
    await client.connect();
    console.log('✓ Connected to Supabase DB\n');
    
    // Get employee ID for E0046
    console.log('=== Looking up employee E0046 ===');
    const emp = await client.query('SELECT id, emp_code FROM employees WHERE emp_code = $1', ['E0046']);
    if (emp.rows.length === 0) {
      console.log('Employee not found in Supabase');
    } else {
      console.log(`Found: ${emp.rows[0].emp_code} (${emp.rows[0].id})`);
      
      // Get sessions for employee
      console.log('\n=== Employee Sessions ===');
      const sessions = await client.query(`
        SELECT id, employee_id, session_date, plan_submitted, plan_text
        FROM work_sessions
        WHERE employee_id = $1
        ORDER BY session_date DESC LIMIT 5
      `, [emp.rows[0].id]);
      
      console.log(`Found ${sessions.rows.length} sessions`);
      sessions.rows.forEach(s => {
        console.log(`\n  Date: ${s.session_date}`);
        console.log(`  Plan Submitted: ${s.plan_submitted}`);
        if (s.plan_text) {
          console.log(`  Plan Text: ${s.plan_text.substring(0, 80)}...`);
        }
      });
    }
    
    await client.end();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
