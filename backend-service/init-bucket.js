import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY; 
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function initBucket() {
  console.log('Checking for monitoring_archives bucket...');
  const { data, error } = await supabase.storage.getBucket('monitoring_archives');
  
  if (error && error.message.includes('not found')) {
    console.log('Creating bucket monitoring_archives...');
    const { data: createData, error: createError } = await supabase.storage.createBucket('monitoring_archives', {
      public: false,
      fileSizeLimit: 104857600, // 100MB
    });
    
    if (createError) {
      console.error('Error creating bucket:', createError);
    } else {
      console.log('Bucket created successfully!');
    }
  } else if (error) {
    console.error('Error checking bucket:', error);
  } else {
    console.log('Bucket already exists.');
  }
}

initBucket();
