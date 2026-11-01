import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { RunSummary } from '../types';
import { useTranslation } from '../hooks/useTranslation';

export function RunPauseControl({ run, onPause, onResume, disabled }: {
  run: RunSummary | null;
  onPause: () => Promise<boolean | void>;
  onResume: () => Promise<boolean | void>;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<'pause' | 'resume' | null>(null);
  const pendingRef = useRef(false);
  useEffect(() => { setPending(null); pendingRef.current = false; }, [run?.id, run?.status]);
  if (!run || !['running', 'waiting_approval', 'paused'].includes(run.status)) return null;
  const request = async (action: 'pause' | 'resume', handler: () => Promise<boolean | void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(action);
    try {
      const accepted = await handler();
      if (accepted !== true || action === 'resume') { pendingRef.current = false; setPending(null); }
    } catch { pendingRef.current = false; setPending(null); }
  };
  return <div className="run-pause-control">
    {run.status === 'running' && <button type="button" disabled={Boolean(pending)} title={t('workbench.interruptHint')} onClick={() => void request('pause', onPause)}><Pause size={14} />{t('workbench.pause')}</button>}
    {run.status === 'paused' && run.executionContext?.phase!=='planning' && <button type="button" disabled={disabled || Boolean(pending)} onClick={() => void request('resume', onResume)}><Play size={14} />{t('workbench.resume')}</button>}
    {pending && <span role="status">{t('workbench.requesting')}</span>}
  </div>;
}
