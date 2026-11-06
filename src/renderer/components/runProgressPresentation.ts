import type { ConversationRun } from '../../shared/contracts';

export function runElapsedSeconds(run: ConversationRun, now: number): number {
  const start = run.startedAt ?? run.createdAt;
  const end = run.status === 'running' || run.status === 'waiting_approval' ? now : run.completedAt ?? run.updatedAt;
  return Math.max(0, Math.floor((end - start) / 1000));
}
