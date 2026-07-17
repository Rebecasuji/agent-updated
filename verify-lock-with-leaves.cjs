const { Client } = require('pg');

const DB_URL = 'postgresql://postgres.cwjkvasixpmieeuaield:Rebecasuji%4013@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require';
const LMS_DB_URL = 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji%4013@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require';

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
  console.log('Previous working date (IST):', prevDate || 'NULL (Today is Sunday)');
  console.log(`Current IST time: ${istTime.hours}:${String(istTime.minutes).padStart(2,'0')} (${istTime.total} mins)`);
  
  if (!prevDate) {
    console.log('\n✓ Today is Sunday — no locking needed for anyone.');
    return;
  }

  const timesheetClient = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  const lmsClient = new Client({ connectionString: LMS_DB_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    await timesheetClient.connect();
    await lmsClient.connect();
    console.log('\n✓ Connected to both TimeStrap and LMS databases successfully\n');

    // Get all active employees
    const empRes = await timesheetClient.query(`
      SELECT id, name, employee_code 
      FROM employees 
      WHERE is_active = true 
      ORDER BY employee_code
    `);
    
    let submitted = 0, onLeave = 0, willBeLocked = 0;
    const lockedList = [];

    for (const emp of empRes.rows) {
      // 1. Check Leave Status in LMS
      const leaveRes = await lmsClient.query(
        `SELECT leave_type 
         FROM leaves 
         WHERE user_id = $1 
           AND DATE(start_date AT TIME ZONE 'Asia/Kolkata') <= $2::date
           AND DATE(end_date AT TIME ZONE 'Asia/Kolkata') >= $2::date
           AND status = 'Approved' LIMIT 1`,
        [emp.employee_code, prevDate]
      );
      
      if (leaveRes.rows.length > 0) {
        console.log(`[Leave Bypass] ${emp.employee_code} - ${emp.name} was on Approved Leave (${leaveRes.rows[0].leave_type}) yesterday. NOT LOCKING.`);
        onLeave++;
        continue; // Skip lock
      }

      // 2. Check Timesheet Submission
      const entries = await timesheetClient.query(
        `SELECT COUNT(*) as cnt FROM time_entries WHERE employee_id = $1 AND date = $2 AND status NOT IN ('draft', 'rejected')`,
        [emp.id, prevDate]
      );
      const daily = await timesheetClient.query(
        `SELECT COUNT(*) as cnt FROM daily_submissions WHERE employee_id = $1 AND date = $2`,
        [emp.id, prevDate]
      );
      
      const hasSubmitted = parseInt(entries.rows[0].cnt) > 0 || parseInt(daily.rows[0].cnt) > 0;
      
      if (hasSubmitted) {
        submitted++;
      } else {
        willBeLocked++;
        lockedList.push(`${emp.employee_code} - ${emp.name}`);
      }
    }

    console.log(`\n✓ Submitted Timesheet:   ${submitted}`);
    console.log(`✓ On Approved Leave:     ${onLeave}`);
    console.log(`✗ Will be Locked:        ${willBeLocked}`);
    
    if (lockedList.length > 0) {
      console.log('\nEmployees who WILL BE LOCKED (No timesheet, No approved leave):');
      lockedList.forEach(e => console.log(' ✗', e));
    } else {
      console.log('\n✓ No employees will be locked.');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await timesheetClient.end();
    await lmsClient.end();
  }
}

verifyAll();
