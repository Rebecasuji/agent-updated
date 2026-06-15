import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, CheckCircle, RefreshCw } from 'lucide-react';
import { Employee } from '../lib/supabase';

interface Props {
  employee: Employee;
  date: string;
  onUnlocked: () => void;
}

export default function TimesheetLockScreen({ employee, date, onUnlocked }: Props) {
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleFillTimesheet = async () => {
    try {
      const success = await (window as any).electronAPI?.openTimesheetBrowser?.();
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
      const result = await (window as any).electronAPI?.verifyTimesheetRealtime?.(employee.employee_code);
      if (result?.submitted) {
        onUnlocked();
      } else {
        setErrorMsg('Timesheet submission not found. Please submit your timesheet and try again.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to verify timesheet status. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleContactSupport = () => {
    window.location.href = 'mailto:hr@example.com?subject=Timesheet Lock Issue';
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex items-center justify-center p-6 text-slate-100">
      <div className="bg-white rounded-2xl max-w-xl w-full p-8 shadow-2xl flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="w-10 h-10 text-red-600" />
        </div>
        
        <h1 className="text-3xl font-bold text-slate-900 mb-4">System Locked</h1>
        
        <p className="text-lg text-slate-600 mb-8">
          Your system has been locked because your timesheet for <strong>{date}</strong> has not been submitted.
          Please submit your timesheet or contact HR/IT Support.
        </p>

        {errorMsg && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg w-full mb-6 font-medium text-sm">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-col gap-4 w-full">
          <button
            onClick={handleFillTimesheet}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-semibold transition-colors text-lg shadow-sm"
          >
            <ExternalLink className="w-5 h-5" />
            Fill Your Timesheet
          </button>
          
          <button
            onClick={handleContinue}
            disabled={verifying}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-xl font-semibold transition-colors text-lg shadow-sm disabled:opacity-50"
          >
            {verifying ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
            {verifying ? 'Verifying...' : 'Back & Continue'}
          </button>

          <button
            onClick={handleContactSupport}
            className="w-full text-slate-500 hover:text-slate-700 font-medium py-3"
          >
            Contact HR / IT Support
          </button>
        </div>
      </div>
    </div>
  );
}
