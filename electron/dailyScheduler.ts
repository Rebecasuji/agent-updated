import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import { sendSummaryEmail, initializeEmailService } from './emailService.js';
import { formatDuration } from 'date-fns';

let schedulerTask: cron.ScheduledTask | null = null;

interface ActivityMetrics {
  totalTime: number; // seconds
  deskTime: number; // active_seconds
  idleTime: number; // idle_seconds
  productiveTime: number; // productive_seconds
  nonproductiveTime: number; // nonproductive_seconds
  neutralTime: number; // neutral_seconds
  productivityScore: number; // percentage
  topApps: Array<{ name: string; duration: number }>;
}

/**
 * Format seconds to human readable duration (e.g., "2h 30m")
 */
function formatSecondsToDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 && hours === 0 && minutes === 0) parts.push(`${secs}s`);

  return parts.join(' ') || '0s';
}

/**
 * Fetch daily activity metrics for an employee from yesterday
 */
async function fetchEmployeeMetrics(
  supabase: any,
  employeeId: string,
  date: string // YYYY-MM-DD format for yesterday (in local timezone)
): Promise<ActivityMetrics | null> {
  try {
    // Get timezone offset (in minutes)
    const tzOffsetMinutes = new Date().getTimezoneOffset();
    
    // Create start and end dates in UTC that correspond to the local date
    const localDate = new Date(`${date}T00:00:00`);
    const startDate = new Date(localDate.getTime() - tzOffsetMinutes * 60000); // Adjust for timezone
    
    const localEndDate = new Date(`${date}T23:59:59`);
    const endDate = new Date(localEndDate.getTime() - tzOffsetMinutes * 60000); // Adjust for timezone

    // Fetch employee activity records for the day
    const { data: activities, error } = await supabase
      .from('employee_activity')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .order('timestamp', { ascending: false });

    if (error) {
      console.error(`[Scheduler] Error fetching activities for ${employeeId}:`, error);
      return null;
    }

    if (!activities || activities.length === 0) {
      console.log(`[Scheduler] No activities found for ${employeeId} on ${date}`);
      return {
        totalTime: 0,
        deskTime: 0,
        idleTime: 0,
        productiveTime: 0,
        nonproductiveTime: 0,
        neutralTime: 0,
        productivityScore: 0,
        topApps: [],
      };
    }

    // Aggregate metrics
    let totalActiveTime = 0;
    let totalProductiveTime = 0;
    let totalNonproductiveTime = 0;
    let totalIdleTime = 0;
    let totalAwayTime = 0;
    let totalDeskTime = 0;
    const appUsage: { [key: string]: number } = {};

    for (const activity of activities) {
      totalActiveTime += activity.active_time || 0;
      totalProductiveTime += activity.productive_time || 0;
      totalNonproductiveTime += activity.nonproductive_time || 0;
      totalIdleTime += activity.idle_time || 0;
      totalAwayTime += activity.away_time || 0;
      totalDeskTime += activity.active_time || 0;

      // Process most used apps from activity_logs
      if (activity.activity_logs && Array.isArray(activity.activity_logs)) {
        activity.activity_logs.forEach((log: any) => {
          const appName = log.appName || log.app_name || 'Unknown';
          const duration = log.durationSeconds || 0;
          appUsage[appName] = (appUsage[appName] || 0) + duration;
        });
      }
    }

    // Calculate total session time
    const totalSessionTime = totalActiveTime + totalIdleTime + totalAwayTime;

    // Calculate productivity score
    const productivityScore =
      totalSessionTime > 0
        ? Math.round((totalProductiveTime / totalSessionTime) * 100)
        : 0;

    // Get top apps
    const topApps = Object.entries(appUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, duration]) => ({
        name,
        duration,
      }));

    return {
      totalTime: totalSessionTime,
      deskTime: totalDeskTime,
      idleTime: totalIdleTime,
      productiveTime: totalProductiveTime,
      nonproductiveTime: totalNonproductiveTime,
      neutralTime: totalSessionTime - totalProductiveTime - totalNonproductiveTime - totalIdleTime,
      productivityScore,
      topApps,
    };
  } catch (error) {
    console.error(`[Scheduler] Exception while fetching metrics for ${employeeId}:`, error);
    return null;
  }
}

