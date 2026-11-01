import type { RunStep, RunSummary } from '../../shared/contracts';
import type { TranslationKey } from '../i18n';

export function runElapsedSeconds(run: RunSummary, now: number): number {
  const start = run.startedAt ?? run.createdAt;
  const end = run.status === 'running' || run.status === 'waiting_approval' ? now : run.completedAt ?? run.updatedAt;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function currentRunActivity(run: RunSummary | null, steps: RunStep[]): { key: TranslationKey; target?: string; icon?: 'read' | 'terminal' | 'search' | 'tool' } {
  if (run?.status === 'waiting_approval') return { key: 'progress.waiting' };
  if (run?.status === 'paused') return { key: 'progress.paused' };
  const step = steps.filter(item => item.runId === run?.id && item.status === 'running').sort((a, b) => b.stepIndex - a.stepIndex)[0];
  if (step?.type !== 'tool_call') return { key: 'progress.thinking' };
  const input = step.input && typeof step.input === 'object' ? step.input as Record<string, unknown> : {};
  const args = input.args && typeof input.args === 'object' ? input.args as Record<string, unknown> : {};
  const tool = typeof input.tool === 'string' ? input.tool : '';
  const file = typeof args.path === 'string' ? args.path.replace(/\\/g, '/').split('/').filter(Boolean).pop() : undefined;
  if (tool === 'read_file' || tool === 'read_skill_resource' || tool === 'read_attachment') return { key: 'progress.reading', target: file, icon: 'read' };
  if (tool === 'execute_command' || tool === 'run_skill_script') return { key: 'progress.command', icon: 'terminal' };
  if (tool === 'web_search' || tool === 'fetch_webpage' || tool === 'http_request') return { key: 'progress.searching', icon: 'search' };
  return { key: 'progress.tool', target: tool, icon: 'tool' };
}
