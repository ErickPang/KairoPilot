import { pluginManager } from '../core/plugins/manager';
import { addAuditLog } from '../store/audit';

export interface PluginActionPayload {
  id: string;
  scope: string;
}

export async function getStorePlugins() {
  return pluginManager.getStorePlugins();
}

export async function getInstalledPlugins() {
  return pluginManager.getInstalledPlugins();
}

export async function installPluginWithAudit(payload: PluginActionPayload) {
  await pluginManager.installPlugin(payload.id, payload.scope);
  addAuditLog({
    tool: 'plugin_install',
    args: { ...payload },
    result: { success: true },
    policyTags: ['plugin:install']
  });
}

export function recordPluginInstallFailure(error: string) {
  addAuditLog({
    tool: 'plugin_install',
    args: {},
    error,
    policyTags: ['plugin:install', 'decision:error']
  });
}

export async function uninstallPluginWithAudit(payload: PluginActionPayload) {
  await pluginManager.uninstallPlugin(payload.id, payload.scope);
  addAuditLog({
    tool: 'plugin_uninstall',
    args: { ...payload },
    result: { success: true },
    policyTags: ['plugin:uninstall']
  });
}

export function recordPluginUninstallFailure(error: string) {
  addAuditLog({
    tool: 'plugin_uninstall',
    args: {},
    error,
    policyTags: ['plugin:uninstall', 'decision:error']
  });
}
