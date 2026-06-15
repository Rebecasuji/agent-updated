const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qdqypcwnrbdgqagfdeun.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcXlwY3ducmJkZ3FhZ2ZkZXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM0NjcyMCwiZXhwIjoyMDkyOTIyNzIwfQ.KNZlnAxKaPqAt07eF43njAnNKE9m877Yldn1oDcb7jw';

async function updatePasswords() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: employees } = await supabase.from('employees').select('id, employee_name, email, employee_code').not('email', 'is', null);
  const { data: logins } = await supabase.from('login_logs').select('employee_code, password');
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  
  for (const emp of employees) {
    const login = logins?.find(l => l.employee_code === emp.employee_code);
    const password = login?.password || 'admin123';
    
    const authUser = authUsers?.users?.find(u => u.email === emp.email);
    if (authUser) {
      await supabase.auth.admin.updateUserById(authUser.id, { password: password });
      console.log(`✅ Updated password for existing Supabase Auth user: ${emp.email} (Password: ${password})`);
    } else {
      console.log(`User ${emp.email} does not exist in Auth (should have been created).`);
    }
  }
}
updatePasswords();
