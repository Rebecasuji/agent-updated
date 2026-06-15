import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY; // Service key for backend
// Use anon key for REST bypass if service key is failing, but let's stick to service key
export const supabase = createClient(SUPABASE_URL, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ncW1vanZ6ZXlhc3FvcWhrcHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNTM1NTQsImV4cCI6MjA5NjgyOTU1NH0.kWuDdRb2bb8IAOMot5BnIvQzWefOAkYfIRmJxFqT4v8', {
  auth: { persistSession: false },
  realtime: { transport: ws },
  global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
});
