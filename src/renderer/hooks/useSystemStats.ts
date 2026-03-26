import { useEffect, useState } from 'react';
import { SystemStats } from '../types';
import { KAIRO_INVOKE } from '../../shared/ipc';

export function useSystemStats() {
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const stats = await window.kairo.invoke(KAIRO_INVOKE.systemStats);
        setSystemStats(stats);
      } catch {
        return;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return systemStats;
}
