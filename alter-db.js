import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to DB');

    await client.query('ALTER TABLE employees ADD COLUMN shift_start TIME;');
    console.log('Added shift_start column.');

    await client.query('ALTER TABLE employees ADD COLUMN shift_end TIME;');
    console.log('Added shift_end column.');
  } catch (err) {
    if (err.code === '42701') {
      console.log('Columns likely already exist:', err.message);
    } else {
      console.error('Error running query:', err);
    }
  } finally {
    await client.end();
  }
}

run();
