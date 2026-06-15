import { activityCollector } from './activityCollector';
import { supabase, createActivityLog, syncSessionMetrics, getTodaySession, createScreenshot, getMonitoringSettings, getAppClassifications } from './supabase';

export interface EmployeeActivityData {
  employee_id: string;
  timestamp: string;
  active_time: number;
  productive_time: number;
  nonproductive_time: number;
  idle_time: number;
  away_time: number;
  productivity_score: number;
  current_app: string;
  activity_logs: any[];
  screenshots: any[];
  online_status: 'online' | 'idle' | 'away' | 'offline';
}

class ActivitySyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  private employeeId: string = '';
  private sessionStartTime: number = Date.now();
  private productiveApps: Set<string> = new Set([
    'VS Code',
    'Excel',
    'Word',
    'Slack',
    'Teams',
    'Gmail',
    'Chrome',
    'Firefox',
  ]);

  constructor() {
    this.initializeSync();
  }

  private initializeSync() {
    // Get employee ID from session/storage
    this.employeeId = this.getEmployeeId();
  }

  private getEmployeeId(): string {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('employeeId');
      if (stored) return stored;
    }
    return 'E0001'; // Default/fallback
  }

  setEmployeeId(id: string) {
    this.employeeId = id;
    if (typeof window !== 'undefined') {
      localStorage.setItem('employeeId', id);
    }
  }

  private calculateProductivity(currentApp: string): number {
    // Simple heuristic: productive apps get 80-100%, others get 20-60%
    if (this.productiveApps.has(currentApp)) {
      return 80 + Math.random() * 20;
    }
    return 20 + Math.random() * 40;
  }

  async startSyncingData(intervalMs: number = 30000) {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Initial sync
    await this.syncActivityData();

    // Regular syncs every 30 seconds
    this.syncInterval = setInterval(async () => {
      await this.syncActivityData();
    }, intervalMs);
  }

  async stopSyncingData() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  private async syncActivityData() {
    if (this.isSyncing) return;

    this.isSyncing = true;

    try {
      const api = (window as any).electronAPI;
      console.log('[Sync] electronAPI available:', !!api);

      // Sync monitoring settings and classifications to Electron dynamically
      if (api) {
        try {
          const settings = await getMonitoringSettings();
          if (settings && api.updateMonitoringSettings) {
            await api.updateMonitoringSettings(settings);
            localStorage.setItem('blurScreenshots', settings.blur_screenshots ? 'true' : 'false');
          }
        } catch (err) {
          console.error('Failed to sync monitoring settings to Electron:', err);
        }

        try {
          const classifications = await getAppClassifications();
          if (classifications && api.updateAppClassifications) {
            await api.updateAppClassifications(classifications);
          }
        } catch (err) {
          console.error('Failed to sync app classifications to Electron:', err);
        }
      }

      const systemActivity = await activityCollector.getSystemActivity();
      await activityCollector.refreshActivityLogs();
      const logs = activityCollector.getActivityLogs();

      // Fetch screenshots from Electron main process
      let localScreenshots: any[] = [];
      if (api?.getRecentScreenshots) {
        try {
          localScreenshots = await api.getRecentScreenshots();
          if (localScreenshots.length > 0) {
            console.log(`[Sync] Fetched ${localScreenshots.length} screenshots from Electron:`, localScreenshots.map(s => ({
              app: s.app_name,
              size: s.screenshot_data ? Math.round(s.screenshot_data.length / 1024) : 0,
              hasData: !!s.screenshot_data
            })));
          }
        } catch (err) {
          console.error('Failed to get screenshots from Electron:', err);
        }
      } else {
        console.warn('[Sync] api.getRecentScreenshots not available');
      }

      // Use actual time metrics tracked by Electron
      const activeTime = systemActivity.activeSeconds;
      const productiveTime = systemActivity.productiveSeconds;
      const nonproductiveTime = Math.max(0, activeTime - productiveTime);
      const idleTime = systemActivity.idleSeconds;
      const awayTime = systemActivity.awaySeconds;
      const productivityScore = systemActivity.sessionSeconds > 0
        ? Math.round((productiveTime / systemActivity.sessionSeconds) * 100)
        : 0;

      const activityData: EmployeeActivityData = {
        employee_id: this.employeeId,
        timestamp: new Date().toISOString(),
        active_time: activeTime,
        productive_time: productiveTime,
        nonproductive_time: nonproductiveTime,
        idle_time: idleTime,
        away_time: awayTime,
        productivity_score: productivityScore,
        current_app: systemActivity.activeWindow.appName,
        activity_logs: logs.map((log) => ({
          timestamp: log.startTime || log.timestamp || new Date().toISOString(),
          type: log.type,
          app_name: log.appName,
          window_title: log.windowTitle,
          website: log.website,
          productive: log.productive,
          duration_seconds: log.durationSeconds,
        })),
        screenshots: localScreenshots.map(s => ({
          app_name: s.app_name,
          captured_at: s.captured_at,
          screenshot_data: s.screenshot_data,
        })),
        online_status: systemActivity.state === 'idle' ? 'idle' : systemActivity.state === 'away' ? 'away' : 'online',
      };

      console.log('[Sync] Constructed activityData with', activityData.screenshots.length, 'screenshots');

      // Cache locally
      await this.cacheActivityData(activityData);
      console.log('[Sync] Activity data cached');
      await this.sendToSupabase(activityData);
      console.log('[Sync] Activity data sent to Supabase');
    } catch (error) {
      console.error('Error syncing activity data:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  private async sendToSupabase(data: EmployeeActivityData) {
    let sessionId: string | null = null;
    try {
      const session = await getTodaySession(data.employee_id);
      sessionId = session?.id ?? null;
      
      // Only sync metrics if we have a valid session (not a fallback local one)
      if (sessionId && !sessionId.startsWith('session-')) {
        await syncSessionMetrics(sessionId, data.active_time, data.idle_time, data.productive_time);
      } else {
        console.warn('[Sync] Skipping session metrics - no valid database session', sessionId);
      }
    } catch (error) {
      console.error('Error updating session metrics:', error);
    }

    // Insert aggregated activity row for live status view
    try {
      const aggregatePayload = {
        employee_id: data.employee_id,
        timestamp: data.timestamp,
        active_time: data.active_time,
        productive_time: data.productive_time,
        nonproductive_time: data.nonproductive_time,
        idle_time: data.idle_time,
        away_time: data.away_time,
        productivity_score: data.productivity_score,
        current_app: data.current_app,
        activity_logs: data.activity_logs,
        // Exclude the heavy base64 screenshot data from the aggregates table 
        // to prevent huge row sizes, since they're stored in the screenshots table.
        screenshots: data.screenshots.map(s => ({ app_name: s.app_name, captured_at: s.captured_at })),
        online_status: data.online_status
      };

      await supabase.from('employee_activity').insert([aggregatePayload]);
    } catch (error) {
      console.error('Error inserting employee activity aggregate:', error);
    }

    // Upload screenshots to screenshots table
    console.log('[Sync] Starting screenshot upload - total screenshots:', data.screenshots.length);
    try {
      if (data.screenshots.length === 0) {
        console.log('[Sync] No screenshots to upload');
      }
      for (const scr of data.screenshots) {
        try {
          console.log(`[Sync] Uploading screenshot: app=${scr.app_name}, time=${scr.captured_at}, dataSize=${scr.screenshot_data ? Math.round(scr.screenshot_data.length / 1024) + 'KB' : 'missing'}`);
          const result = await createScreenshot({
            employee_id: data.employee_id,
            session_id: sessionId,
            screenshot_data: scr.screenshot_data,
            app_name: scr.app_name,
            captured_at: scr.captured_at,
            url: scr.url || `screenshot-${scr.app_name}-${scr.captured_at}`,
          });
          if (result) {
            console.log(`[Sync] ✓ Screenshot uploaded for ${scr.app_name} (${scr.captured_at})`);
          } else {
            console.warn(`[Sync] ✗ Failed to upload screenshot for ${scr.app_name}`);
          }
        } catch (error) {
          console.error(`[Sync] Error uploading screenshot for ${scr.app_name}:`, error);
        }
      }
    } catch (error) {
      console.error('Error writing screenshots to Supabase:', error);
    }

    // Upload activity logs with deduplication
    try {
      const lastSyncedLogTime = localStorage.getItem('lastSyncedLogTime') || '';
      let latestTimestamp = lastSyncedLogTime;

      // Filter: ALL activity logs newer than last sync (including incomplete/in-progress ones)
      // This ensures we capture activities even if they haven't completed yet
      const newLogs = data.activity_logs.filter(
        log => log.timestamp > lastSyncedLogTime
      );

      console.log(`[Sync] Processing ${newLogs.length} new activity logs for upload (including ${newLogs.filter(l => l.duration_seconds === 0).length} incomplete activities)`);
      
      for (const log of newLogs) {
        // Log website information when available for Chrome
        if (log.app_name && (log.app_name.toLowerCase().includes('chrome') || log.app_name.toLowerCase().includes('edge') || log.app_name.toLowerCase().includes('firefox'))) {
          console.log(`[Sync] 🌐 Browser Activity: ${log.app_name} | Website: ${log.website || '(no website)'} | Title: ${log.window_title}`);
        }
        
        // Only sync if we have a duration or if it's from within the last sync interval
        // This prevents syncing activities that are too old but not completed
        if (log.duration_seconds > 0 || (Date.now() - new Date(log.timestamp).getTime()) < 60000) {
          await createActivityLog({
            session_id: sessionId,
            employee_id: data.employee_id,
            app_name: log.app_name || data.current_app,
            window_title: log.window_title || '',
            activity_type: log.type || 'idle',
            idle_reason: log.productive === false ? 'Non-productive or idle' : null,
            logged_at: log.timestamp || data.timestamp,
            cpu_usage: log.cpu_usage,
            memory_usage: log.memory_usage,
            duration_seconds: log.duration_seconds || 1, // Ensure at least 1 second for incomplete activities
            productive: log.productive,
            website: log.website,
          });
        }

        if (log.timestamp > latestTimestamp) {
          latestTimestamp = log.timestamp;
        }
      }

      if (latestTimestamp !== lastSyncedLogTime) {
        localStorage.setItem('lastSyncedLogTime', latestTimestamp);
      }
    } catch (error) {
      console.error('Error writing activity logs to Supabase:', error);
    }
  }

  private async cacheActivityData(data: EmployeeActivityData) {
    try {
      if (typeof window !== 'undefined') {
        const cached = localStorage.getItem('cachedActivityData');
        const cache = cached ? JSON.parse(cached) : [];

        cache.push(data);

        // Keep only last 100 entries
        if (cache.length > 100) {
          cache.shift();
        }

        localStorage.setItem('cachedActivityData', JSON.stringify(cache));
      }
    } catch (error) {
      console.error('Error caching activity data:', error);
    }
  }

  async getCachedActivityData(): Promise<EmployeeActivityData[]> {
    try {
      if (typeof window !== 'undefined') {
        const cached = localStorage.getItem('cachedActivityData');
        return cached ? JSON.parse(cached) : [];
      }
    } catch (error) {
      console.error('Error reading cached activity data:', error);
    }
    return [];
  }

  async getEmployeeActivityFromSupabase(employeeId: string) {
    try {
      const { data, error } = await supabase
        .from('employee_activity')
        .select('*')
        .eq('employee_id', employeeId)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Error fetching activity data:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting employee activity:', error);
      return [];
    }
  }

  async getAllEmployeesActivity() {
    try {
      const { data, error } = await supabase
        .from('employee_activity')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(500);

      if (error) {
        console.error('Error fetching all activity data:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting all employees activity:', error);
      return [];
    }
  }

  async getEmployeeStats(employeeId: string, days: number = 1) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('employee_activity')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('timestamp', startDate.toISOString())
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('Error fetching stats:', error);
        return null;
      }

      if (!data || data.length === 0) {
        return null;
      }

      // Calculate aggregate stats
      const stats = {
        total_active_time: 0,
        total_productive_time: 0,
        total_nonproductive_time: 0,
        total_idle_time: 0,
        average_productivity: 0,
        session_count: data.length,
        start_time: data[0].timestamp,
        end_time: data[data.length - 1].timestamp,
      };

      data.forEach((record: any) => {
        stats.total_active_time += record.active_time;
        stats.total_productive_time += record.productive_time;
        stats.total_nonproductive_time += record.nonproductive_time;
        stats.total_idle_time += record.idle_time;
        stats.average_productivity += record.productivity_score;
      });

      stats.average_productivity = Math.round(
        stats.average_productivity / data.length
      );

      return stats;
    } catch (error) {
      console.error('Error calculating stats:', error);
      return null;
    }
  }
}

export const activitySyncService = new ActivitySyncService();
export default ActivitySyncService;
