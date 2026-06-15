import React, { useEffect, useRef, useState } from 'react';
import {
  Monitor, Clock, Zap, Coffee, Activity, LogOut, Droplets, Timer,
  Globe, Code2, FileSpreadsheet, Mail, MessageSquare, Terminal,
  LayoutDashboard, Layers, ChevronDown, ChevronUp, Moon, XCircle, Play, PauseCircle, Calendar,
} from 'lucide-react';
import { Employee, WorkSession, finishDay, fetchEmployeeSessionByDate, fetchEmployeeActivityLogsByDate, getEmployeeScreenshotsByDate, fetchIdleAlertsByDate } from '../lib/supabase';
import { useActivityMonitor, formatTime, ActivityState } from '../hooks/useActivityMonitor';
import WaterReminderModal from './WaterReminderModal';
import WindowControls from './WindowControls';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format } from 'date-fns';
import PMSNotificationModal from './PMSNotificationModal';

interface TimerScreenProps {
  employee: Employee;
  session: WorkSession;
  showWaterReminder: boolean;
  onDismissWater: () => void;
  onLogout: () => void;
}

interface ActivityLogEntry {
  appName: string;
  windowTitle: string;
  website?: string;
  type: 'app' | 'idle' | 'away';
  productive: boolean;
  startTime: string;
  endTime?: string;
  durationSeconds: number;
}

const STATE_CONFIG: Record<ActivityState, { label: string; color: string; bg: string; dot: string; icon: React.ReactNode }> = {
  productive: {
    label: 'Productive',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-200',
    dot: 'bg-emerald-400',
    icon: <Zap className="w-4 h-4 text-emerald-500" />,
  },
  idle: {
    label: 'Idle',
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-200',
    dot: 'bg-amber-400',
    icon: <Coffee className="w-4 h-4 text-amber-500" />,
  },
  away: {
    label: 'Away',
    color: 'text-slate-500',
    bg: 'bg-slate-50 border-slate-200',
    dot: 'bg-slate-400',
    icon: <Monitor className="w-4 h-4 text-slate-400" />,
  },
  non_productive: {
    label: 'Non-Productive',
    color: 'text-rose-500',
    bg: 'bg-rose-50 border-rose-200',
    dot: 'bg-rose-400',
    icon: <Activity className="w-4 h-4 text-rose-400" />,
  },
  neutral: {
    label: 'Neutral',
    color: 'text-gray-500',
    bg: 'bg-gray-50 border-gray-200',
    dot: 'bg-gray-400',
    icon: <Monitor className="w-4 h-4 text-gray-400" />,
  },
};

