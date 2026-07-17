const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY
);

async function enableAll() {
  console.log('Updating enable_lock_screen_enforcement to true...');
  const { data, error } = await supabase
    .from('app_settings')
    .update({ setting_value: 'true', updated_at: new Date().toISOString() })
    .eq('setting_key', 'enable_lock_screen_enforcement')
    .select();

  if (error) {
    console.error('Error updating setting:', error);
  } else {
    console.log('Successfully enabled lock screen enforcement:', data);
  }
}

enableAll();
