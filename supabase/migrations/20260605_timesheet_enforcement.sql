-- Migration: Timesheet Compliance Lock Screen

CREATE TABLE IF NOT EXISTS app_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key text UNIQUE NOT NULL,
    setting_value text NOT NULL,
    updated_at timestamptz DEFAULT now()
);

-- Insert default values if not exists
INSERT INTO app_settings (setting_key, setting_value) VALUES 
('timesheet_check_time', '11:00'),
('timesheet_warning_time', '11:30'),
('timesheet_lock_time', '12:30'),
('enable_lock_screen_enforcement', 'true')
ON CONFLICT (setting_key) DO NOTHING;

-- Add timesheet_exempt to employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS timesheet_exempt boolean DEFAULT false;

-- Create timesheet_lock_logs for tracking
CREATE TABLE IF NOT EXISTS timesheet_lock_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
    employee_name text,
    event_type text, -- 'WARNING', 'LOCKED', 'MANUAL_UNLOCK', 'AUTO_UNLOCK'
    admin_id uuid REFERENCES employees(id) ON DELETE SET NULL,
    admin_name text,
    reason text,
    created_at timestamptz DEFAULT now()
);

-- Add RLS for timesheet_lock_logs (allow all for simplicity as agent runs locally)
ALTER TABLE timesheet_lock_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can insert timesheet logs" ON timesheet_lock_logs FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can select timesheet logs" ON timesheet_lock_logs FOR SELECT TO anon USING (true);

-- Add RLS for app_settings
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can select settings" ON app_settings FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can update settings" ON app_settings FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can insert settings" ON app_settings FOR INSERT TO anon WITH CHECK (true);
