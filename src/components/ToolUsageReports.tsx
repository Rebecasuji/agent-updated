import { useState, useEffect, useRef } from 'react';
import { getToolUsageByDate, EmployeeToolUsage } from '../lib/supabase';
import { Download, FileText, Search, Loader2, RefreshCw, Clock } from 'lucide-react';

// Get today's date in IST as YYYY-MM-DD
function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// Format seconds into readable "Xm Ys"
function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return '0s';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Color badges per app
const APP_COLORS: Record<string, string> = {
  chrome:    'bg-yellow-50 text-yellow-700 border-yellow-200',
  edge:      'bg-blue-50 text-blue-700 border-blue-200',
  firefox:   'bg-orange-50 text-orange-700 border-orange-200',
  brave:     'bg-orange-50 text-orange-800 border-orange-200',
  excel:     'bg-green-50 text-green-700 border-green-200',
  word:      'bg-blue-50 text-blue-700 border-blue-200',
  powerpoint:'bg-red-50 text-red-700 border-red-200',
  teams:     'bg-purple-50 text-purple-700 border-purple-200',
  slack:     'bg-pink-50 text-pink-700 border-pink-200',
  zoom:      'bg-sky-50 text-sky-700 border-sky-200',
  outlook:   'bg-sky-50 text-sky-700 border-sky-200',
  'vs code': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  terminal:  'bg-gray-100 text-gray-700 border-gray-300',
  notepad:   'bg-gray-50 text-gray-600 border-gray-200',
  figma:     'bg-violet-50 text-violet-700 border-violet-200',
};

function getAppBadgeClass(toolName: string): string {
  const lower = toolName.toLowerCase();
  for (const [key, cls] of Object.entries(APP_COLORS)) {
    if (lower.includes(key)) return cls;
  }
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export default function ToolUsageReports() {
  const [logs, setLogs] = useState<EmployeeToolUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState<string>(getTodayIST());
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isToday = date === getTodayIST();

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await getToolUsageByDate(date);
      setLogs(data);
      setLastRefreshed(new Date());
    } finally {
      setLoading(false);
    }
  };

  // Initial load + reload on date change
  useEffect(() => {
    fetchLogs();
  }, [date]);

  // Auto-refresh every 60s when viewing today
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (isToday) {
      autoRefreshRef.current = setInterval(() => {
        fetchLogs();
      }, 60000);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [date]);

  const filteredLogs = logs.filter((log) => {
    const empText = `${log.employee_name || ''} ${log.employee_code || ''}`.toLowerCase();
    const matchEmp  = !employeeFilter || empText.includes(employeeFilter.toLowerCase());
    const matchTool = !toolFilter || (log.tool_name || '').toLowerCase().includes(toolFilter.toLowerCase());
    return matchEmp && matchTool;
  });

  // Summary stats
  const totalDuration  = filteredLogs.reduce((a, l) => a + (l.total_duration_seconds || 0), 0);
  const uniqueTools     = [...new Set(filteredLogs.map(l => l.tool_name))].length;
  const uniqueEmployees = [...new Set(filteredLogs.map(l => l.employee_code).filter(Boolean))].length;

  const exportCSV = () => {
    if (filteredLogs.length === 0) return;
    const headers = ['Employee Name', 'Employee Code', 'Tool/App', 'File / Window Title', 'Website', 'Start Time', 'End Time', 'Total Duration', 'Active Duration'];
    const rows = filteredLogs.map(l => [
      l.employee_name || 'N/A',
      l.employee_code || 'N/A',
      l.tool_name,
      l.file_name  || 'N/A',
      l.website    || 'N/A',
      new Date(l.start_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      l.end_time ? new Date(l.end_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Active',
      formatDuration(l.total_duration_seconds),
      formatDuration(l.active_duration_seconds),
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(x => `"${x}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Tool_Usage_Report_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tool & Application Usage</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Live tracking of which apps and tools each employee uses
            {isToday && (
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                Live — auto-refreshes every 60s
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-600 px-3 py-2 rounded-lg transition-colors text-sm disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
          >
            <Download size={16} /> Export CSV (Excel)
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
          >
            <FileText size={16} /> Export PDF
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      {filteredLogs.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Sessions',   value: filteredLogs.length,         color: 'text-indigo-600' },
            { label: 'Employees Active', value: uniqueEmployees,              color: 'text-blue-600' },
            { label: 'Unique Tools',     value: uniqueTools,                  color: 'text-violet-600' },
            { label: 'Total Duration',   value: formatDuration(totalDuration), color: 'text-emerald-600' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{stat.label}</p>
              <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Employee</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Name or code..."
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              className="pl-8 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 w-48"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tool/App</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="e.g. Chrome, Excel..."
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="pl-8 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 w-48"
            />
          </div>
        </div>
        {(employeeFilter || toolFilter) && (
          <button
            onClick={() => { setEmployeeFilter(''); setToolFilter(''); }}
            className="text-xs text-red-500 hover:text-red-700 underline self-end pb-2"
          >
            Clear filters
          </button>
        )}
        {lastRefreshed && (
          <div className="ml-auto self-end pb-2 flex items-center gap-1 text-xs text-gray-400">
            <Clock size={12} />
            Last updated: {lastRefreshed.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden print-area">
        {loading && logs.length === 0 ? (
          <div className="p-12 flex flex-col justify-center items-center gap-3 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            <span className="text-sm">Loading live activity data...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-gray-600">No activity data found</p>
            <p className="text-sm mt-1">
              {date === getTodayIST()
                ? 'Employees must be logged into the Knockturn Agent and actively working.'
                : 'No data recorded for this date.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200 uppercase tracking-wider">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Tool / App</th>
                  <th className="px-4 py-3 font-semibold">File / Website</th>
                  <th className="px-4 py-3 font-semibold">Start Time</th>
                  <th className="px-4 py-3 font-semibold">End Time</th>
                  <th className="px-4 py-3 font-semibold">Duration</th>
                  <th className="px-4 py-3 font-semibold">Active Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900 text-sm">{log.employee_name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{log.employee_code || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold border ${getAppBadgeClass(log.tool_name)}`}>
                        {log.tool_name}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[240px]">
                      {log.website ? (
                        <span className="text-sm text-indigo-600 font-medium flex items-center gap-1 truncate" title={log.website}>
                          🌐 {log.website}
                        </span>
                      ) : log.file_name ? (
                        <span className="text-sm text-gray-600 truncate block" title={log.file_name}>
                          📄 {log.file_name}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {new Date(log.start_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {log.end_time
                        ? new Date(log.end_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : <span className="text-xs text-amber-500 font-semibold">● Active</span>}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-800">
                      {formatDuration(log.total_duration_seconds)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-semibold text-emerald-600">
                        {formatDuration(log.active_duration_seconds)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredLogs.length >= 500 && (
              <div className="px-4 py-3 text-xs text-center text-gray-400 border-t border-gray-100">
                Showing top 500 records. Use filters to narrow down results.
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @media print {
          body > * { display: none !important; }
          .print-area { display: block !important; position: static !important; width: 100% !important; }
        }
      `}</style>
    </div>
  );
}