/** Returns a small icon component based on app name */
function AppIcon({ appName, size = 'w-5 h-5' }: { appName: string; size?: string }) {
  const n = appName.toLowerCase();
  if (/chrome|edge|firefox|brave|safari|browser/.test(n)) return <Globe className={`${size} text-blue-400`} />;
  if (/code|vscode|visual studio/.test(n)) return <Code2 className={`${size} text-blue-500`} />;
  if (/excel|spreadsheet/.test(n)) return <FileSpreadsheet className={`${size} text-emerald-500`} />;
  if (/outlook|mail|thunderbird/.test(n)) return <Mail className={`${size} text-blue-600`} />;
  if (/teams|slack|discord|zoom/.test(n)) return <MessageSquare className={`${size} text-purple-500`} />;
  if (/terminal|powershell|cmd|bash/.test(n)) return <Terminal className={`${size} text-gray-500`} />;
  if (/word|document|writer/.test(n)) return <Layers className={`${size} text-blue-500`} />;
  return <LayoutDashboard className={`${size} text-pink-400`} />;
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function TimerScreen({ employee, session, showWaterReminder, onDismissWater, onLogout }: TimerScreenProps) {
  const activity = useActivityMonitor(true);
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showConfirmLogout, setShowConfirmLogout] = useState(false);
  const [showConfirmFinishDay, setShowConfirmFinishDay] = useState(false);

  // Debug log for session data
  useEffect(() => {
    console.log('[TimerScreen] Received session:', session.id, 'started_work_time:', session.started_work_time);
  }, [session.id]);

  // Load monitoring settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Settings handled globally
      } catch (err) {
        console.error('Failed to load monitoring settings in TimerScreen:', err);
      }
    };
    loadSettings();
  }, []);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [activeLogTab, setActiveLogTab] = useState<'activity' | 'apps' | 'alerts'>('activity');
  const [recentScreenshots, setRecentScreenshots] = useState<any[]>([]);
  const [idleAlerts, setIdleAlerts] = useState<any[]>([]);

  const [clockStr, setClockStr] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [debugInfo, setDebugInfo] = useState({ logsCount: 0, activityState: 'away', lastUpdate: new Date().toLocaleTimeString() });

  // Historical View State
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isHistoricalView, setIsHistoricalView] = useState(false);
  const [historicalSession, setHistoricalSession] = useState<WorkSession | null>(null);
  const [historicalActivityLogs, setHistoricalActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [historicalLastActive, setHistoricalLastActive] = useState<string | null>(null);

  // PMS Notifications State
  const [pmsData, setPmsData] = useState<{ tasks: number; discussions: number } | null>(null);

  // Start background PMS poller and listen for notifications from main process
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.startPMSPoller) return;

    // Start the background poller in the Electron main process
    api.startPMSPoller(employee.employee_code);

    // Listen for PMS notification events pushed from main process
    if (api.onPmsNotification) {
      api.onPmsNotification((data: { newTasks: number; newDiscussions: number }) => {
        if (data.newTasks > 0 || data.newDiscussions > 0) {
          setPmsData({ tasks: data.newTasks, discussions: data.newDiscussions });
        }
      });
    }

    return () => {
      // Stop poller when component unmounts (logout)
      if (api.stopPMSPoller) api.stopPMSPoller();
    };
  }, [employee.employee_code]);

  // Handle finish day
  const handleFinishDay = async () => {
    try {
      // Call finishDay to update database
      await finishDay(session.id);

      // Stop monitoring via Electron IPC
      const api = (window as any).electronAPI;
      if (api?.invoke) {
        await api.invoke('finish-day');
      }

      // Logout user after finishing day
      onLogout();
    } catch (err) {
      console.error('Error finishing day:', err);
      alert('Failed to finish day. Please try again.');
    }
  };

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClockStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setDateStr(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Poll or Fetch screenshots
  useEffect(() => {
    const fetchScreenshots = async () => {
      try {
        if (isHistoricalView) {
          const dateString = format(selectedDate, 'yyyy-MM-dd');
          const [data, alertsData] = await Promise.all([
            getEmployeeScreenshotsByDate(employee.id, dateString),
            fetchIdleAlertsByDate(employee.id, dateString)
          ]);
          setRecentScreenshots(Array.isArray(data) ? data : []);
          setIdleAlerts(Array.isArray(alertsData) ? alertsData : []);
          return;
        }

        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const { getEmployeeScreenshots } = await import('../lib/supabase');
        const [data, alertsData] = await Promise.all([
          getEmployeeScreenshots(employee.id, 12),
          fetchIdleAlertsByDate(employee.id, todayStr)
        ]);
        if (Array.isArray(data)) {
          setRecentScreenshots(data);
        }
        if (Array.isArray(alertsData)) {
          setIdleAlerts(alertsData);
        }
      } catch (err) {
        console.error('Error fetching recent screenshots:', err);
      }
    };
    fetchScreenshots();
    if (!isHistoricalView) {
      const id = setInterval(fetchScreenshots, 30000);
      return () => clearInterval(id);
    }
  }, [employee.id, isHistoricalView, selectedDate]);

  // Poll or Fetch activity logs
  useEffect(() => {
    if (isHistoricalView) {
      const fetchHistoricalLogs = async () => {
        const dateString = format(selectedDate, 'yyyy-MM-dd');
        try {
          const logs = await fetchEmployeeActivityLogsByDate(employee.id, dateString);

          let lastActiveTime = null;
          if (logs.length > 0) {
            lastActiveTime = new Date(logs[0].logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }

          setHistoricalLastActive(lastActiveTime);

          const formattedLogs: ActivityLogEntry[] = logs.map((log: any) => ({
            appName: log.app_name || 'Unknown',
            windowTitle: log.window_title || 'No title',
            website: log.website || '',
            type: log.activity_type as 'app' | 'idle' | 'away',
            productive: log.productive || false,
            startTime: log.logged_at,
            durationSeconds: log.duration_seconds || 0
          }));
          setHistoricalActivityLogs(formattedLogs);
        } catch (err) {
          console.error('[Timer] Error fetching historical activity logs:', err);
        }
      };
      fetchHistoricalLogs();
      return;
    }

    const poll = async () => {
      const api = (window as any).electronAPI;
      if (!api?.getActivityLogs) {
        console.warn('[Timer] electronAPI.getActivityLogs not available');
        return;
      }
      try {
        const logs = await api.getActivityLogs();
        if (Array.isArray(logs)) {
          setActivityLogs(logs.slice(0, 30));
          setDebugInfo(prev => ({
            ...prev,
            logsCount: logs.length,
            lastUpdate: new Date().toLocaleTimeString(),
          }));
        }
      } catch (err) {
        console.error('[Timer] Error polling activity logs:', err);
      }
    };
    poll();
    logPollRef.current = setInterval(poll, 2000);
    return () => { if (logPollRef.current) clearInterval(logPollRef.current); };
  }, [isHistoricalView, selectedDate, employee.id]);

  // Fetch historical session when selected date changes
  useEffect(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const selectedStr = format(selectedDate, 'yyyy-MM-dd');

    if (selectedStr === todayStr) {
      setIsHistoricalView(false);
      setHistoricalSession(null);
    } else {
      setIsHistoricalView(true);
      const loadSession = async () => {
        const pastSession = await fetchEmployeeSessionByDate(employee.id, selectedStr);
        setHistoricalSession(pastSession);
      };
      loadSession();
    }
  }, [selectedDate, employee.id]);

  // Update debug info with current activity state
  useEffect(() => {
    setDebugInfo(prev => ({
      ...prev,
      activityState: activity.state,
    }));
  }, [activity.state]);

  // Note: Sync to DB is handled globally in the background by activitySyncService.
  // Idle detection is now handled by the separate idlePromptWindow in main process.

  // Derived variables for display
  const displaySession = isHistoricalView ? historicalSession : session;
  const displayLogs = isHistoricalView ? historicalActivityLogs : activityLogs;

  const displaySessionSeconds = isHistoricalView
    ? (historicalSession?.active_seconds || 0) + (historicalSession?.idle_seconds || 0)
    : activity.sessionSeconds;
  const displayActiveSeconds = isHistoricalView ? (historicalSession?.active_seconds || 0) : activity.activeSeconds;
  const displayIdleSeconds = isHistoricalView ? (historicalSession?.idle_seconds || 0) : activity.idleSeconds;
  const displayProductiveSeconds = isHistoricalView ? (historicalSession?.productive_seconds || 0) : activity.productiveSeconds;
  const displayAwaySeconds = isHistoricalView ? 0 : activity.awaySeconds;

  const stateConf = isHistoricalView ? STATE_CONFIG['neutral'] : STATE_CONFIG[activity.state];

  const productivityPct =
    displaySessionSeconds > 0
      ? Math.round((displayProductiveSeconds / displaySessionSeconds) * 100)
      : 0;

  const punchInTime = displaySession?.started_work_time
    ? new Date(displaySession.started_work_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Not recorded';

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-white flex flex-col">

      {/* ── Top Bar ───────────────────────────────────────────── */}
      <header className="bg-white border-b border-pink-100 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-pink-400 to-rose-500 rounded-xl flex items-center justify-center shadow-sm">
            <Timer className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-800 leading-none text-sm">Knockturn Agent</h1>
            <p className="text-xs text-gray-400">{employee.employee_name} &middot; {employee.employee_code}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 border border-pink-100 rounded-lg px-3 py-1.5 hover:border-pink-300 transition-colors bg-pink-50/30">
            <Calendar className="w-4 h-4 text-pink-500" />
            <DatePicker
              selected={selectedDate}
              onChange={(date: Date | null) => date && setSelectedDate(date)}
              maxDate={new Date()}
              dateFormat="MMM d, yyyy"
              className="bg-transparent border-none outline-none text-sm font-semibold text-gray-700 w-28 cursor-pointer"
            />
          </div>
          <div className="text-right hidden sm:block">
            <p className="font-semibold text-gray-700 text-sm">{clockStr}</p>
            <p className="text-xs text-gray-400">{dateStr}</p>
          </div>
          <WindowControls />
          {!isHistoricalView && (
            <>
              <button
                onClick={() => setShowConfirmFinishDay(true)}
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-amber-500 transition border border-transparent hover:border-amber-200 rounded-lg px-3 py-1.5"
              >
                <PauseCircle className="w-4 h-4" />
                <span className="hidden sm:inline">Pause</span>
              </button>
              <button
                onClick={() => setShowConfirmLogout(true)}
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-rose-500 transition border border-transparent hover:border-rose-200 rounded-lg px-3 py-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Main content ──────────────────────────────────────── */}
      <div className="flex-1 p-5 grid grid-cols-1 lg:grid-cols-3 gap-5 overflow-auto">

        {/* Left / Main column */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* Session Duration card */}
          <div className="bg-white rounded-2xl shadow-sm border border-pink-100 p-6 flex flex-col gap-5">
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-gray-400 mb-2 font-semibold">Session Duration</p>
              <div className="font-mono text-6xl font-bold text-gray-800 tracking-tight">
                {formatTime(displaySessionSeconds)}
              </div>
              {/* State badge with pulsing dot */}
              <div className={`inline-flex items-center gap-2 mt-3 px-4 py-1.5 rounded-full border text-sm font-semibold ${stateConf.bg} ${stateConf.color}`}>
                {!isHistoricalView && <span className={`w-2 h-2 rounded-full ${stateConf.dot} animate-pulse`} />}
                {stateConf.icon}
                {isHistoricalView ? 'Historical Record' : stateConf.label}
              </div>
            </div>

            {/* Time breakdown */}
            <div className="grid grid-cols-5 gap-3">
              <TimeCard label="Active" seconds={displayActiveSeconds} color="green" icon={<Zap className="w-5 h-5 text-emerald-500" />} />
              <TimeCard label="Idle" seconds={displayIdleSeconds} color="amber" icon={<Coffee className="w-5 h-5 text-amber-500" />} />
              <TimeCard label="Productive" seconds={displayProductiveSeconds} color="pink" icon={<Activity className="w-5 h-5 text-pink-500" />} />
              <TimeCard label="Non-Productive" seconds={Math.max(0, displayActiveSeconds - displayProductiveSeconds)} color="rose" icon={<XCircle className="w-5 h-5 text-rose-500" />} />
              <TimeCard label="Away" seconds={displayAwaySeconds} color="slate" icon={<Moon className="w-5 h-5 text-slate-400" />} />
            </div>

            {/* Productivity bar */}
            <div>
              <div className="flex justify-between text-sm text-gray-500 mb-2">
                <span className="font-semibold">Productivity Score</span>
                <span className="font-bold text-pink-500">{productivityPct}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-pink-400 to-rose-500 rounded-full transition-all duration-1000"
                  style={{ width: `${productivityPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Non-productive</span>
                <span>Highly productive</span>
              </div>
            </div>
          </div>

          {/* ── Activity Log / App Usage / Idle Alerts ──────────────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-pink-100 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-2 pt-2 border-b border-pink-50 bg-pink-50/20">
              <div className="flex space-x-1">
                {(['activity', 'apps', 'alerts'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => { setActiveLogTab(tab); setLogsExpanded(true); }}
                    className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors ${activeLogTab === tab && logsExpanded
                        ? 'bg-white text-pink-600 border-t border-x border-pink-100'
                        : 'text-gray-500 hover:bg-white/50 border-t border-x border-transparent'
                      }`}
                  >
                    {tab === 'activity' && (isHistoricalView ? 'Activity Log' : 'Live Activity')}
                    {tab === 'apps' && 'App Usage'}
                    {tab === 'alerts' && 'Idle Alerts'}
                  </button>
                ))}
              </div>
              <button
                className="p-2 mr-2 text-gray-400 hover:text-gray-600 transition"
                onClick={() => setLogsExpanded(v => !v)}
              >
                {logsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {logsExpanded && (
              <div className="max-h-64 overflow-y-auto divide-y divide-gray-50 p-2">

                {/* Live Activity Log */}
                {activeLogTab === 'activity' && (
                  displayLogs.length === 0 ? (
                    <div className="text-xs text-gray-400 text-center py-6">
                      <p>No activity recorded yet…</p>
                      {!isHistoricalView && (
                        <>
                          <p className="mt-2 text-gray-300">
                            {activity.currentApp && activity.currentApp !== 'Unknown'
                              ? `Current active app: ${activity.currentApp}`
                              : 'Monitoring for application changes'}
                          </p>
                          <p className="mt-1 text-gray-300">({debugInfo.logsCount} detected, state: {debugInfo.activityState})</p>
                        </>
                      )}
                    </div>
                  ) : (
                    displayLogs.filter(log => log.type !== 'idle_reason').map((log, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5 hover:bg-pink-50/40 transition rounded-lg">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${log.productive ? 'bg-emerald-50' : log.type === 'idle' ? 'bg-amber-50' : 'bg-rose-50'}`}>
                          <AppIcon appName={log.appName} size="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-700 truncate">{log.appName || '—'}</p>
                          <p className="text-xs text-gray-400 truncate">{log.website || log.windowTitle || '—'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-gray-500">{formatLogTime(log.startTime)}</p>
                          <p className={`text-xs font-semibold ${log.productive ? 'text-emerald-500' : log.type === 'idle' ? 'text-amber-500' : 'text-rose-400'}`}>
                            {log.durationSeconds > 0 ? formatDuration(log.durationSeconds) : '…'}
                          </p>
                        </div>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${log.type === 'idle' ? 'bg-amber-400' : log.type === 'away' ? 'bg-slate-300' : log.productive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                      </div>
                    ))
                  )
                )}

                {/* App Usage */}
                {activeLogTab === 'apps' && (
                  (() => {
                    const appUsage = new Map<string, number>();
                    displayLogs.forEach((log) => {
                      if (log.type === 'idle_reason') return;
                      const appName = log.appName && log.appName !== 'Unknown' ? log.appName : 'Unknown';
                      const duration = log.durationSeconds || 0;
                      appUsage.set(appName, (appUsage.get(appName) || 0) + duration);
                    });
                    const sortedApps = Array.from(appUsage.entries()).sort((a, b) => b[1] - a[1]);

                    return sortedApps.length === 0 ? (
                      <div className="text-xs text-gray-400 text-center py-6">No app usage recorded yet.</div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 p-2">
                        {sortedApps.map(([appName, durationSeconds]) => (
                          <div key={appName} className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex flex-col gap-1">
                            <p className="text-xs font-semibold text-slate-800 truncate">{appName}</p>
                            <p className="text-[10px] text-pink-600 font-bold tracking-wide">
                              {formatDuration(durationSeconds)}
                            </p>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                )}

                {/* Idle Alerts */}
                {activeLogTab === 'alerts' && (
                  (() => {
                    return idleAlerts.length === 0 ? (
                      <div className="text-xs text-gray-400 text-center py-6">No idle alerts recorded.</div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {idleAlerts.map((alert, i) => {
                          const durationStr = alert.duration_seconds ? formatDuration(alert.duration_seconds) : '';
                          return (
                            <div key={i} className="flex gap-3 py-2.5 px-3 bg-amber-50/40 rounded-lg mb-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-2 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-amber-800 break-words">{alert.reason}</p>
                                <p className="text-[10px] font-medium text-amber-700/80 mt-0.5">Status: {alert.response}</p>
                                {durationStr ? (
                                  <div className="mt-1 flex items-center gap-3 text-[10px] text-amber-700/80">
                                    <span><span className="font-semibold text-amber-700">Time:</span> {formatLogTime(alert.idle_since)}</span>
                                    <span><span className="font-semibold text-amber-700">Duration:</span> {durationStr}</span>
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-gray-400 mt-0.5">{formatLogTime(alert.idle_since)}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}

              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">

          {/* Current Activity (Live Only) */}
          {!isHistoricalView && (
            <div className="bg-white rounded-2xl shadow-sm border border-pink-100 p-5">
              <p className="text-xs uppercase tracking-widest text-gray-400 mb-3 font-semibold">Current Activity</p>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-pink-50 rounded-xl flex items-center justify-center shrink-0">
                  <AppIcon appName={activity.currentApp} size="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-800 text-sm truncate">
                    {activity.currentApp && activity.currentApp !== 'Unknown' ? activity.currentApp : '—'}
                  </p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">
                    {activity.website || activity.windowTitle || '—'}
                  </p>
                  {/* Live state pill */}
                  <div className={`inline-flex items-center gap-1 mt-2 text-xs font-semibold px-2 py-0.5 rounded-full border ${stateConf.bg} ${stateConf.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${stateConf.dot} animate-pulse`} />
                    {stateConf.label}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Session Stats */}
          <div className="bg-white rounded-2xl shadow-sm border border-pink-100 p-5">
            <p className="text-xs uppercase tracking-widest text-gray-400 mb-3 font-semibold">Session Stats</p>
            <div className="space-y-3">
              <StatRow label="Started Working" value={punchInTime} />
              {isHistoricalView && historicalLastActive && (
                <StatRow label="Last Active" value={historicalLastActive} highlight />
              )}
              <StatRow label="Total Session" value={formatTime(displaySessionSeconds)} />
              <StatRow label="Active Time" value={formatTime(displayActiveSeconds)} />
              <StatRow label="Idle Time" value={formatTime(displayIdleSeconds)} />
              <StatRow label="Non-Productive" value={formatTime(Math.max(0, displayActiveSeconds - displayProductiveSeconds))} />
              <StatRow label="Away Time" value={formatTime(displayAwaySeconds)} />
              <StatRow label="Productive" value={`${productivityPct}%`} highlight />
            </div>
          </div>

          {/* Punch In */}
          <div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-2xl border border-pink-100 p-5">
            <p className="text-xs uppercase tracking-widest text-gray-400 mb-2 font-semibold">Started Working</p>
            <div className="flex items-center gap-2">
              <Play className="w-4 h-4 text-emerald-500" />
              <span className="font-bold text-gray-700 text-sm">{punchInTime}</span>
            </div>
          </div>

          {/* Recent Screenshots */}
          <div className="bg-white rounded-2xl shadow-sm border border-pink-100 p-5 flex flex-col">
            <p className="text-xs uppercase tracking-widest text-gray-400 mb-3 font-semibold">Recent Screenshots</p>
            {recentScreenshots.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No screenshots captured yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                {recentScreenshots.map((scr, idx) => (
                  <div key={scr.id || idx} className="relative group cursor-pointer aspect-video rounded-lg overflow-hidden border border-pink-100 bg-gray-50 shadow-sm">
                    <img
                      src={scr.screenshot_data}
                      alt={scr.app_name || 'Screenshot'}
                      className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                      onClick={() => {
                        const w = window.open();
                        if (w) {
                          w.document.write(`<img src="${scr.screenshot_data}" style="max-width:100%; max-height:100vh; display:block; margin:auto; box-shadow: 0 10px 25px rgba(0,0,0,0.2); border-radius: 8px;" />`);
                          w.document.title = `Screenshot - ${scr.app_name || 'Unknown'}`;
                        }
                      }}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-end p-1.5">
                      <span className="text-[9px] text-white font-semibold truncate w-full">
                        {scr.app_name || 'Unknown App'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Water reminder */}
          <div className="bg-blue-50 rounded-2xl border border-blue-100 p-4 flex items-center gap-3">
            <Droplets className="w-5 h-5 text-blue-400 shrink-0" />
            <p className="text-xs text-blue-600 font-medium">Hourly water reminders are active</p>
          </div>
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────── */}
      {showWaterReminder && <WaterReminderModal onDismiss={onDismissWater} />}

      {pmsData && (
        <PMSNotificationModal
          tasks={pmsData.tasks}
          discussions={pmsData.discussions}
          onDismiss={() => {
            setPmsData(null);
            const api = (window as any).electronAPI;
            if (api?.dismissPMSNotification) {
              api.dismissPMSNotification();
            }
          }}
        />
      )}

      {showConfirmLogout && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-pink-100 p-6 max-w-sm w-full text-center">
            <h3 className="font-bold text-gray-800 text-lg mb-2">Sign Out?</h3>
            <p className="text-gray-500 text-sm mb-5">Your session data will be saved. Are you sure?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmLogout(false)}
                className="flex-1 border border-pink-200 text-pink-500 hover:bg-pink-50 font-semibold py-2.5 rounded-xl transition"
              >Cancel</button>
              <button
                onClick={onLogout}
                className="flex-1 bg-gradient-to-r from-pink-500 to-rose-500 text-white font-semibold py-2.5 rounded-xl shadow transition hover:from-pink-600 hover:to-rose-600"
              >Sign Out</button>
            </div>
          </div>
        </div>
      )}

      {showConfirmFinishDay && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-amber-100 p-6 max-w-sm w-full text-center">
            <div className="flex justify-center mb-3">
              <PauseCircle className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="font-bold text-gray-800 text-lg mb-2">Finish the Day?</h3>
            <p className="text-gray-500 text-sm mb-5">
              This will stop tracking your activity and end your work session. You won't be able to resume today. Are you sure?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmFinishDay(false)}
                className="flex-1 border border-amber-200 text-amber-600 hover:bg-amber-50 font-semibold py-2.5 rounded-xl transition"
              >Cancel</button>
              <button
                onClick={handleFinishDay}
                className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold py-2.5 rounded-xl shadow transition hover:from-amber-600 hover:to-orange-600"
              >Finish Day</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TimeCard({ label, seconds, color, icon }: { label: string; seconds: number; color: string; icon: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    green: 'border-emerald-100 bg-emerald-50/60',
    amber: 'border-amber-100 bg-amber-50/60',
    pink: 'border-pink-100 bg-pink-50/60',
    rose: 'border-rose-100 bg-rose-50/60',
    slate: 'border-slate-100 bg-slate-50/60',
  };
  return (
    <div className={`rounded-xl border p-3 ${colorMap[color]}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-gray-500 font-semibold">{label}</span>
      </div>
      <p className="font-mono font-bold text-gray-800">{formatTime(seconds)}</p>
    </div>
  );
}

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`font-bold text-sm ${highlight ? 'text-pink-500' : 'text-gray-700'}`}>{value}</span>
    </div>
  );
}
