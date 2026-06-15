import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from './db.js';
import { fetchAllMonitoringData } from './dataFetcher.js';
import { generateDailyExcel } from './excelGenerator.js';
import { createZip, uploadToStorage } from './archiverService.js';
import { deleteOldData } from './cleanupService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export async function runDailyExport(overrideDate = null) {
  const targetDate = overrideDate ? new Date(overrideDate) : new Date();
  if (!overrideDate) {
    targetDate.setDate(targetDate.getDate() - 1); // Yesterday
  }
  const dateStr = targetDate.toISOString().split('T')[0];
  
  console.log(`Starting export for ${dateStr}`);
  
  let archiveUrl = null;
  let archiveSize = 0;
  let recordsExported = 0;
  let recordsDeleted = 0;

  try {
    // 1. Fetch data
    const data = await fetchAllMonitoringData(dateStr);
    recordsExported = data.activityLogs.length + data.idleAlerts.length + data.screenshots.length;

    // 2. Generate Excel & Extract Summaries
    const { filePath: excelPath, summaries } = await generateDailyExcel(data, dateStr);

    // Save summaries to DB (Persistent Daily Summaries)
    if (summaries.length > 0) {
      const { error: sumErr } = await supabase.from('employee_daily_summary').upsert(summaries, { onConflict: 'employee_id, date' });
      if (sumErr) console.error('Failed to save summaries:', sumErr);
    }

    // 3. Compress ZIP
    const zipPath = await createZip(excelPath, dateStr);
    const stats = fs.statSync(zipPath);
    archiveSize = stats.size;

    // 4. Upload to Supabase Storage
    archiveUrl = await uploadToStorage(zipPath, dateStr);

    // 5. Delete old data (Strictly AFTER upload)
    recordsDeleted = await deleteOldData(dateStr);

    // Save success record
    await supabase.from('report_archives').upsert({
      export_date: dateStr,
      status: 'SUCCESS',
      archive_url: archiveUrl,
      archive_size_bytes: archiveSize,
      records_exported: recordsExported,
      records_deleted: recordsDeleted
    }, { onConflict: 'export_date' });

    // Cleanup local files
    fs.unlinkSync(excelPath);
    fs.unlinkSync(zipPath);

    console.log('Export successful');
    return { success: true, archiveUrl };
  } catch (error) {
    console.error('Export failed:', error);
    
    // Log failure to report_archives
    await supabase.from('report_archives').upsert({
      export_date: dateStr,
      status: 'FAILED',
      error_message: error.message
    }, { onConflict: 'export_date' });

    return { success: false, error };
  }
}

// If run directly
if (process.argv[1] === __filename) {
  const override = process.argv[2];
  runDailyExport(override).then(() => process.exit(0));
}
