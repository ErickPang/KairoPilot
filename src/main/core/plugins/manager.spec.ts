import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  access: vi.fn(async () => undefined),
  stat: vi.fn(async () => ({ isDirectory: () => false })),
  readFile: vi.fn(async () => ''),
  writeFile: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined)
}));

const configMocks = vi.hoisted(() => ({
  getPluginRegistry: vi.fn((): unknown[] => []),
  savePluginRegistry: vi.fn()
}));

const auditMocks = vi.hoisted(() => ({
  addAuditLog: vi.fn()
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/kairopilot-test')
  }
}));

vi.mock('fs/promises', () => ({
  default: fsMocks
}));

vi.mock('../../store/config', () => ({
  getPluginRegistry: configMocks.getPluginRegistry,
  savePluginRegistry: configMocks.savePluginRegistry
}));

vi.mock('../../store/audit', () => ({
  addAuditLog: auditMocks.addAuditLog
}));

import { PluginManager, pluginManager } from './manager';
import { PermissionGuard } from '../security/permissions';

const installedPlugin = {
  id: 'broken-plugin',
  name: 'Broken Plugin',
  description: 'Broken plugin for tests.',
  version: '1.0.0',
  author: 'KairoPilot',
  installedAt: 1000,
  filePath: '/tmp/kairopilot-test/plugins/broken-plugin_public.js',
  scope: 'public'
};

