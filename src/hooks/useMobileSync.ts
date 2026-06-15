// Hook for using mobile sync data in components

import { useState, useEffect } from 'react';
import {
  getTodayCallLogs,
  getTodayCallStats,
  getTodayFieldVisits,
  getLatestFieldLocation,
  CallLog,
  FieldVisit,
  FieldLocation,
} from '../lib/mobileSync';

export interface UseMobileSyncData {
  callLogs: CallLog[];
  callStats: any;
  fieldVisits: FieldVisit[];
  currentLocation: FieldLocation | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch and manage mobile sync data for an employee
 */
export function useMobileSync(employeeId: string): UseMobileSyncData {
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [callStats, setCallStats] = useState<any>(null);
  const [fieldVisits, setFieldVisits] = useState<FieldVisit[]>([]);
  const [currentLocation, setCurrentLocation] = useState<FieldLocation | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const [calls, stats, visits, location] = await Promise.all([
        getTodayCallLogs(employeeId),
        getTodayCallStats(employeeId),
        getTodayFieldVisits(employeeId),
        getLatestFieldLocation(employeeId),
      ]);

      setCallLogs(calls);
      setCallStats(stats);
      setFieldVisits(visits);
      setCurrentLocation(location);
    } catch (err) {
      console.error('[useMobileSync] Error refreshing data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // Auto-refresh every 30 seconds
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [employeeId]);

  return {
    callLogs,
    callStats,
    fieldVisits,
    currentLocation,
    loading,
    refresh,
  };
}

/**
 * Hook to get mini stats for a summary view
 */
export function useMobileMiniStats(employeeId: string) {
  const [stats, setStats] = useState({
    totalCalls: 0,
    totalCallDuration: 0,
    currentVisitCount: 0,
    lastCallTime: null as string | null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const [calls, visits] = await Promise.all([
          getTodayCallLogs(employeeId),
          getTodayFieldVisits(employeeId),
        ]);

        const ongoingVisits = visits.filter(v => v.status === 'ongoing');
        const totalDuration = calls.reduce((sum, c) => sum + c.duration_seconds, 0);
        const lastCall = calls[0];

        setStats({
          totalCalls: calls.length,
          totalCallDuration: totalDuration,
          currentVisitCount: ongoingVisits.length,
          lastCallTime: lastCall ? new Date(lastCall.call_start).toLocaleTimeString() : null,
        });
      } catch (err) {
        console.error('[useMobileMiniStats] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [employeeId]);

  return { stats, loading };
}
