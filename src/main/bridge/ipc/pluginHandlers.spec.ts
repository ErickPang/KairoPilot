import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(channel, handler);
  })
}));

const pluginManagerMocks = vi.hoisted(() => ({
  getStorePlugins: vi.fn(async () => []),
  getInstalledPlugins: vi.fn(async () => []),
  installPlugin: vi.fn(async () => true),
  setPluginEnabled: vi.fn(async () => true),
  uninstallPlugin: vi.fn(async () => true)
}));

const auditMocks = vi.hoisted(() => ({
  addAuditLog: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle
  }
}));

vi.mock('../../core/plugins/manager', () => ({
  pluginManager: pluginManagerMocks
}));

vi.mock('../../store/audit', () => ({
  addAuditLog: auditMocks.addAuditLog
}));
vi.mock('../../store/taskPages', () => ({ getActiveSessionSummary: () => null }));
vi.mock('../../services/projectService', () => ({ permissionGuardForSession: vi.fn() }));
vi.mock('../../services/workbenchExecution', () => ({ assertTaskMutable: vi.fn() }));

import { KAIRO_INVOKE } from '../../../shared/ipc';
import { registerPluginHandlers } from './pluginHandlers';

describe('pluginHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    electronMocks.handle.mockClear();
    pluginManagerMocks.getStorePlugins.mockReset();
    pluginManagerMocks.getInstalledPlugins.mockReset();
    pluginManagerMocks.installPlugin.mockReset();
    pluginManagerMocks.setPluginEnabled.mockReset();
    pluginManagerMocks.uninstallPlugin.mockReset();
    auditMocks.addAuditLog.mockReset();

    pluginManagerMocks.getStorePlugins.mockResolvedValue([]);
    pluginManagerMocks.getInstalledPlugins.mockResolvedValue([]);
    pluginManagerMocks.installPlugin.mockResolvedValue(true);
    pluginManagerMocks.setPluginEnabled.mockResolvedValue(true);
    pluginManagerMocks.uninstallPlugin.mockResolvedValue(true);

    registerPluginHandlers();
  });

  it('records plugin install audit entries', async () => {
    const handler = registeredHandlers.get(KAIRO_INVOKE.pluginsInstall);
    const result = await handler?.({}, {
      id: 'kairo-weather-plugin',
      scope: 'public'
    });

    expect(result).toEqual({ success: true });
    expect(pluginManagerMocks.installPlugin).toHaveBeenCalledWith('kairo-weather-plugin', 'public');
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_install',
      args: {
        id: 'kairo-weather-plugin',
        scope: 'public'
      },
      result: { success: true },
      policyTags: ['plugin:install']
    });
  });

  it('records plugin uninstall failures', async () => {
    pluginManagerMocks.uninstallPlugin.mockRejectedValue(new Error('uninstall failed'));

    const handler = registeredHandlers.get(KAIRO_INVOKE.pluginsUninstall);
    const result = await handler?.({}, {
      id: 'kairo-weather-plugin',
      scope: 'public'
    });

    expect(result).toEqual({ success: false, error: 'uninstall failed' });
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_uninstall',
      args: {},
      error: 'uninstall failed',
      policyTags: ['plugin:uninstall', 'decision:error']
    });
  });

  it('records plugin enablement audit entries', async () => {
    const handler = registeredHandlers.get(KAIRO_INVOKE.pluginsSetEnabled);
    const result = await handler?.({}, {
      id: 'kairo-weather-plugin',
      scope: 'public',
      enabled: false
    });

    expect(result).toEqual({ success: true });
    expect(pluginManagerMocks.setPluginEnabled).toHaveBeenCalledWith('kairo-weather-plugin', 'public', false);
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_set_enabled',
      args: {
        id: 'kairo-weather-plugin',
        scope: 'public',
        enabled: false
      },
      result: { success: true },
      policyTags: ['plugin:configure', 'plugin:disable']
    });
  });
});
