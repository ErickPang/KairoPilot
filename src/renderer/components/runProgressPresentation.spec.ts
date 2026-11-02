import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../shared/contracts';
import { runElapsedSeconds } from './runProgressPresentation';
const run: RunSummary = { id: 'current', sessionId: 's', agentId: 'a', goal: '', userInput: '', status: 'running', createdAt: 1000, startedAt: 2000, updatedAt: 5000 };
describe('conversation execution presentation', () => {
  it('uses recorded timestamps and freezes elapsed time after termination or pause', () => {
    expect(runElapsedSeconds(run, 76500)).toBe(74);
    expect(runElapsedSeconds({ ...run, status: 'completed', completedAt: 55000 }, 100000)).toBe(53);
    expect(runElapsedSeconds({ ...run, status: 'cancelled' }, 100000)).toBe(3);
    expect(runElapsedSeconds({ ...run, status: 'paused' }, 100000)).toBe(3);
    expect(runElapsedSeconds(run, 1000)).toBe(0);
  });
});
