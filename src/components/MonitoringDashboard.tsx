import React, { useState, useEffect } from 'react';
import {
  Users,
  Activity,
  Clock,
  AlertCircle,
  Eye,
  LogOut,
  Zap,
  PhoneIncoming,
  Phone,
  PhoneOff,
  MapPin,
} from 'lucide-react';
import {
  fetchAllEmployees,
  fetchActivityLogsByDate,
  fetchSessionsByDate,
  getTimesheetLockLogsByDate,
  fetchIdleAlertsByDate,
  ActivityLog,
  WorkSession,
  TimesheetLockLog,
  IdleAlert,
  getEmployeeScreenshotsByDate,
} from '../lib/supabase';
import {
  getCallLogsByDate,
  getCallStatsByDate,
  formatDuration,
  CallLog,
  getFieldLocationsByDate,
  FieldLocation,
} from '../lib/mobileSync';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format } from 'date-fns';

interface EmployeeOverview {
  id: string;
  name: string;
  department: string;
  status: 'online' | 'idle' | 'away' | 'offline';
  lastSync: string;
  lastActive: string;
  lastIdleReason?: string;
}

interface ActivityData {
  activeTime: number;
  productiveTime: number;
  nonproductiveTime: number;
  idleTime: number;
  awayTime: number;
  productivity: number;
  currentApp: string;
  sessionStartTime: string;
  screenshots: Array<{
    timestamp: string;
    url: string;
    appName: string;
  }>;
  activityLogs: Array<{
    timestamp: string;
    loggedAt: string;
    type: string;
    details: string;
    durationSeconds?: number;
  }>;
}

interface ScreenshotCardProps {
  shot: {
    timestamp: string;
    url: string;
    appName: string;
  };
}

const ScreenshotCard: React.FC<ScreenshotCardProps> = ({ shot }) => {
  const [imageError, setImageError] = useState(false);
  const isValidUrl = shot.url && shot.url.length > 0;

  return (
    <div className="relative group overflow-hidden rounded-xl border border-slate-100 bg-slate-50 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
      {imageError || !isValidUrl ? (
        <div className="w-full h-36 flex items-center justify-center bg-slate-100">
          <div className="text-center">
            <Eye className="w-6 h-6 text-slate-300 mx-auto mb-1" />
            <p className="text-xs text-slate-400">Failed to load</p>
            <p className="text-xs text-slate-400 mt-0.5">{shot.appName}</p>
          </div>
        </div>
      ) : (
        <img
          src={shot.url}
          alt={shot.appName}
          className="w-full h-36 object-cover"
          onError={() => {
            console.error(`Failed to load screenshot: ${shot.appName}`);
            setImageError(true);
          }}
        />
      )}
      <div className="opacity-0 group-hover:opacity-100 absolute inset-0 bg-gradient-to-t from-black/60 to-transparent rounded-xl flex items-end p-3 text-white text-xs transition-opacity duration-200">
        <div>
          <p className="font-semibold truncate">{shot.appName || 'Unknown'}</p>
          <p className="text-white/70 text-[10px] mt-0.5">{shot.timestamp}</p>
        </div>
      </div>
    </div>
  );
};

/* ─── Status helpers ────────────────────────────────────────────── */
const statusDot: Record<string, string> = {
  online: 'bg-emerald-400',
  idle:   'bg-amber-400',
  away:   'bg-orange-400',
  offline:'bg-slate-300',
};
const statusBadge: Record<string, string> = {
  online: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  idle:   'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  away:   'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  offline:'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
};
const avatarColor: Record<string, string> = {
  online: 'bg-emerald-100 text-emerald-700',
  idle:   'bg-amber-100 text-amber-700',
  away:   'bg-orange-100 text-orange-700',
  offline:'bg-slate-100 text-slate-500',
};
const metricColor: Record<string, string> = {
  active:      'text-blue-600',
  productive:  'text-emerald-600',
  nonproductive:'text-rose-500',
  idle:        'text-amber-500',
  away:        'text-orange-500',
  productivity:'text-violet-600',
};