/**
 * Send daily summary emails to all employees
 */
async function sendDailySummaryEmails() {
  console.log('[Scheduler] Starting daily summary email job');

  try {
    // Initialize Supabase client
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[Scheduler] Supabase credentials not configured');
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in local timezone
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayString = `${year}-${month}-${day}`;

    // Fetch all employees with valid emails
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, email, first_name, last_name')
      .not('email', 'is', null);

    if (employeesError) {
      console.error('[Scheduler] Error fetching employees:', employeesError);
      return;
    }

    if (!employees || employees.length === 0) {
      console.log('[Scheduler] No employees found with email addresses');
      return;
    }

    console.log(`[Scheduler] Found ${employees.length} employees with email addresses`);

    // Send summary emails
    let sentCount = 0;
    let failedCount = 0;

    for (const employee of employees) {
      try {
        const metrics = await fetchEmployeeMetrics(supabase, employee.id, todayString);

        if (!metrics) {
          console.warn(`[Scheduler] Could not fetch metrics for employee ${employee.id}`);
          failedCount++;
          continue;
        }

        const employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Employee';

        // Only send if there's meaningful data
        if (metrics.totalTime > 0 || metrics.topApps.length > 0) {
          const success = await sendSummaryEmail(employee.email, employeeName, todayString, {
            totalTime: formatSecondsToDuration(metrics.totalTime),
            deskTime: formatSecondsToDuration(metrics.deskTime),
            idleTime: formatSecondsToDuration(metrics.idleTime),
            productiveTime: formatSecondsToDuration(metrics.productiveTime),
            nonproductiveTime: formatSecondsToDuration(metrics.nonproductiveTime),
            neutralTime: formatSecondsToDuration(metrics.neutralTime),
            productivityScore: metrics.productivityScore,
            topApps: metrics.topApps.map(app => ({
              name: app.name,
              duration: formatSecondsToDuration(app.duration),
            })),
          });

          if (success) {
            sentCount++;
          } else {
            failedCount++;
          }
        } else {
          console.log(`[Scheduler] No activity data for ${employee.email}, skipping email`);
        }
      } catch (err) {
        console.error(`[Scheduler] Error processing employee ${employee.id}:`, err);
        failedCount++;
      }
    }

    console.log(
      `[Scheduler] Daily summary email job completed. Sent: ${sentCount}, Failed: ${failedCount}`
    );
  } catch (error) {
    console.error('[Scheduler] Error in daily summary email job:', error);
  }
}

/**
 * Initialize and start the daily scheduler
 * Schedule: Daily at 11:59 PM (configurable via SUMMARY_EMAIL_TIME env var)
 * Format: "59 23 * * *" (minute hour day-of-month month day-of-week)
 */
export function startDailyScheduler() {
  if (schedulerTask) {
    console.log('[Scheduler] Daily scheduler is already running');
    return;
  }

  try {
    // Initialize email service first
    const emailInitialized = initializeEmailService();
    if (!emailInitialized) {
      console.warn('[Scheduler] Email service not properly initialized, scheduler will not send emails');
    }

    // Get scheduled time from environment or use default (11:59 PM)
    const scheduleTime = process.env.SUMMARY_EMAIL_TIME || '59 23 * * *';

    console.log(`[Scheduler] Starting daily scheduler with cron expression: ${scheduleTime}`);

    // Schedule the job
    schedulerTask = cron.schedule(scheduleTime, sendDailySummaryEmails, {
      scheduled: true,
      timezone: 'Asia/Kolkata', // India Standard Time (IST)
    });

    console.log('[Scheduler] Daily scheduler started successfully');

    // Optional: Send immediately for testing (comment out in production)
    // sendDailySummaryEmails();
  } catch (error) {
    console.error('[Scheduler] Failed to start daily scheduler:', error);
  }
}

/**
 * Stop the daily scheduler
 */
export function stopDailyScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('[Scheduler] Daily scheduler stopped');
  }
}

/**
 * Manually trigger the daily summary email job (for testing)
 */
export async function triggerDailySummaryEmails() {
  console.log('[Scheduler] Manually triggering daily summary emails');
  await sendDailySummaryEmails();
}
