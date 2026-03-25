import { useEffect, useState } from 'react';
import { SystemStats } from '../types';

export function useSystemStats() {
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const stats = await window.kairo.invoke('system:stats') as SystemStats | null;
        setSystemStats(stats);
      } catch {
        return;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return systemStats;
}