describe('PluginManager audit visibility', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    fsMocks.mkdir.mockReset();
    fsMocks.access.mockReset();
    fsMocks.stat.mockReset();
    fsMocks.readFile.mockReset();
    fsMocks.writeFile.mockReset();
    fsMocks.unlink.mockReset();
    fsMocks.rm.mockReset();
    configMocks.getPluginRegistry.mockReset();
    configMocks.savePluginRegistry.mockReset();
    auditMocks.addAuditLog.mockReset();

    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.access.mockResolvedValue(undefined);
    fsMocks.stat.mockResolvedValue({ isDirectory: () => false });
    fsMocks.readFile.mockResolvedValue('');
    configMocks.getPluginRegistry.mockReturnValue([installedPlugin]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('audits plugin load failures', async () => {
    fsMocks.readFile.mockRejectedValue(new Error('read failed'));

    const tools = await pluginManager.loadAllTools();

    expect(tools).toEqual([]);
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_load_failed',
      args: {
        pluginId: 'broken-plugin',
        scope: 'public',
        filePath: '/tmp/kairopilot-test/plugins/broken-plugin_public.js'
      },
      error: 'read failed',
      policyTags: ['plugin:load', 'decision:error']
    });
  });

  it('returns store manifests with tool and capability declarations', async () => {
    const plugins = await pluginManager.getStorePlugins();

    expect(plugins[0]).toMatchObject({
      id: 'kairo-weather-plugin',
      riskLevel: 'low',
      tools: [
        expect.objectContaining({ name: 'get_weather_forecast' })
      ],
      capabilities: [
        expect.objectContaining({ id: 'local-demo-data', riskLevel: 'low' })
      ]
    });
  });

  it('attaches plugin metadata to loaded tools', async () => {
    fsMocks.readFile.mockResolvedValue(`
module.exports.tools = [
  {
    name: 'good_tool',
    description: 'Good tool.',
    parameters: z.object({ value: z.string() }),
    execute: async ({ value }) => ({ value })
  }
];
`);

    const tools = await pluginManager.loadAllTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].metadata).toEqual({
      source: 'plugin',
      pluginId: 'broken-plugin',
      pluginName: 'Broken Plugin',
      pluginScope: 'public',
      riskLevel: 'low'
    });
  });

  it('executes plugin tools inside an isolated worker', async () => {
    fsMocks.readFile.mockResolvedValue(`
module.exports.tools = [
  {
    name: 'good_tool',
    description: 'Good tool.',
    parameters: z.object({ value: z.string() }),
    execute: async ({ value }) => ({ value, processType: typeof process })
  }
];
`);

    const tools = await pluginManager.loadAllTools();

    await expect(tools[0].execute({ value: 'ok' })).resolves.toEqual({
      value: 'ok',
      processType: 'undefined'
    });
  });

  it('terminates plugin workers that block during execution', async () => {
    fsMocks.readFile.mockResolvedValue(`
module.exports.tools = [
  {
    name: 'blocking_tool',
    description: 'Blocking tool.',
    parameters: z.object({}),
    execute: () => {
      while (true) {}
    }
  }
];
`);

    const isolatedPluginManager = new PluginManager({ executeTimeoutMs: 50 });
    const tools = await isolatedPluginManager.loadAllTools();

    await expect(tools[0].execute({})).rejects.toThrow('Plugin tool timed out after 50ms.');
  });

  it('audits invalid plugin tool exports', async () => {
    fsMocks.readFile.mockResolvedValue(`
module.exports.tools = [
  {
    name: 'broken_tool',
    description: 'Broken tool.',
    parameters: {},
    execute: async () => ({ ok: true })
  }
];
`);

    const tools = await pluginManager.loadAllTools();

    expect(tools).toEqual([]);
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'plugin_tool_invalid',
      args: {
        pluginId: 'broken-plugin',
        scope: 'public',
        toolName: 'broken_tool'
      },
      policyTags: ['plugin:load', 'plugin:tool', 'decision:error']
    }));
  });

  it('blocks plugins whose declared permissions exceed the active agent policy', async () => {
    configMocks.getPluginRegistry.mockReturnValue([{
      ...installedPlugin,
      capabilities: [
        {
          id: 'external-api',
          label: 'External API',
          riskLevel: 'medium',
          requiredPermissions: {
            network: {
              enabled: true,
              domains: ['api.example.com']
            }
          }
        }
      ]
    }]);
    const permissions = new PermissionGuard({
      executionProfile: 'chat_only',
      fileSystem: { read: false, write: false, allowedPaths: [] },
      network: { enabled: false, allowedDomains: [] },
      shell: { enabled: false, allowedCommands: [] }
    });

    const tools = await pluginManager.loadAllTools('agent-1', permissions);

    expect(tools).toEqual([]);
    expect(fsMocks.readFile).not.toHaveBeenCalled();
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_permission_denied',
      args: {
        pluginId: 'broken-plugin',
        scope: 'public',
        deniedRequirements: [
          'capability:external-api:network.enabled',
          'capability:external-api:network.domain:api.example.com'
        ]
      },
      error: 'Plugin requested permissions outside the active agent policy.',
      policyTags: ['plugin:permission', 'plugin:broken-plugin', 'plugin_scope:public', 'decision:deny']
    });
  });

  it('rejects tools that are not declared in the plugin manifest', async () => {
    configMocks.getPluginRegistry.mockReturnValue([{
      ...installedPlugin,
      tools: [
        { name: 'declared_tool', description: 'Declared tool.' }
      ]
    }]);
    fsMocks.readFile.mockResolvedValue(`
module.exports.tools = [
  {
    name: 'undeclared_tool',
    description: 'Undeclared tool.',
    parameters: z.object({}),
    execute: async () => ({ ok: true })
  }
];
`);

    const tools = await pluginManager.loadAllTools();

    expect(tools).toEqual([]);
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'plugin_tool_invalid',
      args: {
        pluginId: 'broken-plugin',
        scope: 'public',
        toolName: 'undeclared_tool'
      },
      policyTags: ['plugin:load', 'plugin:tool', 'decision:error']
    }));
  });

  it('skips plugin files that exceed the sandbox code size limit', async () => {
    fsMocks.readFile.mockResolvedValue('x'.repeat(256 * 1024 + 1));

    const tools = await pluginManager.loadAllTools();

    expect(tools).toEqual([]);
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_code_too_large',
      args: {
        pluginId: 'broken-plugin',
        scope: 'public',
        filePath: '/tmp/kairopilot-test/plugins/broken-plugin_public.js',
        maxBytes: 256 * 1024
      },
      error: 'Plugin code exceeded the maximum load size.',
      policyTags: ['plugin:load', 'plugin:sandbox', 'decision:deny']
    });
  });
});
