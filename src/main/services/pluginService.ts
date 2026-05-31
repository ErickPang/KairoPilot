import { pluginManager } from '../core/plugins/manager';
import { addAuditLog } from '../store/audit';

export interface PluginActionPayload {
  id: string;
  scope: string;
}

export async function getStorePlugins() {
  return pluginManager.getStorePlugins();
}

export async function getStorePluginsByRegistry(url: string) {
  return pluginManager.getRemoteStorePlugins(url);
}

export async function getInstalledPlugins() {
  return pluginManager.getInstalledPlugins();
}

export async function preparePluginInstallReview(payload: { id: string; scope: string; registryUrl?: string }) {
  return pluginManager.preparePluginInstallReview(payload);
}

export async function preparePluginUpdateReview(payload: { id: string; scope: string; registryUrl?: string }) {
  return pluginManager.preparePluginUpdateReview(payload);
}

export async function preparePluginImportReview(payload: { sourceFile: string; scope: string }) {
  return pluginManager.preparePluginImportReview(payload);
}

export async function installReviewedPluginWithAudit(payload: { requestId: string }) {
  await pluginManager.installReviewedPlugin(payload);
  addAuditLog({
    tool: 'plugin_install_reviewed',
    args: { ...payload },
    result: { success: true },
    policyTags: ['plugin:install', 'plugin:reviewed']
  });
}

export async function discardPluginInstallReview(payload: { requestId: string }) {
  pluginManager.discardPreparedPluginInstall(payload);
}

export async function rollbackPluginWithAudit(payload: PluginActionPayload) {
  await pluginManager.rollbackPlugin(payload);
  addAuditLog({
    tool: 'plugin_rollback',
    args: { ...payload },
    result: { success: true },
    policyTags: ['plugin:rollback']
  });
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

export interface PluginSetEnabledPayload extends PluginActionPayload {
  enabled: boolean;
}

export async function setPluginEnabledWithAudit(payload: PluginSetEnabledPayload) {
  await pluginManager.setPluginEnabled(payload.id, payload.scope, payload.enabled);
  addAuditLog({
    tool: 'plugin_set_enabled',
    args: { ...payload },
    result: { success: true },
    policyTags: ['plugin:configure', payload.enabled ? 'plugin:enable' : 'plugin:disable']
  });
}

export function recordPluginSetEnabledFailure(error: string) {
  addAuditLog({
    tool: 'plugin_set_enabled',
    args: {},
    error,
    policyTags: ['plugin:configure', 'decision:error']
  });
}

export function recordPluginReviewedInstallFailure(error: string) {
  addAuditLog({
    tool: 'plugin_install_reviewed',
    args: {},
    error,
    policyTags: ['plugin:install', 'plugin:reviewed', 'decision:error']
  });
}

export function recordPluginRollbackFailure(error: string) {
  addAuditLog({
    tool: 'plugin_rollback',
    args: {},
    error,
    policyTags: ['plugin:rollback', 'decision:error']
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
