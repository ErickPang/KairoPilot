import { describe, expect, it } from 'vitest';
import { RuntimeSupportState } from './runtimeSupportState';

describe('RuntimeSupportState', () => {
  it('在同一 session 内不会为每个新 run 重复公告技能目录', () => {
    const supportState = new RuntimeSupportState();
    const snapshot = {
      fingerprint: 'skills-v1',
      fullSummary: '- issue-triage: debug workflow',
      entries: [
        {
          id: 'issue-triage',
          summary: '- issue-triage: debug workflow'
        }
      ]
    };

    const firstSummary = supportState.resolveAvailableSkillsSummary('run-1', 'session-1', snapshot, true);
    const secondSummary = supportState.resolveAvailableSkillsSummary('run-2', 'session-1', snapshot, true);

    expect(firstSummary).toContain('issue-triage');
    expect(secondSummary).toBe('');
  });
});
