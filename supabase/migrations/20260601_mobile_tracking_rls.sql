-- Migration to ensure mobile tracking tables have proper RLS policies

-- call_logs
ALTER TABLE IF EXISTS call_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can insert call logs" ON call_logs;
DROP POLICY IF EXISTS "Anon can select call logs" ON call_logs;
DROP POLICY IF EXISTS "Authenticated can insert call logs" ON call_logs;

CREATE POLICY "Anon can insert call logs" ON call_logs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can select call logs" ON call_logs FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can insert call logs" ON call_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can select call logs" ON call_logs FOR SELECT TO authenticated USING (true);

-- field_locations
ALTER TABLE IF EXISTS field_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can insert field locations" ON field_locations;
DROP POLICY IF EXISTS "Anon can select field locations" ON field_locations;
DROP POLICY IF EXISTS "Authenticated can insert field locations" ON field_locations;

CREATE POLICY "Anon can insert field locations" ON field_locations FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can select field locations" ON field_locations FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can insert field locations" ON field_locations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can select field locations" ON field_locations FOR SELECT TO authenticated USING (true);

-- field_visits
ALTER TABLE IF EXISTS field_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can insert field visits" ON field_visits;
DROP POLICY IF EXISTS "Anon can select field visits" ON field_visits;
DROP POLICY IF EXISTS "Anon can update field visits" ON field_visits;
DROP POLICY IF EXISTS "Authenticated can insert field visits" ON field_visits;
DROP POLICY IF EXISTS "Authenticated can update field visits" ON field_visits;

CREATE POLICY "Anon can insert field visits" ON field_visits FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can select field visits" ON field_visits FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can update field visits" ON field_visits FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can insert field visits" ON field_visits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can select field visits" ON field_visits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can update field visits" ON field_visits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
