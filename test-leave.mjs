import pg from 'pg';

const lmsUrl = 'postgresql://postgres.gykfyiqujyiwchqgmsjx:Rebecasuji%4013@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';
const empCode = 'E0041';
const dateStr = '2026-07-16';

async function checkLeave() {
  const { Client } = pg;
  const client = new Client({
    connectionString: lmsUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to LMS DB');

    const leavesRes = await client.query(
      `SELECT leave_type, start_date, end_date, status
       FROM leaves 
       WHERE user_id = $1 
         AND DATE(start_date AT TIME ZONE 'Asia/Kolkata') <= $2::date
         AND DATE(end_date AT TIME ZONE 'Asia/Kolkata') >= $2::date
         AND status = 'Approved'`,
      [empCode, dateStr]
    );

    console.log('Leaves:', leavesRes.rows);

    const permRes = await client.query(
      `SELECT permission_type, permission_date, status FROM permissions WHERE user_id = $1 AND permission_date = $2 AND status = 'Approved'`,
      [empCode, dateStr]
    );
    console.log('Permissions:', permRes.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    try { await client.end(); } catch {}
  }
}

checkLeave();
