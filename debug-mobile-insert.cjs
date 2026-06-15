const SUPABASE_URL = 'https://qdqypcwnrbdgqagfdeun.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcXlwY3ducmJkZ3FhZ2ZkZXVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNDY3MjAsImV4cCI6MjA5MjkyMjcyMH0.E0gPigcfwjjg8cCKtC0fDQQjNqIW-YwpM-XcXN8GQj4';

async function testMobileInsert() {
  // 1. We will try to insert using the anon key (since RLS allows it now)
  const payload = {
    employee_id: '0070896e-d35c-4864-8358-84c8220565ac', // Rebeca's ID
    call_start: new Date().toISOString(),
    call_end: new Date().toISOString(),
    duration_seconds: 15,
    call_type: 'incoming',
    contact_name: 'Test Mobile App Simulation',
    phone_number: '555-0000',
  };

  console.log('Sending payload:', payload);

  const res = await fetch(`${SUPABASE_URL}/rest/v1/call_logs`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('❌ Insert failed! Error from Supabase:', errText);
  } else {
    console.log('✅ Insert succeeded!');
  }
}

testMobileInsert().catch(console.error);
