import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../core/plugins/manager', () => ({
  pluginManager: pluginManagerMocks
}));

vi.mock('../store/audit', () => ({
  addAuditLog: auditMocks.addAuditLog
}));

import {
  installPluginWithAudit,
  recordPluginInstallFailure,
  recordPluginSetEnabledFailure,
  setPluginEnabledWithAudit,
  uninstallPluginWithAudit
} from './pluginService';

describe('pluginService', () => {
  beforeEach(() => {
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
  });

  it('installs plugins and records success audit entries', async () => {
    await installPluginWithAudit({
      id: 'kairo-weather-plugin',
      scope: 'public'
    });

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

  it('uninstalls plugins and records success audit entries', async () => {
    await uninstallPluginWithAudit({
      id: 'kairo-weather-plugin',
      scope: 'workspace'
    });

    expect(pluginManagerMocks.uninstallPlugin).toHaveBeenCalledWith('kairo-weather-plugin', 'workspace');
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_uninstall',
      args: {
        id: 'kairo-weather-plugin',
        scope: 'workspace'
      },
      result: { success: true },
      policyTags: ['plugin:uninstall']
    });
  });

  it('updates plugin enabled state and records success audit entries', async () => {
    await setPluginEnabledWithAudit({
      id: 'kairo-weather-plugin',
      scope: 'public',
      enabled: false
    });

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

  it('records plugin install failures', () => {
    recordPluginInstallFailure('install failed');

    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_install',
      args: {},
      error: 'install failed',
      policyTags: ['plugin:install', 'decision:error']
    });
  });

  it('records plugin enabled state update failures', () => {
    recordPluginSetEnabledFailure('update failed');

    expect(auditMocks.addAuditLog).toHaveBeenCalledWith({
      tool: 'plugin_set_enabled',
      args: {},
      error: 'update failed',
      policyTags: ['plugin:configure', 'decision:error']
    });
  });
});
