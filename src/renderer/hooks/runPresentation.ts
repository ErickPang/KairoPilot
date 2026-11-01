import type { RunStatus } from '../../shared/contracts';
import type { TranslationKey } from '../i18n';

export const runStatusLabel: Record<RunStatus, TranslationKey> = {
  running: 'chat.runStatus.running',
  waiting_approval: 'chat.runStatus.waitingApproval',
  paused: 'chat.runStatus.paused',
  completed: 'chat.runStatus.completed',
  failed: 'chat.runStatus.failed',
  cancelled: 'chat.runStatus.cancelled'
};
