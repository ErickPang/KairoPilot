import { useEffect, useState } from 'react';
import { SystemStats } from '../types';
import { KAIRO_INVOKE } from '../../shared/ipc';

export function useSystemStats(enabled = true, intervalMs = 5000) {
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const fetchStats = async () => {
      try {
        const stats = await window.kairo.invoke(KAIRO_INVOKE.systemStats);
        if (!cancelled) {
          setSystemStats(stats);
        }
      } catch {
        return;
      }
    };

    const runFetch = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      void fetchStats();
    };

    runFetch();
    const interval = window.setInterval(runFetch, intervalMs);
    const handleVisibilityChange = () => {
      if (document.hidden) {
        return;
      }
      runFetch();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [enabled, intervalMs]);

  return systemStats;
}
