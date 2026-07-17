import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  'https://zxckfvbpdndhpatyswxi.supabase.co',
  process.env.VITE_SUPABASE_ANON_KEY
);

async function check() {
  const { data: empData } = await supabase.from('employees').select('*').eq('employee_code', 'E0041').single();
  if (empData) {
    console.log('Employee:', empData.employee_name, 'timesheet_exempt:', empData.timesheet_exempt, 'role:', empData.role);
    
    const { data: locks } = await supabase
      .from('timesheet_lock_logs')
      .select('*')
      .eq('employee_id', empData.id)
      .in('event_type', ['MANUAL_LOCK', 'MANUAL_UNLOCK', 'PRE_LOCK_CHECK', 'LOCKED'])
      .order('created_at', { ascending: false })
      .limit(5);
      
    console.log('Recent Lock Logs:');
    locks?.forEach(l => {
      console.log(`- ${l.created_at} | ${l.event_type} | ${l.reason}`);
    });
  } else {
    console.log('E0041 not found in local DB');
  }
}

check();
