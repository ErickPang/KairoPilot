import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DEFAULT_CONFIG} from './configDefaults';
import {loadKairoPilotConfigFromDisk} from './configRepository';
import { describe, expect, it } from 'vitest';
import {
  redactKairoPilotConfigSecrets
} from './config';
import { normalizeAgentPermissions } from './configPermissionUtils';
const normalizeDraft = (seed: Parameters<typeof normalizeAgentPermissions>[0]) => ({ permissions: normalizeAgentPermissions(seed) });

describe('config permissions normalization', () => {

  it('在 chat_only 档位下清理不兼容的能力开关', () => {
    const draft = normalizeDraft({
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
    expect(draft.permissions.shell.allowedCommands).toEqual([]);
  });

  it('在 read_only_workspace 档位下保留读取能力但禁用写入与 shell', () => {
    const draft = normalizeDraft({
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
    expect(draft.permissions.shell.allowedCommands).toEqual([]);
  });

  it('手动关闭 shell 时同步清空命令白名单', () => {
    const draft = normalizeDraft({
      permissions: {
        executionProfile: 'approved_execution',
        policy: {
          approvalMode: 'on_write',
          environmentScope: 'workspace',
          dataClass: 'project',
          redactSensitiveOutput: true
        },
        fileSystem: {
          read: true,
          write: false,
          allowedPaths: []
        },
        network: {
          enabled: false,
          allowedDomains: []
        },
        shell: {
          enabled: false,
          allowedCommands: ['npm', 'git']
        }
      }
    });

    expect(draft.permissions.shell.enabled).toBe(false);
    expect(draft.permissions.shell.allowedCommands).toEqual([]);
  });

  it('返回给渲染进程的配置会隐藏已保存密钥', () => {
    const redacted = redactKairoPilotConfigSecrets({
      version: '3.1.0',
      models: {
        providers: {
          openai: {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
            apiKeyEncrypted: 'safe-storage:v1:test',
            model: [{ id: 'gpt-4o', name: 'gpt-4o' }]
          }
        }
      },
      plugins: {
        registry: []
      },
      skills: {
        registry: []
      },
      appearance: {
        theme: 'system'
      },
      webSearch: {
        timeoutMs: 10000,
        preferredProviders: ['tavily'],
        providers: {
          searxng: { enabled: false, baseUrl: '' },
          tavily: {
            enabled: true,
            baseUrl: 'https://api.tavily.com',
            apiKey: 'tvly-test',
            apiKeyEncrypted: 'safe-storage:v1:tavily'
          },
          bing: { enabled: false },
          duckduckgo: { enabled: false },
          baidu: { enabled: false }
        }
      }
    });

    expect(redacted.models.providers.openai.apiKey).toBe('');
    expect(redacted.models.providers.openai.apiKeyEncrypted).toBeUndefined();
    expect(redacted.models.providers.openai.apiKeyStored).toBe(true);
    expect(redacted.webSearch.providers.tavily.apiKey).toBe('');
    expect(redacted.webSearch.providers.tavily.apiKeyEncrypted).toBeUndefined();
    expect(redacted.webSearch.providers.tavily.apiKeyStored).toBe(true);
  });
});

describe('current configuration format',()=>{
 it('does not create files when reading missing or current configuration',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'kairo-current-config-'));try{const file=path.join(root,'config.json');const fresh=loadKairoPilotConfigFromDisk(file);expect(fresh.source).toBe('default');expect(fresh.config).not.toHaveProperty('agents');expect(fs.existsSync(file)).toBe(false);const current=structuredClone(DEFAULT_CONFIG);current.workbench!.managementRoot=path.join(root,'workbench');fs.writeFileSync(file,JSON.stringify(current));expect(loadKairoPilotConfigFromDisk(file).config.workbench!.managementRoot).toBe(current.workbench!.managementRoot);expect(fs.existsSync(current.workbench!.managementRoot)).toBe(false);}finally{fs.rmSync(root,{recursive:true,force:true});}});
 it('rejects unsupported configuration without changing the file',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'kairo-invalid-config-'));try{const file=path.join(root,'config.json');const content=JSON.stringify({version:'1.0.0'});fs.writeFileSync(file,content);expect(()=>loadKairoPilotConfigFromDisk(file)).toThrow('Unable to read configuration safely');expect(fs.readFileSync(file,'utf8')).toBe(content);expect(fs.readdirSync(root)).toEqual(['config.json']);}finally{fs.rmSync(root,{recursive:true,force:true});}});
});
