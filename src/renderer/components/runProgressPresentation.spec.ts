import { describe, expect, it } from 'vitest';
import type { RunStep, RunSummary } from '../../shared/contracts';
import { currentRunActivity, runElapsedSeconds } from './runProgressPresentation';
const run: RunSummary = { id: 'current', sessionId: 's', agentId: 'a', goal: '', userInput: '', status: 'running', createdAt: 1000, startedAt: 2000, updatedAt: 5000 };
const step = (patch: Partial<RunStep>): RunStep => ({ id: 'step', runId: 'current', stepIndex: 1, type: 'tool_call', status: 'running', title: 'internal title', createdAt: 2000, updatedAt: 3000, ...patch });
describe('conversation execution presentation', () => {
  it('uses recorded timestamps and freezes elapsed time after termination or pause', () => {
    expect(runElapsedSeconds(run, 76500)).toBe(74);
    expect(runElapsedSeconds({ ...run, status: 'completed', completedAt: 55000 }, 100000)).toBe(53);
    expect(runElapsedSeconds({ ...run, status: 'cancelled' }, 100000)).toBe(3);
    expect(runElapsedSeconds({ ...run, status: 'paused' }, 100000)).toBe(3);
    expect(runElapsedSeconds(run, 1000)).toBe(0);
  });
  it('only reports the latest active step belonging to the current run', () => {
    const read = step({ input: { tool: 'read_file', args: { path: '/private/project/worker-prompt.md' } } });
    expect(currentRunActivity(run, [read, step({ runId: 'another', stepIndex: 8, input: { tool: 'execute_command' } })])).toEqual({ key: 'progress.reading', target: 'worker-prompt.md', icon: 'read' });
    expect(currentRunActivity(run, [read, step({ stepIndex: 2, type: 'model_call' })])).toEqual({ key: 'progress.thinking' });
    expect(currentRunActivity(run, [{ ...read, status: 'completed' }])).toEqual({ key: 'progress.thinking' });
    expect(currentRunActivity(null, [read])).toEqual({ key: 'progress.thinking' });
  });
  it('prioritizes approval and pause and avoids exposing commands or internal arguments', () => {
    const command = step({ input: { tool: 'execute_command', args: { command: 'sensitive literal', __internal: true } } });
    expect(currentRunActivity(run, [command])).toEqual({ key: 'progress.command', icon: 'terminal' });
    expect(currentRunActivity({ ...run, status: 'waiting_approval' }, [command])).toEqual({ key: 'progress.waiting' });
    expect(currentRunActivity({ ...run, status: 'paused' }, [command])).toEqual({ key: 'progress.paused' });
    expect(currentRunActivity(run, [step({ input: { tool: 'read_file', args: { path: 'C:\\project\\source.ts' } } })]).target).toBe('source.ts');
  });
});
