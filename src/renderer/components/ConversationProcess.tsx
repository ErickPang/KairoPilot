import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ConversationRun } from '../../shared/contracts';
import { useTranslation } from '../hooks/useTranslation';
import { runElapsedSeconds } from './runProgressPresentation';

export function ConversationProcess({ run, live, now, children }: {
  run?: ConversationRun; live: boolean; now: number; children?: ReactNode;
}) {
  const { t } = useTranslation();
  const status = run?.status;
  const defaultOpen = live || status === 'failed' || status === 'paused';
  const [open, setOpen] = useState(defaultOpen);
  // Approval round trips preserve the user's choice. Terminal transitions apply defaults.
  useEffect(() => { setOpen(defaultOpen); }, [run?.id, defaultOpen]);
  const elapsed = run ? runElapsedSeconds(run, now) : 0;
  const duration = elapsed >= 60 ? t('progress.minutesSeconds', { minutes: Math.floor(elapsed / 60), seconds: elapsed % 60 }) : t('progress.seconds', { seconds: elapsed });
  const key = status === 'cancelled' ? 'progress.cancelled' : status === 'failed' ? 'progress.failed' : status === 'paused' ? 'progress.pausedDuration' : live ? 'progress.working' : 'progress.elapsed';
  return <details className="conversation-run" data-process-run={run?.id} open={open} onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}>
    <summary className="conversation-run-summary" data-run-summary={status}>
      <span>{run ? t(key, { duration }) : t('progress.history')}</span>{!live && <ChevronRight size={14} aria-hidden="true" />}
    </summary>
    {open && children}
  </details>;
}
