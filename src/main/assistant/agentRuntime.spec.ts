import { beforeEach, describe, expect, it, vi } from 'vitest';

const skillsManagerMock = {
  listPublicSkills: vi.fn(),
  listAgentSkills: vi.fn(),
  listMergedSkills: vi.fn()
};

vi.mock('electron', () => ({
  WebContents: class {}
}));

vi.mock('../core/agent/runtime', () => ({
  AgentRuntime: class {}
}));

vi.mock('../core/llm/provider', () => ({
  createLLMProvider: vi.fn()
}));

vi.mock('../core/llm/prompt', () => ({
  PromptBuilder: {
    buildSystemPrompt: vi.fn(() => 'prompt')
  }
}));

vi.mock('../core/security/permissions', () => ({
  PermissionGuard: class {}
}));

vi.mock('../core/security/policyConstants', () => ({
  SUPPORTED_SKILL_SCRIPT_EXTENSIONS: ['.js', '.py', '.sh']
}));

vi.mock('../core/tools/filesystem', () => ({
  ReadFileTool: {},
  WriteFileTool: {},
  ListDirectoryTool: {},
  DeleteFileTool: {}
}));

vi.mock('../core/tools/shell', () => ({
  createExecuteCommandTool: vi.fn(() => ({}))
}));

vi.mock('../core/tools/system', () => ({
  SystemInfoTool: {}
}));

vi.mock('../core/tools/web', () => ({
  WebSearchTool: {},
  FetchWebpageTool: {},
  HttpRequestTool: {}
}));

vi.mock('../store/audit', () => ({
  addAuditLog: vi.fn()
}));

vi.mock('../store/config', () => ({
  getAgent: vi.fn(),
  getModelForAgent: vi.fn()
}));

vi.mock('../core/plugins/manager', () => ({
  pluginManager: {
    loadAllTools: vi.fn(async () => [])
  }
}));

vi.mock('../core/skills/manager', () => ({
  skillsManager: skillsManagerMock
}));

describe('createListAvailableSkillsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns public and agent skill breakdown for the current agent', async () => {
    skillsManagerMock.listPublicSkills.mockResolvedValue([
      { id: 'find-skills', name: 'find-skills', description: 'discover skills', source: 'public' }
    ]);
    skillsManagerMock.listAgentSkills.mockResolvedValue([
      { id: 'workspace-helper', name: 'workspace-helper', description: 'workspace only', source: 'agent' }
    ]);
    skillsManagerMock.listMergedSkills.mockResolvedValue([
      { id: 'find-skills', name: 'find-skills', description: 'discover skills', source: 'public' },
      { id: 'workspace-helper', name: 'workspace-helper', description: 'workspace only', source: 'agent' }
    ]);

    const { createListAvailableSkillsTool } = await import('./agentRuntime');
    const tool = createListAvailableSkillsTool('mainAgent');
    const result = await tool.execute({});

    expect(skillsManagerMock.listPublicSkills).toHaveBeenCalledTimes(1);
    expect(skillsManagerMock.listAgentSkills).toHaveBeenCalledWith('mainAgent');
    expect(skillsManagerMock.listMergedSkills).toHaveBeenCalledWith('mainAgent');
    expect(result).toEqual(expect.objectContaining({
      __toolResult: true,
      ok: true,
      data: expect.objectContaining({
        counts: {
          public: 1,
          agent: 1,
          totalAvailable: 2,
          hidden: 0
        },
        publicSkills: [
          expect.objectContaining({ id: 'find-skills', source: 'public' })
        ],
        agentSkills: [
          expect.objectContaining({ id: 'workspace-helper', source: 'agent' })
        ],
        availableSkills: [
          expect.objectContaining({ id: 'find-skills', source: 'public' }),
          expect.objectContaining({ id: 'workspace-helper', source: 'agent' })
        ]
      })
    }));
  });
});
