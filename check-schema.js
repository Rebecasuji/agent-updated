const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function checkSchema() {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .limit(1);

  console.log('Employees row structure:', data ? Object.keys(data[0] || {}) : error);
}

checkSchema();