/* ─── Stat card ─────────────────────────────────────────────────── */
const StatCard: React.FC<{ label: string; value: string | number; color: string; icon: React.ReactNode }> = ({
  label, value, color, icon,
}) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color} bg-opacity-10`}>
      {icon}
    </div>
    <div>
      <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide leading-none">{label}</p>
      <p className={`text-xl font-bold mt-1 leading-none ${color}`}>{value}</p>
    </div>
  </div>
);

/* ─── Metric pill ───────────────────────────────────────────────── */
const MetricPill: React.FC<{ label: string; value: string; colorClass: string }> = ({ label, value, colorClass }) => (
  <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">{label}</p>
    <p className={`text-base font-bold ${colorClass}`}>{value}</p>
  </div>
);

type MonitoringTab = 'activity' | 'applications' | 'screenshots' | 'alerts' | 'logs' | 'locations';

interface MonitoringDashboardProps {
  defaultTab?: MonitoringTab;
  hideTabs?: boolean;
}

const MonitoringDashboard: React.FC<MonitoringDashboardProps> = ({ defaultTab = 'activity', hideTabs = false }) => {
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeOverview | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [initialSelectionDone, setInitialSelectionDone] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOverview[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [lockLogs, setLockLogs] = useState<TimesheetLockLog[]>([]);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [idleAlerts, setIdleAlerts] = useState<IdleAlert[]>([]);
  const [activityData, setActivityData] = useState<ActivityData>({
    activeTime: 0,
    productiveTime: 0,
    nonproductiveTime: 0,
    idleTime: 0,
    awayTime: 0,
    productivity: 0,
    currentApp: 'Chrome',
    sessionStartTime: new Date().toLocaleTimeString(),
    screenshots: [],
    activityLogs: [],
  });

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSession, setSelectedSession] = useState<WorkSession | null>(null);

  const [activeTab, setActiveTab] = useState<MonitoringTab>(defaultTab);
  const [sessionDuration, setSessionDuration] = useState('0h 0m');
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [callStats, setCallStats] = useState<any>(null);
  const [fieldLocations, setFieldLocations] = useState<FieldLocation[]>([]);
  const [callLogsLoading, setCallLogsLoading] = useState(false);

  const normalizeScreenshotUrl = (value: string) => {
    if (!value) return '';
    if (value.startsWith('data:image/')) return value;
    if (/^[A-Za-z0-9+/=]+$/.test(value)) return `data:image/jpeg;base64,${value}`;
    console.warn('Screenshot data format not recognized:', value.substring(0, 100));
    return '';
  };

  /* ── Employee list + sessions (30 s) ── */
  useEffect(() => {
    const loadEmployeeList = async () => {
      const dateString = format(selectedDate, 'yyyy-MM-dd');
      const [rawEmployees, rawSessions, rawActivityLogs] = await Promise.all([
        fetchAllEmployees(),
        fetchSessionsByDate(dateString),
        fetchActivityLogsByDate(dateString),
      ]);

      const employeeMap = new Map<string, WorkSession[]>();
      rawSessions.forEach((session) => {
        if (!employeeMap.has(session.employee_id)) {
          employeeMap.set(session.employee_id, []);
        }
        employeeMap.get(session.employee_id)!.push(session);
      });

      const employeeActivityCount = new Map<string, number>();
      const employeeLastActive = new Map<string, string>();
      const employeeLastIdleReason = new Map<string, string>();
      
      rawActivityLogs.forEach((log) => {
        employeeActivityCount.set(log.employee_id, (employeeActivityCount.get(log.employee_id) || 0) + 1);
        const cur = employeeLastActive.get(log.employee_id);
        if (!cur || log.logged_at > cur) employeeLastActive.set(log.employee_id, log.logged_at);
        
        if (log.activity_type === 'idle_reason' && log.idle_reason) {
          const curIdle = employeeLastIdleReason.get(log.employee_id + '_time');
          if (!curIdle || log.logged_at > curIdle) {
            employeeLastIdleReason.set(log.employee_id + '_time', log.logged_at);
            employeeLastIdleReason.set(log.employee_id, log.idle_reason);
          }
        }
      });

      const updatedEmployees: EmployeeOverview[] = rawEmployees.map((emp) => {
        const empSessions = employeeMap.get(emp.id) || [];
        // Use the last session for general activity checks, but find the earliest login moment
        const latestSession = empSessions.length > 0 ? empSessions[empSessions.length - 1] : null;
        
        let firstLoginTime: string | null = null;
        for (const s of empSessions) {
          const candidate = s.punch_in_time || s.started_work_time || s.created_at;
          if (candidate) {
            if (!firstLoginTime || new Date(candidate) < new Date(firstLoginTime)) {
              firstLoginTime = candidate;
            }
          }
        }

        const activityCount = employeeActivityCount.get(emp.id) || 0;
        const maxActive = Math.max(0, ...empSessions.map(s => s.active_seconds || 0));
        const maxProductive = Math.max(0, ...empSessions.map(s => s.productive_seconds || 0));
        const hasActivity = maxActive > 0 || maxProductive > 0;
        const hasActivityLogs = activityCount > 0;
        
        const hasPunchIn = firstLoginTime && latestSession && !latestSession.day_finished;
        const isRecentPunchIn = hasPunchIn && firstLoginTime
          ? (Date.now() - new Date(firstLoginTime).getTime()) < 3600000
          : false;
        
        const hasAnyActivity = hasActivity || hasActivityLogs;
        const lastActiveTime = employeeLastActive.get(emp.id);
        const lastActive = lastActiveTime
          ? new Date(lastActiveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'N/A';

        const isOffline = lastActiveTime 
          ? (Date.now() - new Date(lastActiveTime).getTime()) > 5 * 60 * 1000 // 5 mins
          : false;

        const status: EmployeeOverview['status'] = (!latestSession || latestSession.day_finished)
          ? 'offline'
          : isOffline
          ? 'offline'
          : (hasAnyActivity || isRecentPunchIn)
          ? 'online'
          : 'idle';

        return {
          id: emp.id,
          name: emp.employee_name,
          department: 'Unknown',
          status,
          lastSync: firstLoginTime
            ? new Date(firstLoginTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'N/A',
          lastActive,
          lastIdleReason: employeeLastIdleReason.get(emp.id),
        };
      });

      setEmployees(updatedEmployees);
      setSessions(rawSessions);
      setActivityLogs(rawActivityLogs);

      if (!initialSelectionDone && updatedEmployees.length > 0) {
        setSelectedEmployee(updatedEmployees[0]);
        setInitialSelectionDone(true);
      }
    };

    loadEmployeeList();
    const interval = setInterval(loadEmployeeList, 30000);
    return () => clearInterval(interval);
  }, [selectedDate, initialSelectionDone]);

  /* ── Activity logs (5 s) ── */
  useEffect(() => {
    const loadActivityLogs = async () => {
      const dateString = format(selectedDate, 'yyyy-MM-dd');
      const rawActivityLogs = await fetchActivityLogsByDate(dateString);
      setActivityLogs(rawActivityLogs);

      if (selectedEmployee) {
        const fetchedLockLogs = await getTimesheetLockLogsByDate(selectedEmployee.id, dateString);
        setLockLogs(fetchedLockLogs);
      } else {
        setLockLogs([]);
      }
    };
    loadActivityLogs();
    const interval = setInterval(loadActivityLogs, 5000);
    return () => clearInterval(interval);
  }, [selectedDate]);

  /* ── Mobile call logs & Field Locations (30 s) ── */
  useEffect(() => {
    if (!selectedEmployee) return;

    const loadMobileData = async () => {
      try {
        setCallLogsLoading(true);
        const dateString = format(selectedDate, 'yyyy-MM-dd');
        const [logs, stats, locations] = await Promise.all([
          getCallLogsByDate(selectedEmployee.id, dateString),
          getCallStatsByDate(selectedEmployee.id, dateString),
          getFieldLocationsByDate(selectedEmployee.id, dateString),
        ]);
        setCallLogs(logs);
        setCallStats(stats);
        setFieldLocations(locations);
      } catch (err) {
        console.error('[MonitoringDashboard] Error loading mobile data:', err);
      } finally {
        setCallLogsLoading(false);
      }
    };

    loadMobileData();
    const interval = setInterval(loadMobileData, 30000);
    return () => clearInterval(interval);
  }, [selectedEmployee, selectedDate]);

  /* ── selectedSession ── */
  useEffect(() => {
    if (!selectedEmployee || sessions.length === 0) { setSelectedSession(null); return; }
    const employeeSessions = sessions.filter((s) => s.employee_id === selectedEmployee.id);
    if (!employeeSessions.length) { setSelectedSession(null); return; }
    const firstSession = employeeSessions.reduce((earliest, current) => {
      const et = earliest.punch_in_time ? new Date(earliest.punch_in_time).getTime() : Infinity;
      const ct = current.punch_in_time  ? new Date(current.punch_in_time).getTime()  : Infinity;
      if (et === Infinity) return current;
      if (ct === Infinity) return earliest;
      return ct < et ? current : earliest;
    });
    setSelectedSession(firstSession);
  }, [selectedEmployee, sessions]);

  /* ── Keep selectedEmployee in sync with live employees list ── */
  useEffect(() => {
    if (selectedEmployee && employees.length > 0) {
      const updated = employees.find((e) => e.id === selectedEmployee.id);
      if (updated && (
        updated.lastSync   !== selectedEmployee.lastSync   ||
        updated.lastActive !== selectedEmployee.lastActive ||
        updated.status     !== selectedEmployee.status
      )) setSelectedEmployee(updated);
    }
  }, [employees, selectedEmployee]);

  /* ── Activity data + screenshots ── */
  useEffect(() => {
    if (!selectedEmployee) return;
    let cancelled = false;

    // Immediately compute and apply non-async data so metrics update instantly
    const employeeSessions = sessions.filter((s) => s.employee_id === selectedEmployee.id);
    const selectedLogs     = activityLogs.filter((l) => l.employee_id === selectedEmployee.id);
    const currentApp       = selectedLogs.length > 0 ? selectedLogs[0].app_name : 'Unknown';

    // Calculate max times because the db may have multiple cumulative snapshots per day
    const productiveTime   = employeeSessions.length > 0 ? Math.max(0, ...employeeSessions.map(s => s.productive_seconds ?? 0)) : 0;
    const activeTime       = employeeSessions.length > 0 ? Math.max(0, ...employeeSessions.map(s => s.active_seconds ?? 0)) : 0;
    const idleTime         = employeeSessions.length > 0 ? Math.max(0, ...employeeSessions.map(s => s.idle_seconds ?? 0)) : 0;
    const productivity     = activeTime > 0 ? Math.round((productiveTime / activeTime) * 100) : 0;
    const sessionStartTime = selectedSession?.started_work_time ?? new Date().toLocaleTimeString();

    const buildLogDetails = (log: ActivityLog) => {
      if (log.activity_type === 'idle_reason') return log.idle_reason || 'Idle reason provided';
      const appName     = log.app_name     || 'Unknown';
      const windowTitle = log.window_title || 'No title';
      const website     = log.website      || '';
      const isBrowser   = ['chrome','edge','firefox'].some((b) => appName.toLowerCase().includes(b));
      if (isBrowser && website.trim()) {
        let d = `${appName} • ${website}`;
        if (windowTitle && !windowTitle.toLowerCase().includes(website.toLowerCase()) && windowTitle !== 'No title')
          d += ` (${windowTitle})`;
        return d;
      }
      return website ? `${appName} • ${website} (${windowTitle})` : `${appName} • ${windowTitle}`;
    };

    const mappedLogs = selectedLogs
      .sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime())
      .map((log) => ({
        timestamp: new Date(log.logged_at).toLocaleTimeString(),
        loggedAt: log.logged_at,
        type: log.activity_type,
        details: buildLogDetails(log),
        durationSeconds: log.duration_seconds,
      }));

    // Update all non-screenshot data immediately — no async wait
    setActivityData((prev) => ({
      ...prev,
      activeTime,
      productiveTime,
      nonproductiveTime: Math.max(0, activeTime - productiveTime),
      idleTime,
      awayTime: 0,
      productivity,
      currentApp,
      sessionStartTime,
      activityLogs: mappedLogs,
      screenshots: [], // clear stale screenshots from previous employee
    }));

    if (selectedSession?.punch_in_time) {
      const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
      let diff = 0;
      if (isToday && selectedSession.punched_in) {
        diff = Date.now() - new Date(selectedSession.punch_in_time).getTime();
      } else {
        diff = (activeTime + idleTime) * 1000;
      }
      const hours = Math.floor(diff / 3600000);
      const mins  = Math.floor((diff % 3600000) / 60000);
      setSessionDuration(`${hours}h ${mins}m`);
    } else {
      setSessionDuration('0h 0m');
    }

    const loadScreenshots = async () => {
      setScreenshotsLoading(true);
      setScreenshotError('');
      try {
        const dateString  = format(selectedDate, 'yyyy-MM-dd');
        
        const remoteShots = await getEmployeeScreenshotsByDate(selectedEmployee.id, dateString).catch(e => {
          console.error('Error fetching screenshots:', e);
          return [];
        });
        
        const alerts = await fetchIdleAlertsByDate(selectedEmployee.id, dateString).catch(e => {
          console.error('Error fetching idle alerts:', e);
          return [];
        });
        
        setIdleAlerts(alerts);

        if (!cancelled) {
          setActivityData({
            activeTime,
            productiveTime,
            nonproductiveTime: Math.max(0, activeTime - productiveTime),
            idleTime,
            awayTime: 0,
            productivity,
            currentApp,
            sessionStartTime,
            screenshots: remoteShots.map((s: any) => ({
              timestamp: new Date(s.captured_at).toLocaleTimeString(),
              url:       normalizeScreenshotUrl(s.screenshot_data),
              appName:   s.app_name,
            })),
            activityLogs: mappedLogs,
          });
        }
      } catch (error) {
        console.error('Error loading data:', error);
        if (!cancelled) {
          setScreenshotError('Unable to load data at this time.');
          setActivityData((prev) => ({
            ...prev,
            activeTime,
            productiveTime,
            nonproductiveTime: Math.max(0, activeTime - productiveTime),
            idleTime,
            awayTime: 0,
            productivity,
            currentApp,
            sessionStartTime,
            activityLogs: mappedLogs,
          }));
        }
      } finally {
        if (!cancelled) setScreenshotsLoading(false);
      }
    };

    loadScreenshots();

    return () => { cancelled = true; };
  }, [selectedEmployee, sessions, activityLogs, selectedSession, selectedDate]);

  /* ── Formatters ── */
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const summaryTitle = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
    ? "Today's summary"
    : `Summary for ${format(selectedDate, 'MMM d, yyyy')}`;

  /* ─────────────────────── RENDER ─────────────────────────────── */
  return (
    <div className="min-h-screen bg-slate-50 font-sans">

      {/* ── Top navigation bar ── */}
      <header className="bg-white border-b border-slate-100 shadow-sm sticky top-0 z-20">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-800 tracking-tight">WorkPulse</span>
            <span className="text-slate-300 text-xs mx-1">|</span>
            <span className="text-xs text-slate-400 font-medium">Employee Monitoring</span>
          </div>

          {/* Status pills */}
          <div className="hidden md:flex items-center gap-2">
            {[
              { label: 'Online',  count: employees.filter(e => e.status === 'online').length,  dot: 'bg-emerald-400' },
              { label: 'Idle',    count: employees.filter(e => e.status === 'idle').length,    dot: 'bg-amber-400' },
              { label: 'Offline', count: employees.filter(e => e.status === 'offline').length, dot: 'bg-slate-300' },
              { label: 'Total',   count: employees.length,                                     dot: 'bg-blue-400' },
            ].map(({ label, count, dot }) => (
              <div key={label} className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-full px-3 py-1 text-xs text-slate-600">
                <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                <span className="font-semibold text-slate-800">{count}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {/* Date picker */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <DatePicker
              selected={selectedDate}
              onChange={(date: Date | null) => date && setSelectedDate(date)}
              className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none w-24 cursor-pointer"
              dateFormat="MMM d, yyyy"
              maxDate={new Date()}
            />
          </div>
        </div>
      </header>

      <div className="max-w-screen-2xl mx-auto px-6 py-5 flex gap-5" style={{ minHeight: 'calc(100vh - 56px)' }}>

        {/* ── Sidebar ── */}
        <aside className="w-60 flex-shrink-0 flex flex-col gap-3">

          {/* Employee list */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 100px)' }}>
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Team members</p>
            </div>
            <div className="overflow-y-auto flex-1" style={{ maxHeight: 'calc(100vh - 260px)' }}>
              {employees.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => {
                    if (selectedEmployee?.id === emp.id) return;
                    setTransitioning(true);
                    setSessionDuration('0h 0m');
                    setScreenshotError('');
                    setActivityData({
                      activeTime: 0,
                      productiveTime: 0,
                      nonproductiveTime: 0,
                      idleTime: 0,
                      awayTime: 0,
                      productivity: 0,
                      currentApp: '—',
                      sessionStartTime: '',
                      screenshots: [],
                      activityLogs: [],
                    });
                    setSelectedEmployee(emp);
                    setTimeout(() => setTransitioning(false), 120);
                  }}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-all border-l-2 ${
                    selectedEmployee?.id === emp.id
                      ? 'bg-blue-50 border-l-blue-500'
                      : 'border-l-transparent hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${avatarColor[emp.status]}`}>
                    {emp.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{emp.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot[emp.status]}`} />
                      <span className="text-[10px] text-slate-400 capitalize">{emp.status}</span>
                      {emp.status === 'idle' && emp.lastIdleReason && (
                        <span className="text-[9px] text-amber-600 truncate ml-1 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 max-w-[120px]">
                          {emp.lastIdleReason}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-slate-300">Login:</span>
                      <span className="text-[10px] text-slate-500 font-medium">{emp.lastSync}</span>
                      {emp.lastActive && emp.lastActive !== 'N/A' && (
                        <>
                          <span className="text-[10px] text-slate-300">·</span>
                          <span className="text-[10px] text-slate-500 font-medium">{emp.lastActive}</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main
          className={`flex-1 min-w-0 flex flex-col gap-4 transition-all duration-150 ${
            transitioning ? 'opacity-0 scale-[0.99]' : 'opacity-100 scale-100'
          }`}
        >
          {selectedEmployee ? (
            <>
              {/* Employee header */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-4 flex items-center gap-5">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold flex-shrink-0 ${avatarColor[selectedEmployee.status]}`}>
                  {selectedEmployee.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-900">{selectedEmployee.name}</h2>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${statusBadge[selectedEmployee.status]}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusDot[selectedEmployee.status]}`} />
                      {selectedEmployee.status === 'online' ? 'Working' : selectedEmployee.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 mt-0.5">{selectedEmployee.department}</p>
                </div>
                <div className="flex items-center gap-6 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-[11px] text-slate-400 font-medium">Login time</p>
                    <p className="text-sm font-bold text-slate-800 mt-0.5">{selectedEmployee.lastSync}</p>
                  </div>
                  <div className="text-right border-l border-slate-100 pl-6">
                    <p className="text-[11px] text-slate-400 font-medium">Last active</p>
                    <p className="text-sm font-bold text-slate-800 mt-0.5">{selectedEmployee.lastActive || 'N/A'}</p>
                  </div>
                  <div className="text-right border-l border-slate-100 pl-6">
                    <p className="text-[11px] text-slate-400 font-medium">Session</p>
                    <p className="text-sm font-bold text-slate-800 mt-0.5">{sessionDuration}</p>
                  </div>
                  <div className="text-right border-l border-slate-100 pl-6">
                    <p className="text-[11px] text-slate-400 font-medium">Current app</p>
                    <p className="text-sm font-bold text-slate-800 mt-0.5 truncate max-w-[100px]">{activityData.currentApp}</p>
                  </div>
                </div>
              </div>

              {/* Metrics row */}
              {!hideTabs && (
                <>
                  <div className="grid grid-cols-6 gap-3">
                    {[
                      { label: 'Active Time',     value: formatTime(activityData.activeTime),       cls: metricColor.active },
                      { label: 'Productive',      value: formatTime(activityData.productiveTime),   cls: metricColor.productive },
                      { label: 'Non-Productive',  value: formatTime(activityData.nonproductiveTime),cls: metricColor.nonproductive },
                      { label: 'Idle Time',       value: formatTime(activityData.idleTime),         cls: metricColor.idle },
                      { label: 'Away Time',       value: formatTime(activityData.awayTime),         cls: metricColor.away },
                      { label: 'Productivity',    value: `${activityData.productivity}%`,           cls: metricColor.productivity },
                    ].map(({ label, value, cls }) => (
                      <MetricPill key={label} label={label} value={value} colorClass={cls} />
                    ))}
                  </div>

                  {/* Summary section */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-4">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{summaryTitle}</p>
                <div className="grid grid-cols-5 gap-4">
                  {[
                    {
                      label: 'First login',
                      value: selectedSession?.started_work_time
                        ? new Date(selectedSession.started_work_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : 'N/A',
                    },
                    { label: 'Last active',    value: selectedEmployee.lastActive || 'N/A' },
                    { label: 'Total active',   value: formatTime(activityData.activeTime) },
                    {
                      label: 'Status',
                      value: selectedEmployee.status,
                      valueClass: selectedEmployee.status === 'online' ? 'text-emerald-600' : 'text-slate-500',
                    },
                    { label: 'Current app', value: activityData.currentApp },
                  ].map(({ label, value, valueClass }) => (
                    <div key={label}>
                      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide mb-1">{label}</p>
                      <p className={`text-sm font-semibold capitalize ${valueClass || 'text-slate-800'}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
              </>
              )}

              {/* Tabs */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col flex-1 overflow-hidden">
                {/* Tab bar */}
                {!hideTabs && (
                  <div className="flex border-b border-slate-100 px-2 gap-0">
                    {([
                      { id: 'activity',     label: 'Activity',      Icon: Activity },
                      { id: 'applications', label: 'Applications',  Icon: Zap },
                      { id: 'screenshots',  label: 'Screenshots',   Icon: Eye },
                      { id: 'alerts',       label: 'Alerts & Warnings',   Icon: AlertCircle },
                      { id: 'logs',         label: 'Call Logs',     Icon: Phone },
                      { id: 'locations',    label: 'Locations',     Icon: MapPin },
                    ] as const).map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        onClick={() => setActiveTab(id)}
                        className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
                          activeTab === id
                            ? 'text-blue-600 border-blue-500'
                            : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto p-5" style={{ maxHeight: '420px' }}>

                  {/* Activity */}
                  {activeTab === 'activity' && (
                    activityData.activityLogs.length > 0 ? (
                      <div className="space-y-0 divide-y divide-slate-50">
                        {activityData.activityLogs.map((log, idx) => (
                          <div
                            key={idx}
                            className={`flex gap-3 py-2.5 ${log.type === 'idle_reason' ? 'bg-amber-50/60 px-3 rounded-xl -mx-3' : ''}`}
                          >
                            <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${log.type === 'idle_reason' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                            <div className="flex-1 min-w-0">
                              {log.type === 'idle_reason' ? (
                                <div>
                                  <p className="text-xs font-semibold text-amber-800">
                                    <span className="inline-block bg-amber-100 text-amber-600 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded mr-2 align-middle">Alert</span>
                                    {log.details}
                                  </p>
                                  {log.durationSeconds !== undefined && log.durationSeconds > 0 && (
                                    <div className="mt-1 flex items-center gap-3 text-[10px] text-amber-700/80">
                                      <span><span className="font-semibold text-amber-700">Start:</span> {
                                        new Date(new Date(log.loggedAt).getTime() - log.durationSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                      }</span>
                                      <span><span className="font-semibold text-amber-700">End:</span> {log.timestamp}</span>
                                      <span><span className="font-semibold text-amber-700">Duration:</span> {Math.floor(log.durationSeconds / 60)}m {log.durationSeconds % 60}s</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs font-medium text-slate-700 truncate">{log.details}</p>
                              )}
                              <p className="text-[10px] text-slate-400 mt-0.5">{log.timestamp}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-slate-300">
                        <Activity className="w-10 h-10 mb-2" />
                        <p className="text-sm font-medium">No activity logs yet</p>
                        <p className="text-xs mt-1">Agent sends data every 30 seconds</p>
                      </div>
                    )
                  )}

                  {/* Applications */}
                  {activeTab === 'applications' && (
                    activityData.activityLogs.length > 0 ? (
                      <div>
                        {(() => {
                          const appUsage = new Map<string, number>();
                          activityData.activityLogs.forEach((log) => {
                            if (log.type === 'idle_reason') return;
                            const appName = log.details.includes('•') ? log.details.split(' • ')[0].trim() : log.details.split(' (')[0].trim();
                            if (appName && appName !== 'Unknown') {
                              const duration = log.durationSeconds || 0;
                              appUsage.set(appName, (appUsage.get(appName) || 0) + duration);
                            }
                          });
                          const sortedApps = Array.from(appUsage.entries()).sort((a, b) => b[1] - a[1]);
                          
                          return (
                            <>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
                                {sortedApps.map(([appName, durationSeconds]) => (
                                  <div key={appName} className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                                    <p className="text-xs font-semibold text-slate-800 truncate">{appName}</p>
                                    <p className="text-[10px] text-blue-600 font-bold mt-1 tracking-wide">
                                      {formatTime(durationSeconds)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Detailed App Usage logs</p>
                              <div className="divide-y divide-slate-50">
                                {activityData.activityLogs.filter(l => l.type !== 'idle_reason').map((log, idx) => {
                                  const appName = log.details.includes('•') ? log.details.split(' • ')[0].trim() : log.details.split(' (')[0].trim();
                                  return (
                                    <div key={idx} className="flex items-center justify-between py-2 text-xs">
                                      <div className="flex flex-col min-w-0">
                                        <span className="text-slate-700 font-medium truncate">{appName}</span>
                                        {log.durationSeconds !== undefined && log.durationSeconds > 0 && (
                                          <span className="text-[10px] text-slate-400 mt-0.5">{Math.floor(log.durationSeconds / 60)}m {log.durationSeconds % 60}s</span>
                                        )}
                                      </div>
                                      <span className="text-slate-400 flex-shrink-0 ml-3">{log.timestamp}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-slate-300">
                        <Zap className="w-10 h-10 mb-2" />
                        <p className="text-sm font-medium">No applications recorded yet</p>
                      </div>
                    )
                  )}

                  {/* Screenshots */}
                  {activeTab === 'screenshots' && (
                    screenshotsLoading ? (
                      <div className="flex flex-col items-center justify-center h-48 gap-3">
                        <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-xs text-slate-400">Loading screenshots…</p>
                      </div>
                    ) : screenshotError ? (
                      <div className="flex flex-col items-center justify-center h-48 text-rose-400 gap-2">
                        <AlertCircle className="w-8 h-8" />
                        <p className="text-sm font-medium">{screenshotError}</p>
                      </div>
                    ) : activityData.screenshots.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {activityData.screenshots.map((shot, idx) => (
                          <ScreenshotCard key={idx} shot={shot} />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-slate-300">
                        <Eye className="w-10 h-10 mb-2" />
                        <p className="text-sm font-medium">No screenshots captured yet</p>
                      </div>
                    )
                  )}

                  {/* Alerts & Warnings */}
                  {activeTab === 'alerts' && (
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                        <h3 className="font-semibold text-slate-800">Idle Alerts</h3>
                        <span className="text-xs font-medium text-slate-500 bg-white px-2.5 py-1 rounded-full border border-slate-200 shadow-sm">
                          {idleAlerts.length} Alerts
                        </span>
                      </div>
                      {idleAlerts.length === 0 ? (
                        <div className="p-12 text-center">
                          <AlertCircle className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                          <p className="text-slate-500 font-medium">No idle alerts</p>
                          <p className="text-slate-400 text-sm mt-1">No alerts were recorded on this date.</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                          {idleAlerts.map((alert: any) => (
                            <div key={alert.id} className="p-4 hover:bg-slate-50 transition-colors">
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200/50">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Idle Alert
                                  </span>
                                </div>
                                <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                                  {format(new Date(alert.idle_since || alert.created_at || new Date()), 'h:mm a')}
                                </span>
                              </div>
                              <div className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
                                <p className="text-sm font-semibold text-slate-700 mb-1">
                                  {alert.reason}
                                </p>
                                <div className="flex items-center justify-between text-xs text-slate-500 mt-2 pt-2 border-t border-slate-50">
                                  <span>Status: {alert.response}</span>
                                  {alert.description && alert.description !== alert.reason && (
                                    <span className="truncate max-w-[200px]">{alert.description}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {lockLogs.length > 0 && (
                        <div className="px-5 pb-5">
                          <div className="mt-6 pt-6 border-t border-slate-100">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">Timesheet Lock & Warning Events</h4>
                            <div className="divide-y divide-slate-50">
                              {lockLogs.map((lockLog) => (
                                <div key={lockLog.id} className="flex gap-3 py-2.5">
                                  <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${
                                    lockLog.event_type === 'LOCKED' ? 'bg-red-500' :
                                    lockLog.event_type === 'WARNING' ? 'bg-amber-400' : 'bg-blue-400'
                                  }`} />
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-xs font-semibold ${
                                      lockLog.event_type === 'LOCKED' ? 'text-red-800' :
                                      lockLog.event_type === 'WARNING' ? 'text-amber-800' : 'text-blue-800'
                                    }`}>
                                      <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded mr-2 align-middle ${
                                        lockLog.event_type === 'LOCKED' ? 'bg-red-100 text-red-600' :
                                        lockLog.event_type === 'WARNING' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'
                                      }`}>
                                        {lockLog.event_type}
                                      </span>
                                      {lockLog.reason || 'Timesheet Action'}
                                    </p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">
                                      {new Date(lockLog.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      {lockLog.admin_name && ` by ${lockLog.admin_name}`}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Call Logs */}
                  {activeTab === 'logs' && (
                    callLogsLoading ? (
                      <div className="flex flex-col items-center justify-center h-48">
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
                        <p className="text-xs text-slate-400">Loading mobile call logs...</p>
                      </div>
                    ) : callLogs.length > 0 ? (
                      <div>
                        {/* Call Stats */}
                        {callStats && (
                          <div className="grid grid-cols-4 gap-3 mb-4 pb-4 border-b border-slate-100">
                            <div className="bg-slate-50 rounded-lg p-3">
                              <p className="text-[10px] text-slate-500 font-semibold mb-1">Total Calls</p>
                              <p className="text-lg font-bold text-slate-900">{callStats.totalCalls}</p>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-3">
                              <p className="text-[10px] text-blue-600 font-semibold mb-1">Incoming</p>
                              <p className="text-lg font-bold text-blue-600">{callStats.incoming}</p>
                            </div>
                            <div className="bg-green-50 rounded-lg p-3">
                              <p className="text-[10px] text-green-600 font-semibold mb-1">Outgoing</p>
                              <p className="text-lg font-bold text-green-600">{callStats.outgoing}</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-3">
                              <p className="text-[10px] text-slate-500 font-semibold mb-1">Duration</p>
                              <p className="text-lg font-bold text-slate-900">{formatDuration(callStats.totalDuration)}</p>
                            </div>
                          </div>
                        )}
                        {/* Call List */}
                        <div className="divide-y divide-slate-100 space-y-0">
                          {callLogs.slice(0, 15).map((log) => (
                            <div key={log.id} className="flex items-center gap-3 py-2.5">
                              {log.call_type === 'incoming' ? (
                                <PhoneIncoming className="w-4 h-4 text-blue-500 flex-shrink-0" />
                              ) : log.call_type === 'outgoing' ? (
                                <Phone className="w-4 h-4 text-green-500 flex-shrink-0" />
                              ) : (
                                <PhoneOff className="w-4 h-4 text-red-500 flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-slate-900 truncate">
                                  {log.contact_name || log.phone_number || 'Unknown'}
                                </p>
                                <p className="text-[10px] text-slate-500 mt-0.5">
                                  {log.call_type.charAt(0).toUpperCase() + log.call_type.slice(1)} •{' '}
                                  {new Date(log.call_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-xs font-semibold text-slate-700">{formatDuration(log.duration_seconds)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-slate-300">
                        <Phone className="w-10 h-10 mb-2" />
                        <p className="text-sm font-medium">No mobile call logs today</p>
                      </div>
                    )
                  )}

                  {/* Locations */}
                  {activeTab === 'locations' && (
                    callLogsLoading ? (
                      <div className="flex flex-col items-center justify-center h-48">
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
                        <p className="text-xs text-slate-400">Loading locations...</p>
                      </div>
                    ) : fieldLocations.length > 0 ? (
                      <div className="divide-y divide-slate-100 space-y-0">
                        {fieldLocations.map((loc) => (
                          <div key={loc.id} className="flex items-center gap-3 py-2.5">
                            <MapPin className="w-4 h-4 text-blue-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-slate-900 truncate">
                                {new Date(loc.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                Lat: {loc.lat.toFixed(6)} • Lng: {loc.lng.toFixed(6)} • Acc: {Math.round(loc.accuracy || 0)}m
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <a 
                                href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition-colors font-medium"
                              >
                                View Map
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-48 text-slate-300">
                        <MapPin className="w-10 h-10 mb-2" />
                        <p className="text-sm font-medium">No locations recorded for this day</p>
                      </div>
                    )
                  )}

                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white rounded-2xl border border-slate-100 shadow-sm">
              <div className="text-center text-slate-300">
                <Users className="w-14 h-14 mx-auto mb-3" />
                <p className="text-base font-semibold">Select an employee to view details</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default MonitoringDashboard;
