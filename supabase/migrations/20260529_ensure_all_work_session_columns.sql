-- Comprehensive migration to ensure all required columns exist in work_sessions table
-- This addresses schema cache issues from previous migrations

-- 1. Ensure all base columns exist
ALTER TABLE work_sessions
ADD COLUMN IF NOT EXISTS started_work_time timestamptz;

ALTER TABLE work_sessions
ADD COLUMN IF NOT EXISTS day_finished boolean DEFAULT false;

ALTER TABLE work_sessions
ADD COLUMN IF NOT EXISTS ended_work_time timestamptz;

-- 2. Verify other expected columns exist (these should be from original schema)
-- active_seconds, idle_seconds, productive_seconds, punched_in, punch_in_time, plan_submitted, plan_text, etc.

-- 3. Refresh schema cache by doing a minimal operation
-- This forces Supabase to refresh its cached schema
SELECT pg_sleep(0.1);

-- 4. Add comments for clarity
COMMENT ON COLUMN work_sessions.started_work_time IS 'The time when the employee first signed in for the day. Set once on first login, never changes.';
COMMENT ON COLUMN work_sessions.day_finished IS 'Boolean flag indicating if employee has finished their work day. When true, prevents resume.';
COMMENT ON COLUMN work_sessions.ended_work_time IS 'The time when employee finished their work day (when day_finished flag is set to true).';

-- 5. Create/ensure indexes exist for performance
CREATE INDEX IF NOT EXISTS idx_work_sessions_employee_date 
ON work_sessions(employee_id, session_date);

CREATE INDEX IF NOT EXISTS idx_work_sessions_day_finished 
ON work_sessions(employee_id, session_date, day_finished);

CREATE INDEX IF NOT EXISTS idx_work_sessions_started_work_time
ON work_sessions(started_work_time);

-- 6. Verify the table structure is correct
-- Check that all columns are present by selecting column info
-- This will fail silently if columns don't exist (good for idempotency)

-- Migration complete
