const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_KEY
);

async function unlockAll() {
  const { data, error } = await supabase
    .from('app_settings')
    .update({ setting_value: 'false' })
    .eq('setting_key', 'enable_lock_screen_enforcement');

  if (error) {
    console.error('Error updating setting:', error);
  } else {
    console.log('Successfully unlocked for everyone (disabled enable_lock_screen_enforcement).');
  }
}

unlockAll();
