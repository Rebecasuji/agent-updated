import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase Client
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://ogqmojvzeyasqoqhkpuz.supabase.co';
const supabase = createClient(SUPABASE_URL, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ncW1vanZ6ZXlhc3FvcWhrcHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNTM1NTQsImV4cCI6MjA5NjgyOTU1NH0.kWuDdRb2bb8IAOMot5BnIvQzWefOAkYfIRmJxFqT4v8', {
  auth: { persistSession: false },
  realtime: { transport: ws }
});
async function fetchAll(table) {
  let allData = [];
  let start = 0;
  const limit = 1000;
  
  console.log(`Starting backup for ${table}...`);
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(start, start + limit - 1);
      
    if (error) {
      console.error(`Error fetching ${table}:`, error);
      break;
    }
    
    if (!data || data.length === 0) {
      break;
    }
    
    allData = allData.concat(data);
    start += limit;
    console.log(`Fetched ${allData.length} records from ${table}...`);
    
    if (data.length < limit) {
      break;
    }
  }
  
  return allData;
}

async function runBackup() {
  const tables = ['activity_logs', 'idle_alerts', 'screenshots', 'work_sessions'];
  const backupDir = path.join(__dirname, 'backups');
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  for (const table of tables) {
    const data = await fetchAll(table);
    const filePath = path.join(backupDir, `${table}_backup_${timestamp}.json`);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Successfully backed up ${data.length} records to ${filePath}`);
  }
  
  console.log('Backup complete!');
}

runBackup().catch(console.error);
