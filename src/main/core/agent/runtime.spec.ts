import { beforeEach, describe, expect, it, vi } from 'vitest';

const skillsManagerMock = {
  listPublicSkills: vi.fn(),
  listAgentSkills: vi.fn(),
  listMergedSkills: vi.fn()
};

vi.mock('../skills/manager', () => ({
  skillsManager: skillsManagerMock
}));

describe('runtime skill inventory helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('识别中英文技能盘点问题', async () => {
    const { isSkillInventoryQuery } = await import('./runtime');

    expect(isSkillInventoryQuery('有哪些可用技能')).toBe(true);
    expect(isSkillInventoryQuery('当前已安装哪些技能？')).toBe(true);
    expect(isSkillInventoryQuery('what skills are available right now')).toBe(true);
    expect(isSkillInventoryQuery('继续修复这个 bug')).toBe(false);
  });

  it('返回公共区与当前 agent 技能的明确计数和列表', async () => {
    skillsManagerMock.listPublicSkills.mockResolvedValue([
      { id: 'find-skills', name: 'find-skills' },
      { id: 'skill-creator', name: 'skill-creator' }
    ]);
    skillsManagerMock.listAgentSkills.mockResolvedValue([
      { id: 'workspace-helper', name: 'workspace-helper' }
    ]);
    skillsManagerMock.listMergedSkills.mockResolvedValue([
      { id: 'find-skills', name: 'find-skills' },
      { id: 'skill-creator', name: 'skill-creator' },
      { id: 'workspace-helper', name: 'workspace-helper' }
    ]);

    const { buildSkillInventoryResponse } = await import('./runtime');
    const response = await buildSkillInventoryResponse('mainAgent');

    expect(skillsManagerMock.listPublicSkills).toHaveBeenCalledTimes(1);
    expect(skillsManagerMock.listAgentSkills).toHaveBeenCalledWith('mainAgent');
    expect(skillsManagerMock.listMergedSkills).toHaveBeenCalledWith('mainAgent');
    expect(response).toContain('当前可用技能共 3 个');
    expect(response).toContain('公共区技能 2 个');
    expect(response).toContain('当前 Agent 专属技能 1 个');
    expect(response).toContain('- find-skills (find-skills)');
    expect(response).toContain('- workspace-helper (workspace-helper)');
  });
});
