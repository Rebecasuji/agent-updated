const { Client } = require('pg');
const LMS_DB_URL = 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji%4013@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require';

async function checkLeave() {
  const lmsClient = new Client({ connectionString: LMS_DB_URL, ssl: { rejectUnauthorized: false } });
  
  try {
    await lmsClient.connect();
    // DurgaDevi E employee code is unknown to me, but let's query all leaves for today and yesterday
    const now = new Date();
    const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(istString);
    const today = istDate.toISOString().slice(0, 10);
    const yesterday = new Date(istDate.getTime() - 86400000).toISOString().slice(0, 10);
    
    console.log(`Checking leaves for ${yesterday} and ${today}`);
    
    const leaveRes = await lmsClient.query(`
      SELECT user_id, leave_type, start_date, end_date, status 
      FROM leaves 
      WHERE DATE(start_date AT TIME ZONE 'Asia/Kolkata') <= $1::date
        AND DATE(end_date AT TIME ZONE 'Asia/Kolkata') >= $2::date
        AND status = 'Approved'
    `, [today, yesterday]);
    
    console.log('Leaves:', leaveRes.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await lmsClient.end();
  }
}
checkLeave();
