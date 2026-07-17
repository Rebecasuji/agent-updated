const { Client } = require('pg');

const DB_URL = 'postgresql://postgres.cwjkvasixpmieeuaield:Rebecasuji%4013@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require';

// Get previous working date in IST (exactly like the enforcer)
function getPreviousWorkingDate() {
  const now = new Date();
  const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istString);
  const dayOfWeek = istDate.getDay();
  console.log('IST Today:', istString, '| Day of week:', ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeek]);
  if (dayOfWeek === 0) return null; // Sunday
  if (dayOfWeek === 1) {
    const sat = new Date(istDate);
    sat.setDate(sat.getDate() - 2);
    return sat.toISOString().slice(0, 10); // Saturday
  }
  const prev = new Date(istDate);
  prev.setDate(prev.getDate() - 1);
  return prev.toISOString().slice(0, 10);
}

// Get current IST time in minutes
function getCurrentISTMins() {
  const now = new Date();
  const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istString);
  return { hours: istDate.getHours(), minutes: istDate.getMinutes(), total: istDate.getHours() * 60 + istDate.getMinutes() };
}

async function verifyAll() {
  const prevDate = getPreviousWorkingDate();
  const istTime = getCurrentISTMins();
  
  console.log('\n=== VERIFICATION REPORT ===');
  console.log('Database URL:', DB_URL.replace(/:[^:@]+@/, ':****@'));
  console.log('Previous working date (IST):', prevDate || 'NULL (Today is Sunday)');
  console.log(`Current IST time: ${istTime.hours}:${String(istTime.minutes).padStart(2,'0')} (${istTime.total} mins)`);
  console.log(`Lock threshold: 12:30 IST (750 mins)`);
  console.log(`Should lock if past 12:30: ${istTime.total >= 750 ? 'YES ✓' : 'NOT YET (before 12:30)'}`);
  
  if (!prevDate) {
    console.log('\n⚠ Today is Sunday — no locking needed');
    return;
  }

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    await client.connect();
    console.log('\n✓ Connected to TimeStrap database successfully\n');

    // Get all active employees
    const empRes = await client.query(`
      SELECT id, name, employee_code 
      FROM employees 
      WHERE is_active = true 
      ORDER BY employee_code
    `);
    
    console.log(`Total active employees: ${empRes.rows.length}`);
    console.log(`Checking timesheet for date: ${prevDate}\n`);

    let submitted = 0, notSubmitted = 0;
    const notSubmittedList = [];

    for (const emp of empRes.rows) {
      // Check time_entries
      const entries = await client.query(
        `SELECT COUNT(*) as cnt FROM time_entries WHERE employee_id = $1 AND date = $2 AND status NOT IN ('draft', 'rejected')`,
        [emp.id, prevDate]
      );
      // Check daily_submissions
      const daily = await client.query(
        `SELECT COUNT(*) as cnt FROM daily_submissions WHERE employee_id = $1 AND date = $2`,
        [emp.id, prevDate]
      );
      
      const hasSubmitted = parseInt(entries.rows[0].cnt) > 0 || parseInt(daily.rows[0].cnt) > 0;
      
      if (hasSubmitted) {
        submitted++;
      } else {
        notSubmitted++;
        notSubmittedList.push(`${emp.employee_code} - ${emp.name}`);
      }
    }

    console.log(`✓ Submitted:     ${submitted}`);
    console.log(`✗ NOT submitted: ${notSubmitted}`);
    
    if (notSubmittedList.length > 0) {
      console.log('\nEmployees who will be LOCKED (if past 12:30 IST):');
      notSubmittedList.forEach(e => console.log(' ✗', e));
    } else {
      console.log('\n✓ All employees have submitted — no one will be locked');
    }
    
    console.log('\n=== MANUAL LOCK QUERY ===');
    console.log(`-- Replace E0041 with any employee code`);
    console.log(`INSERT INTO timesheet_lock_logs (employee_id, employee_name, event_type, reason)`);
    console.log(`SELECT id, employee_name, 'MANUAL_LOCK', 'Admin lock'`);
    console.log(`FROM employees WHERE employee_code = 'E0041';`);
    
    console.log('\n=== MANUAL RELEASE QUERY ===');
    console.log(`INSERT INTO timesheet_lock_logs (employee_id, employee_name, event_type, reason)`);
    console.log(`SELECT id, employee_name, 'MANUAL_UNLOCK', 'Admin release'`);
    console.log(`FROM employees WHERE employee_code = 'E0041';`);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

verifyAll();
