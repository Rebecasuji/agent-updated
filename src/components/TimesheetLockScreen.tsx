import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, CheckCircle, RefreshCw, Unlock } from 'lucide-react';
import { Employee } from '../lib/supabase';

interface Props {
  employee: Employee;
  date: string;
  onUnlocked: () => void;
}

export default function TimesheetLockScreen({ employee, date, onUnlocked }: Props) {
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [unlocked, setUnlocked] = useState(false);

  const eApi = (window as any).electronAPI;

  const handleFillTimesheet = async () => {
    setErrorMsg('');
    try {
      const success = await eApi?.openTimesheetBrowser?.();
      if (!success) {
        setErrorMsg('Unable to open the timesheet portal. Please try again or contact support.');
      }
    } catch (err) {
      console.error('Failed to open timesheet browser', err);
      setErrorMsg('Unable to open the timesheet portal. Please try again or contact support.');
    }
  };

  const handleContinue = async () => {
    setVerifying(true);
    setErrorMsg('');
    try {
      // Re-query the database to verify submission
      const result = await eApi?.verifyTimesheetRealtime?.(employee.employee_code);
      console.log('[LockScreen] Verification result:', result);

      if (result?.submitted) {
        // ── Immediately unlock kiosk before calling onUnlocked ──
        try {
          await eApi?.setWindowClosable?.(true);
          await eApi?.setWindowMinimizable?.(true);
          await eApi?.exitKiosk?.();
        } catch (unlockErr) {
          console.error('[LockScreen] Kiosk exit error:', unlockErr);
        }
        setUnlocked(true);
        // Short delay so employee sees the success screen, then dismiss
        setTimeout(() => {
          onUnlocked();
        }, 1800);
      } else {
        setErrorMsg(
          'Your timesheet for ' + date + ' has not been submitted yet. ' +
          'Please open the timesheet portal, fill all entries, and click Submit — then come back here.'
        );
      }
    } catch (err) {
      console.error('[LockScreen] Verification error:', err);
      setErrorMsg('Could not connect to verify your timesheet. Please check your internet connection and try again.');
    } finally {
      setVerifying(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (unlocked) {
    return (
      <div className="fixed inset-0 bg-emerald-600 z-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center text-center text-white gap-6">
          <div className="w-24 h-24 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
            <Unlock className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl font-bold">System Unlocked!</h1>
          <p className="text-xl opacity-90">Timesheet verified successfully. Resuming your session…</p>
        </div>
      </div>
    );
  }

  // ── Locked state ───────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex items-center justify-center p-6 text-slate-100">
      <div className="bg-white rounded-2xl max-w-xl w-full p-8 shadow-2xl flex flex-col items-center text-center">

        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-5">
          <AlertTriangle className="w-10 h-10 text-red-600" />
        </div>

        <h1 className="text-3xl font-bold text-slate-900 mb-3">System Locked</h1>

        <p className="text-base text-slate-600 mb-2">
          Your system is locked because your timesheet for{' '}
          <strong className="text-slate-900">{date}</strong> has not been submitted.
        </p>

        {/* Step-by-step instructions */}
        <ol className="text-sm text-slate-500 text-left w-full mb-6 space-y-2 bg-slate-50 rounded-xl p-4 border border-slate-200">
          <li className="flex gap-2">
            <span className="font-bold text-blue-600 shrink-0">1.</span>
            Click <strong>"Fill Your Timesheet"</strong> to open the portal.
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-blue-600 shrink-0">2.</span>
            Fill in all your hours and click <strong>Submit</strong> inside the portal.
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-blue-600 shrink-0">3.</span>
            Close the portal window, then click <strong>"I've Submitted — Unlock"</strong> below.
          </li>
        </ol>

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl w-full mb-5 text-sm font-medium text-left">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-col gap-3 w-full">
          <button
            id="btn-fill-timesheet"
            onClick={handleFillTimesheet}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white py-4 rounded-xl font-semibold transition-colors text-lg shadow-sm"
          >
            <ExternalLink className="w-5 h-5" />
            Fill Your Timesheet
          </button>

          <button
            id="btn-verify-unlock"
            onClick={handleContinue}
            disabled={verifying}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white py-4 rounded-xl font-semibold transition-colors text-lg shadow-sm disabled:opacity-50"
          >
            {verifying
              ? <RefreshCw className="w-5 h-5 animate-spin" />
              : <CheckCircle className="w-5 h-5" />}
            {verifying ? 'Verifying submission…' : "I've Submitted — Unlock"}
          </button>

          <p className="text-xs text-slate-400 pt-1">
            Contact HR / IT Support if you believe this is a mistake.
          </p>
        </div>
      </div>
    </div>
  );
}
