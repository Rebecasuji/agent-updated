# TIMESHEET_DB_URL Configuration Fix

## Summary
Fixed "TIMESHEET_DB_URL not configured" issue affecting Plan Submission Check screen by improving environment variable loading, adding comprehensive logging, and enhancing error messages.

## Changes Made

### 1. Environment Variable Loading (electron/main.ts)

**Issue**: The .env file wasn't being loaded properly in packaged Electron builds.

**Fix**:
- Created `initializeEnvironment()` function that checks multiple fallback paths
- Added comprehensive startup logging
- Paths checked (in order):
  1. `process.cwd()/.env.local`
  2. `process.cwd()/.env`
  3. `__dirname/.env.local`
  4. `__dirname/.env`
  5. `__dirname/../.env.local`
  6. `__dirname/../.env`
  7. `__dirname/../../.env.local`
  8. `__dirname/../../.env`
  9. `process.execPath/../.env.local`
  10. `process.execPath/../.env`

**Logging Output**:
```
[TimesheetDB] Initializing environment variables...
[TimesheetDB] ✓ Loaded .env from: /path/to/.env
[TimesheetDB] TIMESHEET_DB_URL configured: true
```

### 2. Database Connection Handlers (electron/main.ts)

**Updated `check-timesheet-db` handler**:
- Uses dynamic `getTimesheetDbUrl()` instead of hardcoded URL
- Tries multiple employee code column names: `employee_code`, `emp_code`, `empid`
- Checks three tables: `daily_plans`, `daily_submissions`, `time_entries`
- Comprehensive logging with status indicators (✓/✗)

**Added `check-timesheet-db-debug` handler**:
- Returns detailed diagnostic information
- Includes configuration status (URL loaded, connection attempts, success)
- Returns specific error messages for each query
- Shows record counts from each table
- Helps diagnose root cause of submission failures

**Debug Output Format**:
```javascript
{
  ok: false,
  timesheetDbUrl: true,
  employeeCode: "E0046",
  details: {
    foundColumn: "employee_code",
    employeeId: "uuid-...",
    date: "2026-06-06",
    daily_plans: 1,
    daily_submissions: 0,
    time_entries: 1
  },
  errors: [],
  configStatus: {
    urlLoaded: true,
    connectionAttempted: true,
    connectionSuccess: true
  }
}
```

### 3. Error Messaging (src/components/PlanOfDay.tsx)

**Improved error messages with specific error types**:

1. **Configuration Error**:
   ```
   ⚙️ Configuration Error: TIMESHEET_DB_URL is not configured in the application. 
   Please contact your administrator.
   ```

2. **Database Connection Error**:
   ```
   🔌 Database Error: Could not connect to the timesheet database. 
   Please check your internet connection and try again.
   ```

3. **Employee Not Found Error**:
   ```
   👤 Employee Not Found: Your employee code (E0046) was not found in the timesheet system. 
   Please contact your administrator.
   ```

4. **Timesheet Not Submitted Error**:
   ```
   📋 Timesheet Not Submitted: Please submit your timesheet in the portal first, 
   then click "Continue" again.
   ```

### 4. Timesheet Enforcer Update (electron/timesheetEnforcer.ts)

**Changes**:
- Added `setTimesheetDbUrlGetter()` to accept URL getter function from main process
- Removed static TIMESHEET_DB_URL constant
- Updated `checkTimesheetSubmitted()` to:
  - Call dynamic `getTimesheetDbUrl()`
  - Try multiple employee code column names
  - Add detailed logging
  - Handle missing employee gracefully

**Logging Output**:
```
[TimesheetEnforcer] ✓ Connected for employee: E0046
[TimesheetEnforcer] ✓ Found employee by "employee_code"
[TimesheetEnforcer] ✓ Timesheet submitted
```

### 5. Build Configuration (package.json)

**Addition**: Added `.env` and `.env.local` to electron-builder files array:
```json
"files": [
  "dist/app/**/*",
  "dist/electron/**/*",
  "dist/src/**/*",
  "node_modules/**/*",
  "electron/**/*",
  ".env",
  ".env.local"
]
```

## Verification Steps

### Console Logging

When the application starts, verify these logs appear:

```
[TimesheetDB] Initializing environment variables...
[TimesheetDB] ✓ Loaded .env from: /path/to/.env
[TimesheetDB] TIMESHEET_DB_URL configured: true
[App] Ready event fired
```

When employee E0046 submits the plan verification check:

```
[TimesheetDB] check-timesheet-db handler called for employee: E0046
[TimesheetDB] URL exists: true
[TimesheetDB] ✓ Connected to database
[TimesheetDB] ✓ Found employee by "employee_code"
[TimesheetDB] Checking for submitted plans on 2026-06-06
[TimesheetDB] ✓ daily_plans found: 1
```

### Test Case: Employee E0046

1. **Preconditions**:
   - Employee E0046 has a submitted timesheet in the database
   - `.env` file exists with `TIMESHEET_DB_URL` configured
   - Application has been built and packaged

2. **Steps**:
   - Launch application
   - Login as employee E0046
   - Navigate to Plan Submission Check
   - Click "Yes, verify and continue"

3. **Expected Result**:
   - Application connects to timesheet database
   - Finds E0046 in employee table
   - Verifies submitted plan exists
   - Proceeds to next phase without error

4. **If Error Occurs**:
   - Check console logs for specific error type
   - Verify which step failed (configuration, connection, employee lookup, or plan lookup)
   - Take appropriate action based on error type

## Database Queries

The handlers check the following tables in order:

### daily_plans
```sql
SELECT id FROM daily_plans 
WHERE employee_id = $1 AND to_char("date", 'YYYY-MM-DD') = $2
```

### daily_submissions
```sql
SELECT id FROM daily_submissions 
WHERE employee_id = $1 AND to_char("date", 'YYYY-MM-DD') = $2
```

### time_entries
```sql
SELECT id FROM time_entries 
WHERE employee_id = $1 AND "date"::text = $2 
AND status NOT IN ('draft','rejected')
```

## Backward Compatibility

All changes maintain backward compatibility:
- Existing database queries unchanged
- API signatures unchanged
- IPC channel names unchanged
- Error handling graceful (returns sensible defaults on failure)

## Troubleshooting

### "TIMESHEET_DB_URL not configured"
- Check that `.env` file exists in the installation directory
- Verify `.env` has `TIMESHEET_DB_URL=...` line
- Check console for where dotenv searched for files
- In packaged builds, `.env` must be copied to app root after build

### "Employee not found in timesheet DB"
- Verify employee code matches table column name
- Check if `employee_code`, `emp_code`, or `empid` is used
- Verify employee exists in timesheet database

### "Database connection failed"
- Check internet connectivity
- Verify database is accessible
- Check SSL settings
- Verify connection string is valid

## Related Files
- [electron/main.ts](electron/main.ts) - Environment loading and IPC handlers
- [electron/timesheetEnforcer.ts](electron/timesheetEnforcer.ts) - Enforcer updates
- [src/components/PlanOfDay.tsx](src/components/PlanOfDay.tsx) - Error messages
- [package.json](package.json) - Build configuration
