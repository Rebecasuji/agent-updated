# TimeGuard Backend Archiver Service

A standalone Node.js backend service that handles:
- **Scheduled daily exports** (every day at 9:00 AM) for all employee monitoring data
- **Manual export API** for on-demand report generation from the Admin Dashboard
- **Safe data retention** — raw logs are only deleted after successful archive

## Architecture

```
backend-service/
├── index.js          # Entry point — Express server + cron scheduler
├── exporter.js       # Main orchestrator — ties all steps together
├── dataFetcher.js    # Fetches all monitoring data from Supabase
├── excelGenerator.js # Builds the 9-sheet Excel workbook (exceljs)
├── archiverService.js # Compresses to ZIP and uploads to Supabase Storage
├── cleanupService.js # Purges old raw records (48h logs / 7d screenshots)
├── migrate.js        # One-time DB migration (run once to create new tables)
├── backup.js         # One-time full backup of existing data (run before first deletion)
├── db.js             # Supabase client configuration
└── backups/          # Local JSON backup files (created by backup.js)
```

## Setup

### 1. Run initial backup (IMPORTANT — do once before enabling deletion)
```bash
node backup.js
```
This creates JSON files in `backups/` containing all current `activity_logs`, `idle_alerts`, `screenshots`, and `work_sessions`.

### 2. Run database migration (once only)
```bash
node migrate.js
```
Creates: `employee_daily_summary`, `employee_daily_app_usage`, `employee_monthly_summary`, `report_archives`

### 3. Create monitoring_archives bucket in Supabase Storage
Go to your Supabase Dashboard → Storage → Create bucket named `monitoring_archives` (set to Private).

### 4. Start the service
```bash
npm start
```
The service will:
- Start an Express server on port 3001
- Schedule a cron job for 9:00 AM daily
- Expose REST endpoints for the Admin Dashboard to call

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/export/yesterday` | Trigger export for yesterday |
| `POST` | `/api/export/specific-date` | Trigger export for `{ date: "YYYY-MM-DD" }` |
| `GET`  | `/health` | Service health check |

## Tables Accessed (Monitoring Only)

### Read + Delete (raw, temporary)
- `activity_logs` — deleted after 48 hours
- `idle_alerts` — deleted after 48 hours
- `screenshots` — deleted after 7 days

### Read Only
- `employees` — to get all employee codes and names
- `work_sessions` — for session durations

### Write Only (permanent summaries)
- `employee_daily_summary`
- `employee_daily_app_usage`
- `employee_monthly_summary`
- `report_archives`

### NOT Accessed (guaranteed isolation)
- TIMESHEET_DB_URL ❌
- LMS Database ❌
- Timesheet tables ❌
- LMS tables ❌
- Authentication tables ❌
- Lock/unlock tables ❌

## Archive Structure in Supabase Storage
```
monitoring_archives/
  2026/
    06/
      15/
        monitoring_report.zip   (contains monitoring_report.xlsx)
```

## Safety Rules
1. Excel generation must succeed ✅
2. ZIP must be created successfully ✅
3. ZIP must be uploaded to Supabase Storage ✅
4. `report_archives` record must be inserted ✅
5. Only then: raw records older than 48h/7d are deleted

If any step fails, deletion is skipped entirely.

## Deployment (for 24/7 Scheduled Exports)
Deploy this folder to any Node.js hosting:
- **Render.com** (free tier available) — just point to this directory
- **Railway.app** — recommended for cron workloads
- **AWS EC2** / **DigitalOcean Droplet** — any Linux server

Set these environment variables on your hosting platform:
```
VITE_SUPABASE_URL=https://ogqmojvzeyasqoqhkpuz.supabase.co
VITE_SUPABASE_SERVICE_KEY=<your-service-role-key>
PORT=3001
```
