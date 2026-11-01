import { describe, expect, it } from 'vitest';
import { RuntimeSupportState } from './runtimeSupportState';

describe('RuntimeSupportState', () => {
  it('快照 restore 后会规范化状态并可重新导出', () => {
    const state = new RuntimeSupportState();

    state.restore({
      activeSkillSessions: {
        s1: {
          fingerprint: 'a1',
          announcedSkillNames: [' Skill A ', '', 'Skill B']
        }
      },
      skillCatalogSessions: {
        s1: {
          fingerprint: 'c1',
          announcedSkillIds: [' alpha ', '', 'beta']
        }
      },
      toolCatalogSessions: {
        s1: {
          fingerprint: 't1',
          announcedToolNames: [' read_file ', '', 'write_file']
        }
      }
    });

    expect(state.snapshot()).toEqual({
      activeSkillSessions: {
        s1: {
          fingerprint: 'a1',
          announcedSkillNames: ['Skill A', 'Skill B']
        }
      },
      skillCatalogSessions: {
        s1: {
          fingerprint: 'c1',
          announcedSkillIds: ['alpha', 'beta']
        }
      },
      toolCatalogSessions: {
        s1: {
          fingerprint: 't1',
          announcedToolNames: ['read_file', 'write_file']
        }
      }
    });
  });

  it('在 consume=false 时不会推进 active skills 增量状态', () => {
    const state = new RuntimeSupportState();
    const loadedSkills = [
      {
        skillName: 'Issue Triage',
        allowedTools: ['read_file'],
        loadedAt: 1,
        resourcePaths: [],
        scriptPaths: []
      }
    ];

    const first = state.resolveActiveSkillsSummary('run-1', 'session-1', loadedSkills, false);
    const second = state.resolveActiveSkillsSummary('run-1', 'session-1', loadedSkills, false);

    expect(first).toContain('Issue Triage');
    expect(second).toContain('Issue Triage');
  });

  it('在 consume=true 时工具摘要只首次返回完整内容，之后无重复注入', () => {
    const state = new RuntimeSupportState();

    const first = state.resolveAvailableToolsSummary('run-1', 'session-1', ['read_file', 'execute_command'], true);
    const second = state.resolveAvailableToolsSummary('run-1', 'session-1', ['read_file', 'execute_command'], true);

    expect(first).toBe('read_file, execute_command');
    expect(second).toBe('');
  });

  it('在 consume=true 时可用技能目录在单次 run 内只首次返回完整内容', () => {
    const state = new RuntimeSupportState();
    const snapshot = {
      fingerprint: 'skills-v1',
      fullSummary: '- issue-triage: triage issues',
      entries: [
        { id: 'issue-triage', summary: '- issue-triage: triage issues' }
      ]
    };

    const first = state.resolveAvailableSkillsSummary('run-1', 'session-1', snapshot, true);
    const second = state.resolveAvailableSkillsSummary('run-1', 'session-1', snapshot, true);

    expect(first).toBe('- issue-triage: triage issues');
    expect(second).toBe('');
  });

  it('在同一 session 的新 run 中不会重复注入可用技能目录', () => {
    const state = new RuntimeSupportState();
    const snapshot = {
      fingerprint: 'skills-v1',
      fullSummary: '- issue-triage: triage issues',
      entries: [
        { id: 'issue-triage', summary: '- issue-triage: triage issues' }
      ]
    };

    const firstRun = state.resolveAvailableSkillsSummary('run-1', 'session-1', snapshot, true);
    const secondRun = state.resolveAvailableSkillsSummary('run-2', 'session-1', snapshot, true);

    expect(firstRun).toBe('- issue-triage: triage issues');
    expect(secondRun).toBe('');
  });
});
