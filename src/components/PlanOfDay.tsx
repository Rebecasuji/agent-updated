import { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, ExternalLink, Lock } from 'lucide-react';
import { Employee, WorkSession, getTodaySession, punchInSession, markPlanAsSubmitted } from '../lib/supabase';
import WindowControls from './WindowControls';

type PlanPhase = 'form' | 'summary' | 'punch' | 'punch_no';

interface PlanOfDayProps {
  employee: Employee;
  onComplete: (session: WorkSession) => void;
  windowLocked?: boolean;
  planSubmitted?: boolean;
  summarySubmitted?: boolean;
  punchConfirmed?: boolean;
  onPlanSubmitted?: () => void;
  onSummarySubmitted?: () => void;
  onPunchConfirmed?: () => void;
}

export default function PlanOfDay({
  employee,
  onComplete,
  windowLocked = true,
  onSummarySubmitted,
  onPunchConfirmed,
}: PlanOfDayProps) {
  const [phase, setPhase] = useState<PlanPhase>('form');
  const [summaryError, setSummaryError] = useState('');
  const [loading, setLoading] = useState(false);
  const [portalOpened, setPortalOpened] = useState(false);
  const [punchError, setPunchError] = useState('');
  const [portalUrl, setPortalUrl] = useState('https://timestrap.space/plan-for-day');

  useEffect(() => {
    if (portalOpened) return;
    setPortalOpened(true);
    // Portal is now embedded in an iframe, no need to open in an external browser automatically
  }, [portalOpened]);


  const handleBackClick = () => {
    setSummaryError('');
    setPunchError('');
    setPhase('summary');
  };

  const handleConfirmationYes = async () => {
    setSummaryError('');
    setLoading(true);
    
    // Get debug environment info from main process
    try {
      if (typeof window !== 'undefined' && (window as any).electronAPI?.debugEnv) {
        const envDebug = await (window as any).electronAPI.debugEnv();
        console.log('[PlanOfDay] Debug environment info from main process:');
        console.log(JSON.stringify(envDebug, null, 2));
      }
    } catch (err) {
      console.error('[PlanOfDay] Failed to get debug environment info:', err);
    }

    try {
      const todaySession = await getTodaySession(employee.id);

      if (todaySession && todaySession.plan_submitted) {
        onSummarySubmitted?.();
        console.log('✓ Plan submission verified');
        setPhase('punch');
        return;
      }

      // Fallback: check the remote timesheet DB before rejecting
      let externallySubmitted = false;
      try {
        console.log('[PlanOfDay] Checking electronAPI:', !!(window as any).electronAPI?.checkTimesheetDb);
        if (typeof window !== 'undefined' && (window as any).electronAPI?.checkTimesheetDb) {
          externallySubmitted = await (window as any).electronAPI.checkTimesheetDb(employee.employee_code);
          console.log('[PlanOfDay] externallySubmitted result:', externallySubmitted);
        }
      } catch (e) {
        console.error('[PlanOfDay] Failed to check remote timesheet DB', e);
      }

      if (externallySubmitted) {
        // If external DB shows the plan we should proceed even if local session is missing.
        if (todaySession) {
          try {
            await markPlanAsSubmitted(todaySession.id);
            console.log('✓ Synced plan submission to local database');
          } catch (syncError) {
            console.error('[PlanOfDay] Failed to sync plan submission:', syncError);
            // Continue anyway - external verification is sufficient
          }
        } else {
          console.log('[PlanOfDay] External plan found but no local session exists - proceeding to punch');
        }

        onSummarySubmitted?.();
        console.log('✓ Plan submission verified via remote DB');
        setPhase('punch');
        return;
      }

      // If not found, request debug diagnostics from the main process and show details
      try {
        console.log('[PlanOfDay] About to check timesheet DB debug for employee:', employee.employee_code);
        
        // Get fresh environment debug right before checking timesheet DB
        if (typeof window !== 'undefined' && (window as any).electronAPI?.debugEnv) {
          const envDebugBefore = await (window as any).electronAPI.debugEnv();
          console.log('[PlanOfDay] Environment state BEFORE timesheet check:', JSON.stringify(envDebugBefore, null, 2));
        }
        
        if (typeof window !== 'undefined' && (window as any).electronAPI?.checkTimesheetDbDebug) {
          const dbg = await (window as any).electronAPI.checkTimesheetDbDebug(employee.employee_code);
          console.log('[PlanOfDay] checkTimesheetDbDebug result:', dbg);
          console.log('[PlanOfDay] Debug details:', JSON.stringify(dbg.details, null, 2));
          console.log('[PlanOfDay] Debug errors:', dbg.errors);
          console.log('[PlanOfDay] Debug ok:', dbg.ok);

          // Check for configuration errors first
          if (!dbg.timesheetDbUrl) {
            console.error('[PlanOfDay] CONFIGURATION ERROR: timesheetDbUrl not set in debug result', dbg);
            setSummaryError('⚙️ Configuration Error: TIMESHEET_DB_URL is not configured in the application. Please contact your administrator.');
            setLoading(false);
            return;
          }

          // Check for database connection errors
          if (!dbg.configStatus?.connectionSuccess && dbg.configStatus?.connectionAttempted) {
            setSummaryError('🔌 Database Error: Could not connect to the timesheet database. Please check your internet connection and try again.');
            setLoading(false);
            return;
          }

          // Check for employee lookup errors
          if (!dbg.details?.employeeId) {
            setSummaryError('👤 Employee Not Found: Your employee code (' + employee.employee_code + ') was not found in the timesheet system. Please contact your administrator.');
            setLoading(false);
            return;
          }

          // If we got here, there's data but no submitted timesheet
          setSummaryError('📋 Timesheet Not Submitted: Please submit your timesheet in the portal first, then click "Continue" again.');
        } else {
          setSummaryError('📋 Timesheet Not Submitted: Please submit your plan in the portal first, then try again.');
        }
      } catch (e) {
        console.error('[PlanOfDay] Debug check failed:', e);
        setSummaryError('❌ Unable to verify plan submission. Please try again.');
      }
    } catch (error) {
      console.error('Error verifying plan submission:', error);
      setSummaryError('Unable to verify plan submission right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmationNo = () => {
    setSummaryError('Please submit your plan in the portal, then click Continue again.');
    setPhase('form');
  };

  const handlePunchYes = async () => {
    setPunchError('');
    setLoading(true);
    try {
      let todaySession: any = null;
      try {
        todaySession = await getTodaySession(employee.id);
      } catch (e) {
        console.warn('Could not get today session, proceeding anyway', e);
      }

      const now = new Date().toISOString();
      
      const completedSession = {
        ...(todaySession || {}),
        punched_in: true,
        punch_in_time: now,
      } as WorkSession;

      onPunchConfirmed?.();
      console.log('✓ Punch-in confirmed (bypassed check)');
      onComplete(completedSession);
    } finally {
      setLoading(false);
    }
  };

  const handlePunchNo = () => {
    setPhase('punch_no');
  };

  const handleRetryPunch = () => {
    setPunchError('');
    setPhase('punch');
  };

  if (phase === 'summary') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-white flex flex-col">
        <header className="bg-white border-b border-pink-100 px-6 py-4 flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPhase('form')}
              className="rounded-full bg-pink-50 hover:bg-pink-100 p-2 transition"
            >
              <ArrowLeft className="w-4 h-4 text-pink-500" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-pink-400 to-rose-500 rounded-lg flex items-center justify-center">
                <ClipboardList className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-gray-800">Plan Submission Check</h1>
                <p className="text-xs text-pink-400">Step 2 of 3</p>
              </div>
            </div>
          </div>
          <WindowControls disabledClose={windowLocked} />
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl border border-pink-100 p-8 max-w-xl w-full">
            <h2 className="text-xl font-bold text-gray-800 mb-3">Did you submit your plan for today?</h2>
            <p className="text-sm text-gray-500 mb-6">We will verify the submission in the database before moving on.</p>
            {summaryError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">{summaryError}</div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleConfirmationYes}
                disabled={loading}
                className="w-full bg-gradient-to-r from-pink-500 to-rose-500 text-white font-semibold py-3 rounded-xl shadow hover:from-pink-600 hover:to-rose-600 transition disabled:opacity-60"
              >
                {loading ? 'Checking...' : 'Yes, verify and continue'}
              </button>
              <button
                type="button"
                onClick={handleConfirmationNo}
                className="w-full border border-pink-200 text-pink-600 font-semibold py-3 rounded-xl hover:bg-pink-50 transition"
              >
                No, go back to portal
              </button>
            </div>
          </div>
        </div>

      </div>
    );
  }

  if (phase === 'punch') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-white flex flex-col">
        <header className="bg-white border-b border-pink-100 px-6 py-4 flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPhase('summary')}
              className="rounded-full bg-pink-50 hover:bg-pink-100 p-2 transition"
            >
              <ArrowLeft className="w-4 h-4 text-pink-500" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-pink-400 to-rose-500 rounded-lg flex items-center justify-center">
                <ClipboardList className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-gray-800">Punch-In Confirmation</h1>
                <p className="text-xs text-pink-400">Step 3 of 3</p>
              </div>
            </div>
          </div>
          <WindowControls disabledClose={windowLocked} />
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl border border-pink-100 p-8 max-w-sm w-full text-center">
            <div className="w-14 h-14 bg-pink-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">👊</span>
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Did you punch in?</h2>
            <p className="text-gray-500 text-sm mb-6">Confirm your attendance before moving on.</p>
            {punchError && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{punchError}</div>}
            <div className="grid gap-3">
              <button
                onClick={handlePunchYes}
                disabled={loading}
                className="w-full bg-gradient-to-r from-pink-500 to-rose-500 text-white font-semibold py-3 rounded-xl shadow hover:from-pink-600 hover:to-rose-600 transition disabled:opacity-60"
              >
                {loading ? 'Saving...' : 'Yes'}
              </button>
              <button
                onClick={handlePunchNo}
                className="w-full border border-pink-200 text-pink-600 font-semibold py-3 rounded-xl hover:bg-pink-50 transition"
              >
                No
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'punch_no') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-white flex flex-col">
        <header className="bg-white border-b border-pink-100 px-6 py-4 flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-pink-400 to-rose-500 rounded-lg flex items-center justify-center">
                <ClipboardList className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-gray-800">Punch-In Required</h1>
                <p className="text-xs text-pink-400">Cannot proceed</p>
              </div>
            </div>
          </div>
          <WindowControls disabledClose={windowLocked} />
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl border border-pink-100 p-8 max-w-sm w-full text-center">
            <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Please punch in first</h2>
            <p className="text-gray-500 text-sm mb-6">You must punch in before you can continue to other modules.</p>
            <button
              onClick={handleRetryPunch}
              className="w-full border border-pink-200 text-pink-600 font-semibold py-3 rounded-xl hover:bg-pink-50 transition"
            >
              Return to punch check
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-white flex flex-col">
      <header className="bg-white border-b border-pink-100 px-6 py-4 flex items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBackClick}
            className="rounded-full bg-pink-50 hover:bg-pink-100 p-2 transition"
          >
            <ArrowLeft className="w-4 h-4 text-pink-500" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-pink-400 to-rose-500 rounded-lg flex items-center justify-center">
              <ClipboardList className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-800">Plan of the Day</h1>
              <p className="text-xs text-pink-400">Step 1 of 3</p>
            </div>
          </div>
        </div>
        <WindowControls disabledClose={windowLocked} />
      </header>

      <div className="flex-1 flex flex-col gap-6 p-6">
        <div className="flex-1 bg-white rounded-2xl shadow-md border border-pink-100 overflow-hidden">
          <div className="bg-gradient-to-r from-pink-50 to-rose-50 border-b border-pink-100 px-4 py-3 flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-pink-400" />
            <span className="text-sm font-medium text-gray-600">
              {portalUrl === 'https://timestrap.space/plan-for-day' ? 'Daily Plan Portal' : 'PMS Tasks'}
            </span>
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-pink-500 hover:text-pink-600 underline"
            >
              Open in browser
            </a>
          </div>
          <div className="relative w-full h-[420px] lg:h-[600px] min-h-[420px] flex items-center justify-center bg-gray-50">
            <iframe 
              src={portalUrl} 
              className="w-full h-full border-0" 
              title="Daily Plan Portal"
            />
          </div>
        </div>

        <div className="w-full bg-white rounded-2xl shadow-md border border-pink-100 p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-1">Continue to the next step</h2>
          <p className="text-sm text-gray-400 mb-4">Use the portal to submit your daily plan, then continue when ready.</p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setPhase('summary')}
              className="w-full bg-gradient-to-r from-pink-500 to-rose-500 text-white font-semibold py-3 rounded-xl shadow hover:from-pink-600 hover:to-rose-600 transition"
            >
              Continue
            </button>
            {portalUrl === 'https://timestrap.space/plan-for-day' ? (
              <button
                type="button"
                onClick={() => setPortalUrl('http://147.93.28.144:5002/tasks')}
                className="w-full border border-pink-200 text-pink-600 font-semibold py-3 rounded-xl hover:bg-pink-50 transition"
              >
                PMS - Upload New Task
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPortalUrl('https://timestrap.space/plan-for-day')}
                className="w-full border border-pink-200 text-pink-600 font-semibold py-3 rounded-xl hover:bg-pink-50 transition"
              >
                Back to TimeStrap
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
