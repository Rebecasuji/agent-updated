const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ogqmojvzeyasqoqhkpuz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ncW1vanZ6ZXlhc3FvcWhrcHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNTM1NTQsImV4cCI6MjA5NjgyOTU1NH0.kWuDdRb2bb8IAOMot5BnIvQzWefOAkYfIRmJxFqT4v8';

async function test() {
  console.log('Testing Supabase connection...');
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data, error } = await supabase.from('employees').select('id').limit(1);
    if (error) {
      console.error('Error:', error.message);
    } else {
      console.log('Success! Connected to Supabase. Data:', data);
    }
  } catch (e) {
    console.error('Exception:', e);
  }
}

test();
