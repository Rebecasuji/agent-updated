require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const lmsUrl = process.env.LMS_DB_URL;
  const timesheetUrl = process.env.TIMESHEET_DB_URL;

  // Check leaves in LMS
  const lmsDb = new Client({ connectionString: lmsUrl, ssl: { rejectUnauthorized: false } });
  await lmsDb.connect();
  try {
    const res = await lmsDb.query("SELECT user_id, status, start_date, end_date FROM leaves WHERE user_id='E0048' ORDER BY start_date DESC LIMIT 5");
    console.log("Leaves for E0048:");
    console.table(res.rows);
  } finally {
    await lmsDb.end();
  }

  // Check device registrations in Timesheet DB
  const tsDb = new Client({ connectionString: timesheetUrl, ssl: { rejectUnauthorized: false } });
  await tsDb.connect();
  try {
    const res2 = await tsDb.query("SELECT * FROM device_registrations WHERE employee_code='E0048'");
    console.log("Device Registrations for E0048:");
    console.table(res2.rows);
  } finally {
    await tsDb.end();
  }
}

run().catch(console.error);
