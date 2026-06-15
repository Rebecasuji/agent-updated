import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testScreenshot() {
  const { data: empData } = await supabase.from('employees').select('id').eq('employee_code', 'ADMIN1').single();
  if (!empData) {
    console.log('Admin1 not found');
    return;
  }
  console.log('Emp ID:', empData.id);

  const payload = {
    employee_id: empData.id,
    session_id: null,
    screenshot_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    app_name: 'Knockturn Agent',
    captured_at: new Date().toISOString(),
    url: 'Knockturn Agent-2026-06-15T06:28:44.343Z',
  };

  const { data, error } = await supabase.from('screenshots').insert([payload]);
  console.log('Result:', data);
  console.log('Error:', error);
}

testScreenshot();
