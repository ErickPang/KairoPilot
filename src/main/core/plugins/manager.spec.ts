import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  access: vi.fn(async () => undefined),
  stat: vi.fn(async () => ({ isDirectory: () => false })),
  readFile: vi.fn(async () => ''),
  writeFile: vi.fn(async () => undefined),
  copyFile: vi.fn(async () => undefined),
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
    fsMocks.copyFile.mockReset();
    fsMocks.unlink.mockReset();
    fsMocks.rm.mockReset();
    configMocks.getPluginRegistry.mockReset();
    configMocks.savePluginRegistry.mockReset();
    auditMocks.addAuditLog.mockReset();

    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.access.mockResolvedValue(undefined);
    fsMocks.stat.mockResolvedValue({ isDirectory: () => false });
    fsMocks.readFile.mockResolvedValue('');
    fsMocks.copyFile.mockResolvedValue(undefined);
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
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      riskLevel: 'low',
      tools: [
        expect.objectContaining({ name: 'get_weather_forecast' })
      ],
      capabilities: [
        expect.objectContaining({ id: 'local-demo-data', riskLevel: 'low' })
      ]
    });
  });

  it('records plugin code hash when installing store plugins', async () => {
    await pluginManager.installPlugin('kairo-weather-plugin', 'public');

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      '/tmp/kairopilot-test/plugins/kairo-weather-plugin_public.js',
      expect.stringContaining('get_weather_forecast'),
      'utf-8'
    );
    expect(configMocks.savePluginRegistry).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'broken-plugin'
      }),
      expect.objectContaining({
        id: 'kairo-weather-plugin',
        scope: 'public',
        codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        source: {
          type: 'builtin-store',
          id: 'kairo-weather-plugin'
        },
        enabled: true
      })
    ]);
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

  it('validates plugin tool arguments inside the execution worker', async () => {
    fsMocks.readFile.mockResolvedValue(`
module.exports.tools = [
  {
    name: 'strict_tool',
    description: 'Strict tool.',
    parameters: z.object({ value: z.string() }),
    execute: async ({ value }) => ({ value })
  }
];
`);

    const tools = await pluginManager.loadAllTools();

    await expect(tools[0].execute({ value: 123 })).rejects.toThrow(
      'Invalid plugin tool arguments for strict_tool: value: Invalid input: expected string, received number'
    );
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

  it('filters individual plugin tools whose permissions exceed the active agent policy', async () => {
    configMocks.getPluginRegistry.mockReturnValue([{
      ...installedPlugin,
      tools: [
        {
          name: 'network_tool',
          description: 'Network tool.',
          requiredPermissions: {
            network: {
              enabled: true
            }
          }
        },
        {
          name: 'local_tool',
          description: 'Local tool.'
        }
      ]
    }]);
    fsMocks.readFile.mockResolvedValue(`
module.exports.tools = [
  {
    name: 'network_tool',
    description: 'Network tool.',
    parameters: z.object({}),
    execute: async () => ({ ok: true })
  },
  {
    name: 'local_tool',
    description: 'Local tool.',
    parameters: z.object({}),
    execute: async () => ({ ok: true })
  }
];
`);
    const permissions = new PermissionGuard({
      executionProfile: 'read_only_workspace',
      fileSystem: { read: true, write: false, allowedPaths: ['/tmp/kairopilot-test'] },
      network: { enabled: false, allowedDomains: [] },
      shell: { enabled: false, allowedCommands: [] }
    });

    const tools = await pluginManager.loadAllTools('agent-1', permissions);

    expect(tools.map((tool) => tool.name)).toEqual(['local_tool']);
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'plugin_tool_permission_denied',
      args: {
        pluginId: 'broken-plugin',
        scope: 'public',
        toolName: 'network_tool',
        deniedRequirements: ['tool:network_tool:network.enabled']
      }
    }));
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

  it('blocks plugins whose code hash no longer matches the registry record', async () => {
    const code = `
module.exports.tools = [
  {
    name: 'good_tool',
    description: 'Good tool.',
    parameters: z.object({}),
    execute: async () => ({ ok: true })
  }
];
`;
    const actualHash = createHash('sha256').update(code).digest('hex');
    configMocks.getPluginRegistry.mockReturnValue([{
      ...installedPlugin,
      codeHash: '0'.repeat(64)
    }]);
    fsMocks.readFile.mockResolvedValue(code);

    const tools = await pluginManager.loadAllTools();

    expect(tools).toEqual([]);
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_integrity_failed',
      args: {
        pluginId: 'broken-plugin',
        scope: 'public',
        filePath: '/tmp/kairopilot-test/plugins/broken-plugin_public.js',
        expectedHash: '0'.repeat(64),
        actualHash
      },
      error: 'Plugin code hash does not match the installed registry record.',
      policyTags: ['plugin:load', 'plugin:integrity', 'decision:deny']
    });
  });

  it('updates plugin enabled state in the registry', async () => {
    await pluginManager.setPluginEnabled('broken-plugin', 'public', false);

    expect(configMocks.savePluginRegistry).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'broken-plugin',
        scope: 'public',
        enabled: false
      })
    ]);
  });

  it('skips disabled plugins when loading tools', async () => {
    configMocks.getPluginRegistry.mockReturnValue([{
      ...installedPlugin,
      enabled: false
    }]);
    fsMocks.readFile.mockResolvedValue(`
module.exports.tools = [
  {
    name: 'good_tool',
    description: 'Good tool.',
    parameters: z.object({}),
    execute: async () => ({ ok: true })
  }
];
`);

    const tools = await pluginManager.loadAllTools();

    expect(tools).toEqual([]);
    expect(fsMocks.readFile).not.toHaveBeenCalled();
  });

  it('prepares and installs reviewed store plugins', async () => {
    const review = await pluginManager.preparePluginInstallReview({
      id: 'kairo-weather-plugin',
      scope: 'public'
    });

    expect(review).toMatchObject({
      pluginId: 'kairo-weather-plugin',
      operation: 'install',
      recommendation: 'allow',
      codeHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });

    await pluginManager.installReviewedPlugin({ requestId: review.requestId });

    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      '/tmp/kairopilot-test/plugins/kairo-weather-plugin_public.js',
      expect.stringContaining('get_weather_forecast'),
      'utf-8'
    );
    expect(configMocks.savePluginRegistry).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'broken-plugin' }),
      expect.objectContaining({
        id: 'kairo-weather-plugin',
        scope: 'public',
        codeHash: review.codeHash,
        enabled: true
      })
    ]);
  });

  it('prepares update reviews with version diffs and stores rollback snapshots', async () => {
    configMocks.getPluginRegistry.mockReturnValue([{
      ...installedPlugin,
      id: 'kairo-weather-plugin',
      name: 'Weather Forecaster',
      version: '0.9.0',
      author: 'KairoPilot',
      filePath: '/tmp/kairopilot-test/plugins/kairo-weather-plugin_public.js',
      tools: [{ name: 'old_tool', description: 'Old tool.' }],
      capabilities: [],
      riskLevel: 'low',
      codeHash: '1'.repeat(64)
    }]);

    const review = await pluginManager.preparePluginUpdateReview({
      id: 'kairo-weather-plugin',
      scope: 'public'
    });

    expect(review.versionDiff).toMatchObject({
      fromVersion: '0.9.0',
      toVersion: '1.0.0',
      toolChanges: {
        added: ['get_weather_forecast'],
        removed: ['old_tool']
      }
    });

    await pluginManager.installReviewedPlugin({ requestId: review.requestId });

    expect(fsMocks.copyFile).toHaveBeenCalledWith(
      '/tmp/kairopilot-test/plugins/kairo-weather-plugin_public.js',
      expect.stringContaining('/tmp/kairopilot-test/plugin-backups/kairo-weather-plugin_public_')
    );
    expect(configMocks.savePluginRegistry).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'kairo-weather-plugin',
        version: '1.0.0',
        previousVersion: expect.objectContaining({
          version: '0.9.0',
          codeHash: '1'.repeat(64),
          manifest: expect.objectContaining({
            version: '0.9.0'
          })
        })
      })
    ]);
  });

  it('rolls back plugins to the previous snapshot', async () => {
    configMocks.getPluginRegistry.mockReturnValue([{
      ...installedPlugin,
      id: 'kairo-weather-plugin',
      version: '1.0.0',
      filePath: '/tmp/kairopilot-test/plugins/kairo-weather-plugin_public.js',
      codeHash: '2'.repeat(64),
      previousVersion: {
        version: '0.9.0',
        filePath: '/tmp/kairopilot-test/plugin-backups/kairo-weather-plugin_public_backup.js',
        codeHash: '1'.repeat(64),
        backedUpAt: 2000,
        manifest: {
          id: 'kairo-weather-plugin',
          name: 'Weather Forecaster',
          description: 'Previous weather plugin.',
          version: '0.9.0',
          author: 'KairoPilot',
          tools: [{ name: 'old_tool', description: 'Old tool.' }],
          capabilities: [],
          riskLevel: 'low'
        }
      }
    }]);

    await pluginManager.rollbackPlugin({
      id: 'kairo-weather-plugin',
      scope: 'public'
    });

    expect(fsMocks.copyFile).toHaveBeenCalledWith(
      '/tmp/kairopilot-test/plugin-backups/kairo-weather-plugin_public_backup.js',
      '/tmp/kairopilot-test/plugins/kairo-weather-plugin_public.js'
    );
    expect(configMocks.savePluginRegistry).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'kairo-weather-plugin',
        version: '0.9.0',
        codeHash: '1'.repeat(64),
        previousVersion: undefined
      })
    ]);
  });
});
