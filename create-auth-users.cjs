const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qdqypcwnrbdgqagfdeun.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcXlwY3ducmJkZ3FhZ2ZkZXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM0NjcyMCwiZXhwIjoyMDkyOTIyNzIwfQ.KNZlnAxKaPqAt07eF43njAnNKE9m877Yldn1oDcb7jw';

async function createAuthUsers() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Get all employees with an email
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, employee_name, email, employee_code')
    .not('email', 'is', null);

  if (empErr) {
    console.error('Error fetching employees:', empErr);
    return;
  }

  // 2. Get login_logs to find passwords (default to admin123)
  const { data: logins } = await supabase.from('login_logs').select('employee_code, password');
  
  console.log(`Found ${employees.length} employees with emails. Creating Supabase Auth accounts...`);

  for (const emp of employees) {
    // Find password in login_logs, or default to admin123
    const login = logins?.find(l => l.employee_code === emp.employee_code);
    const password = login?.password || 'admin123';

    // Try to create the auth user
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: emp.email,
      password: password,
      email_confirm: true,
      user_metadata: { name: emp.employee_name }
    });

    if (authErr) {
      if (authErr.message.includes('already exists') || authErr.message.includes('already registered')) {
        console.log(`✅ ${emp.employee_name} (${emp.email}) already has an Auth account.`);
        
        // If they already exist, let's make sure their password is updated so they can definitely log in!
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(u => u.email === emp.email);
        if (existingUser) {
          await supabase.auth.admin.updateUserById(existingUser.id, { password: password });
          console.log(`   -> Updated password for ${emp.email} to match database (${password})`);
        }
      } else {
        console.log(`❌ Failed to create Auth account for ${emp.email}: ${authErr.message}`);
      }
    } else {
      console.log(`🎉 Created new Auth account for ${emp.employee_name} (${emp.email}) with password: ${password}`);
    }
  }
}

createAuthUsers().catch(console.error);
