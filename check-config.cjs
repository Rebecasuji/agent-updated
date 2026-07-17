const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_KEY);

async function checkConfig() {
  const { data } = await supabase.from('app_settings').select('*');
  console.log('App Settings:', data);
}
checkConfig();
