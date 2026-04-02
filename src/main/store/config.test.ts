import { describe, expect, it } from 'vitest';
import { createAgentDraft } from './config';

describe('config permissions normalization', () => {
  it('在 chat_only 档位下清理不兼容的能力开关', () => {
    const draft = createAgentDraft({
      permissions: {
        executionProfile: 'chat_only',
        policy: {
          approvalMode: 'never',
          environmentScope: 'workspace',
          dataClass: 'public',
          redactSensitiveOutput: false
        },
        fileSystem: {
          read: true,
          write: true,
          allowedPaths: ['/tmp']
        },
        network: {
          enabled: true,
          allowedDomains: ['example.com']
        },
        shell: {
          enabled: true,
          allowedCommands: ['npm']
        }
      }
    });

    expect(draft.permissions.executionProfile).toBe('chat_only');
    expect(draft.permissions.fileSystem.read).toBe(false);
    expect(draft.permissions.fileSystem.write).toBe(false);
    expect(draft.permissions.network.enabled).toBe(false);
    expect(draft.permissions.shell.enabled).toBe(false);
    expect(draft.permissions.fileSystem.allowedPaths).toEqual(['/tmp']);
    expect(draft.permissions.network.allowedDomains).toEqual(['example.com']);
    expect(draft.permissions.shell.allowedCommands).toEqual(['npm']);
  });

  it('在 read_only_workspace 档位下保留读取能力但禁用写入与 shell', () => {
    const draft = createAgentDraft({
      permissions: {
        executionProfile: 'read_only_workspace',
        policy: {
          approvalMode: 'never',
          environmentScope: 'workspace',
          dataClass: 'public',
          redactSensitiveOutput: false
        },
        fileSystem: {
          read: true,
          write: true,
          allowedPaths: ['/tmp']
        },
        network: {
          enabled: true,
          allowedDomains: ['example.com']
        },
        shell: {
          enabled: true,
          allowedCommands: ['npm']
        }
      }
    });

    expect(draft.permissions.executionProfile).toBe('read_only_workspace');
    expect(draft.permissions.fileSystem.read).toBe(true);
    expect(draft.permissions.fileSystem.write).toBe(false);
    expect(draft.permissions.network.enabled).toBe(true);
    expect(draft.permissions.shell.enabled).toBe(false);
  });
});
