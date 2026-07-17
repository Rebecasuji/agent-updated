require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const tsDb = new Client({ connectionString: process.env.TIMESHEET_DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await tsDb.connect();
    console.log("Connected to Timesheet DB");
    await tsDb.query(`
      CREATE TABLE IF NOT EXISTS device_registrations (
        employee_code TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Successfully created device_registrations table");
  } catch (err) {
    console.error("Error creating table:", err.message);
  } finally {
    await tsDb.end();
  }
}

run();
