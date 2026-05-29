import { describe, expect, it } from 'vitest';
import {
  AgentConfigInputSchema,
  DeleteAgentInputSchema,
  AgentInitInputSchema,
  AppearanceConfigInputSchema,
  IdInputSchema,
  LlmProviderInputSchema,
  ModelConfigInputSchema,
  parseIpcInput
} from './configValidation';

const permissionConfig = {
  executionProfile: 'approved_execution',
  policy: {
    approvalMode: 'on_external',
    environmentScope: 'allowed_paths',
    dataClass: 'project',
    redactSensitiveOutput: true
  },
  fileSystem: {
    read: true,
    write: false,
    allowedPaths: ['/tmp/project']
  },
  network: {
    enabled: true,
    allowedDomains: ['*']
  },
  shell: {
    enabled: true,
    allowedCommands: ['npm']
  }
};

describe('configValidation', () => {
  it('rejects invalid provider keys before model config persistence', () => {
    expect(() => parseIpcInput(ModelConfigInputSchema, {
      id: '../bad',
      name: 'Bad',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o'
    }, 'model config')).toThrow('Invalid model config');
  });

  it('rejects unsupported appearance themes', () => {
    expect(() => parseIpcInput(AppearanceConfigInputSchema, {
      theme: 'neon'
    }, 'appearance config')).toThrow('Invalid appearance config');
  });

  it('allows transient provider checks before a provider id is assigned', () => {
    const payload = parseIpcInput(LlmProviderInputSchema, {
      id: '',
      provider: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: ''
    }, 'model provider config');

    expect(payload.id).toBeUndefined();
    expect(payload.provider).toBe('openai');
  });

  it('rejects empty ids used by destructive config actions', () => {
    expect(() => parseIpcInput(IdInputSchema, '', 'agent id')).toThrow('Invalid agent id');
  });

  it('requires explicit workspace deletion confirmation when deleting an agent workspace', () => {
    expect(() => parseIpcInput(DeleteAgentInputSchema, {
      id: 'agent-1',
      deleteWorkspace: true
    }, 'agent delete request')).toThrow('Invalid agent delete request');

    expect(parseIpcInput(DeleteAgentInputSchema, {
      id: 'agent-1',
      deleteWorkspace: true,
      confirmation: 'delete-agent:agent-1:workspace'
    }, 'agent delete request')).toEqual({
      id: 'agent-1',
      deleteWorkspace: true,
      confirmation: 'delete-agent:agent-1:workspace'
    });
  });

  it('accepts complete agent configs with explicit wildcard network access', () => {
    const agent = parseIpcInput(AgentConfigInputSchema, {
      id: 'agent-1',
      name: 'Agent',
      workspace: '/tmp/workspace',
      systemPrompt: '',
      identityPrompt: '',
      userPrompt: '',
      soulPrompt: '',
      model: 'openai/gpt-4o',
      permissions: permissionConfig
    }, 'agent config');

    expect(agent.permissions.network.allowedDomains).toEqual(['*']);
  });

  it('rejects unsupported agent init payload shapes', () => {
    expect(() => parseIpcInput(AgentInitInputSchema, {
      agentId: 'agent-1'
    }, 'agent init request')).toThrow('Invalid agent init request');
  });
});
