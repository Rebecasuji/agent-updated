const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://qdqypcwnrbdgqagfdeun.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcXlwY3ducmJkZ3FhZ2ZkZXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM0NjcyMCwiZXhwIjoyMDkyOTIyNzIwfQ.KNZlnAxKaPqAt07eF43njAnNKE9m877Yldn1oDcb7jw';

async function check() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log('=== FIELD_LOCATIONS TABLE COLUMNS ===');
  const { data, error } = await supabase.from('field_locations').select('*').limit(1);
  if (data && data.length > 0) {
    console.log('Columns:', Object.keys(data[0]).join(', '));
  } else {
    // If no data, try to insert dummy to get schema error or success
    console.log("No data found in field_locations, trying to get schema...");
  }
}
check();
