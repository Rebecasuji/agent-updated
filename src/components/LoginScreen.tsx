import { useState, useEffect, FormEvent } from 'react';
import { LogIn, User, Hash, Lock, Loader2, Apple } from 'lucide-react';
import { Employee, WorkSession, loginEmployee, getTodaySession } from '../lib/supabase';
import WindowControls from './WindowControls';

interface LoginScreenProps {
  onLogin: (employee: Employee, session: WorkSession) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [employeeCode, setEmployeeCode] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [platform, setPlatform] = useState<'windows' | 'macos' | 'unknown'>('unknown');

  // Load saved credentials on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('knockturn_login');
      if (saved) {
        const { code, name, password: pwd } = JSON.parse(saved);
        setEmployeeCode(code);
        setEmployeeName(name);
        setPassword(pwd);
        setRememberMe(true);
      }
    } catch (err) {
      console.error('Failed to load saved credentials:', err);
    }
  }, []);

  // Detect platform (Windows vs macOS)
  useEffect(() => {
    const detectPlatform = async () => {
      try {
        const api = (window as any).electronAPI;
        if (api?.invoke) {
          // Running in Electron - check platform
          try {
            const result = await api.invoke('get-platform');
            if (result === 'darwin') {
              setPlatform('macos');
            } else if (result === 'win32') {
              setPlatform('windows');
            }
          } catch {
            // If invoke fails, check process.platform via preload
            const platformFromPreload = (window as any).__PLATFORM__;
            if (platformFromPreload === 'darwin') {
              setPlatform('macos');
            } else if (platformFromPreload === 'win32') {
              setPlatform('windows');
            }
          }
        } else {
          // Not in Electron, try to detect from navigator
          if (navigator.userAgent.includes('Macintosh')) {
            setPlatform('macos');
          } else if (navigator.userAgent.includes('Windows')) {
            setPlatform('windows');
          }
        }
      } catch (err) {
        console.error('Failed to detect platform:', err);
      }
    };

    detectPlatform();
  }, []);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!employeeCode.trim() || !password.trim()) {
      setError('Employee code and password are required.');
      return;
    }
    setLoading(true);
    try {
      console.log('[Login] Attempting login for:', employeeCode);
      const { employee, error } = await loginEmployee(
        employeeCode,
        employeeName,
        password
      );

      if (error) {
        console.error('[Login] Auth error:', error);
        setError('Login failed. Please check your credentials or try again.');
        return;
      }

      if (!employee) {
        console.error('[Login] No employee found');
        setError('Invalid credentials or user not found. Please check your details.');
        return;
      }

      console.log('[Login] Employee found:', employee.employee_code);
      const session = await getTodaySession(employee.id);
      if (!session) {
        console.error('[Login] Failed to create/fetch session');
        setError('Failed to load your session. Please try again.');
        return;
      }

      console.log('[Login] Session created/fetched:', session.id, 'started_work_time:', session.started_work_time);

      // Check if the day has already been finished
      if (session.day_finished) {
        console.warn('[Login] Day already finished for this employee');
        setError('Your work day has already been finished. You cannot resume. Please contact your administrator if you need to continue working.');
        return;
      }

      // Initialize Electron session counters with values from database
      try {
        const api = (window as any).electronAPI;
        // Calculate elapsed time from started_work_time to now
        const elapsedSeconds = session.started_work_time
          ? Math.floor((Date.now() - new Date(session.started_work_time).getTime()) / 1000)
          : 0;
        
        if (api?.invoke) {
          const counters = {
            activeSeconds: session.active_seconds || 0,
            idleSeconds: session.idle_seconds || 0,
            productiveSeconds: session.productive_seconds || 0,
            sessionSeconds: (session.active_seconds || 0) + (session.idle_seconds || 0),
          };
          console.log('[Login] Initializing Electron session counters:', counters);
          await api.invoke('initialize-session-counters', counters.activeSeconds, counters.idleSeconds, counters.productiveSeconds, counters.sessionSeconds);
        } else {
          // Fallback to local server endpoint
          const response = await fetch('http://127.0.0.1:5014/initialize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              activeSeconds: session.active_seconds || 0,
              idleSeconds: session.idle_seconds || 0,
              productiveSeconds: session.productive_seconds || 0,
              sessionSeconds: (session.active_seconds || 0) + (session.idle_seconds || 0),
            }),
          });
          if (response.ok) {
            console.log('[Login] Session counters initialized via local server');
          }
        }
      } catch (err) {
        console.error('[Login] Error initializing session counters:', err);
      }

      console.log('[Login] Session created/fetched:', session.id);
      
      // Save credentials if "Remember Me" is checked
      if (rememberMe) {
        try {
          localStorage.setItem('knockturn_login', JSON.stringify({
            code: employeeCode,
            name: employeeName,
            password: password
          }));
        } catch (err) {
          console.error('Failed to save credentials:', err);
        }
      } else {
        // Clear saved credentials if not checked
        try {
          localStorage.removeItem('knockturn_login');
        } catch (err) {
          console.error('Failed to clear credentials:', err);
        }
      }
      
      onLogin(employee, session);
    } catch (err) {
      console.error('[Login] Exception:', err);
      setError('Login error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-white flex items-center justify-center p-4">
      {/* Background pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-pink-100 rounded-full opacity-50 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-rose-100 rounded-full opacity-50 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-pink-400 to-rose-500 rounded-2xl shadow-lg mb-4">
            <User className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 tracking-tight">Knockturn</h1>
          <p className="text-pink-500 font-medium mt-1">Employee Productivity Agent</p>
          
          {/* Platform Badge */}
          {platform !== 'unknown' && (
            <div className="mt-3 inline-flex items-center gap-1.5">
              {platform === 'macos' ? (
                <div className="px-3 py-1 bg-blue-50 border border-blue-200 rounded-full text-xs font-semibold text-blue-700 flex items-center gap-1">
                  <Apple className="w-3.5 h-3.5" />
                  macOS Version
                </div>
              ) : (
                <div className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-full text-xs font-semibold text-slate-700">
                  Windows Version
                </div>
              )}
            </div>
          )}
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl border border-pink-100 p-8">
          <h2 className="text-xl font-semibold text-gray-700 mb-6">Sign In to Your Account</h2>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Employee Code */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">Employee Code</label>
              <div className="relative">
                <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pink-400" />
                <input
                  type="text"
                  value={employeeCode}
                  onChange={e => setEmployeeCode(e.target.value)}
                  placeholder="e.g. EMP001"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-pink-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none transition text-gray-700 bg-rose-50/40 placeholder-gray-400"
                />
              </div>
            </div>

            {/* Employee Name */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">
                Employee Name <span className="text-xs text-gray-400">(optional)</span>
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pink-400" />
                <input
                  type="text"
                  value={employeeName}
                  onChange={e => setEmployeeName(e.target.value)}
                  placeholder="Your full name (optional)"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-pink-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none transition text-gray-700 bg-rose-50/40 placeholder-gray-400"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pink-400" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-pink-200 focus:border-pink-400 focus:ring-2 focus:ring-pink-100 outline-none transition text-gray-700 bg-rose-50/40 placeholder-gray-400"
                />
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember-me"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-pink-200 text-pink-500 focus:ring-pink-200 cursor-pointer"
              />
              <label htmlFor="remember-me" className="text-sm text-gray-600 cursor-pointer">
                Remember me on this device
              </label>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-semibold py-3.5 rounded-xl shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <LogIn className="w-5 h-5" />
              )}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          &copy; {new Date().getFullYear()} Knockturn &mdash; Internal Employee Agent
        </p>
      </div>

      {/* Window controls - locked during login (must sign in before closing) */}
      <div className="fixed top-4 right-4 flex flex-col items-end gap-2">
        <WindowControls disabledClose={true} />
      </div>
    </div>
  );
}
