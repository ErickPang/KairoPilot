import { describe, expect, it } from 'vitest';
import {
  AgentPermissionInputSchema,
  AppearanceConfigInputSchema,
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

  it('accepts explicit wildcard network access for workbench permissions', () => {
    const permissions = parseIpcInput(AgentPermissionInputSchema, permissionConfig, 'workbench permissions');
    expect(permissions.network.allowedDomains).toEqual(['*']);
  });

  it('rejects incomplete workbench permission policies', () => {
    expect(() => parseIpcInput(AgentPermissionInputSchema, {
      ...permissionConfig, policy: { approvalMode: 'never' }
    }, 'workbench permissions')).toThrow('Invalid workbench permissions');
  });
});
