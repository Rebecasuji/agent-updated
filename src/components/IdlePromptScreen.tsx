import { useEffect, useState, useRef } from 'react';
import IdleReasonModal from './IdleReasonModal';
import { Employee, WorkSession, createActivityLog, createIdleAlert, getMonitoringSettings } from '../lib/supabase';

export default function IdlePromptScreen() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [session, setSession] = useState<WorkSession | null>(null);
  const [countdown, setCountdown] = useState(30);
  const [idleStartTime, setIdleStartTime] = useState<number | null>(null);
  const [step, setStep] = useState<'countdown' | 'confirm' | 'details_yes' | 'details_no'>('countdown');
  const stepRef = useRef(step);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    // Extract start time from URL
    const searchParams = new URLSearchParams(window.location.hash.split('?')[1]);
    const startParam = searchParams.get('start');
    if (startParam) {
      setIdleStartTime(parseInt(startParam, 10));
    } else {
      setIdleStartTime(Date.now() - 60000);
    }

    const api = (window as any).electronAPI;
    if (api) {
      api.loadSessionCache?.().then((cached: any) => {
        if (cached?.employee && cached?.session) {
          setEmployee(cached.employee);
          setSession(cached.session);
        }
      });
    }

    getMonitoringSettings().then(settings => {
      if (settings?.idle_alert_countdown_seconds) {
        setCountdown(settings.idle_alert_countdown_seconds);
      }
    });

    // Auto-dismiss if user touches keyboard during countdown
    const checkActive = setInterval(async () => {
      const api = (window as any).electronAPI;
      if (api?.getSystemIdleTime) {
        const sysIdle = await api.getSystemIdleTime();
        if (sysIdle < 2 && stepRef.current === 'countdown') {
          api?.closeIdlePromptWindow?.();
        }
      }
    }, 1000);

    return () => clearInterval(checkActive);
  }, []);

  const handleDismiss = () => {
    const api = (window as any).electronAPI;
    api?.closeIdlePromptWindow?.();
  };

  const handleSubmit = async (reason: string, wasWorking: boolean) => {
    if (employee && session) {
      try {
        const api = (window as any).electronAPI;
        const activity = await api?.getLatestActivity?.();
        
        const now = Date.now();
        const durationSecs = idleStartTime ? Math.floor((now - idleStartTime) / 1000) : 0;
        const idleReasonText = `${wasWorking ? 'Working' : 'Away'}: ${reason || 'No details provided'}`;

        // Write to activity_logs table
        await createActivityLog({
          session_id: session.id,
          employee_id: employee.id,
          app_name: activity?.activeWindow?.appName || 'Unknown',
          window_title: activity?.activeWindow?.windowTitle || 'Unknown',
          activity_type: 'idle_reason',
          idle_reason: idleReasonText,
          duration_seconds: durationSecs,
          logged_at: new Date().toISOString(),
        });

        // Write to idle_alerts table
        await createIdleAlert({
          employee_id: employee.id,
          session_id: session.id,
          idle_since: idleStartTime ? new Date(idleStartTime).toISOString() : new Date().toISOString(),
          response: wasWorking ? 'Working' : 'Away',
          reason: reason || 'No details provided',
          description: idleReasonText,
        });
      } catch (err) {
        console.error('Failed to save idle reason:', err);
      }
    }
    handleDismiss();
  };

  if (!employee || !session) return null;

  return (
    <IdleReasonModal
      idleStartTime={idleStartTime}
      countdownSeconds={countdown}
      onDismiss={handleDismiss}
      onSubmit={handleSubmit}
      onStepChange={setStep}
    />
  );
}