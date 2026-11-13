import { ipcMain } from 'electron';
import {
  getInstalledPlugins,
  getStorePluginsByRegistry,
  getStorePlugins,
  installPluginWithAudit,
  installReviewedPluginWithAudit,
  preparePluginImportReview,
  preparePluginInstallReview,
  preparePluginUpdateReview,
  discardPluginInstallReview,
  recordPluginInstallFailure,
  recordPluginReviewedInstallFailure,
  recordPluginRollbackFailure,
  recordPluginSetEnabledFailure,
  recordPluginUninstallFailure,
  rollbackPluginWithAudit,
  setPluginEnabledWithAudit,
  uninstallPluginWithAudit
} from '../../services/pluginService';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import { parseIpcInput } from './configValidation';
import {
  PluginActionInputSchema,
  PluginPrepareImportInputSchema,
  PluginPrepareInstallInputSchema,
  PluginRegistryUrlInputSchema,
  PluginRequestInputSchema,
  PluginRollbackInputSchema,
  PluginSetEnabledInputSchema
} from './skillPluginValidation';
import { ipcFailure, ipcSuccess } from './ipcResult';
import { z } from 'zod';
import { pluginManager } from '../../core/plugins/manager';
import { getActiveSessionSummary } from '../../store/taskPages';
import { permissionGuardForSession } from '../../services/projectService';
import { assertTaskMutable } from '../../services/workbenchExecution';
import { addAuditLog } from '../../store/audit';

const ConnectionInput = z.object({ id: z.string().min(1), scope: z.string().min(1), sessionId: z.string().min(1), connectionId: z.string().min(1).optional(), expectedHash: z.string().optional(), catalogHash: z.string().optional(), token: z.string().max(16000).optional() }).strict();
function connectionContext(sessionId: string, mutable = false) {
  const task = getActiveSessionSummary(undefined);
  if (!task || task.id !== sessionId || task.archivedAt) throw new Error('Select the active, unarchived task before changing a connection.');
  if (mutable) assertTaskMutable(task.id);
  return { sessionId, guard: permissionGuardForSession(task) };
}

function registerPluginHandlers() {
  ipcMain.handle(KAIRO_INVOKE.pluginsConnectionList, async (_, value) => {
    const input = ConnectionInput.parse(value);
    return pluginManager.connectionStates(input.id, input.scope, connectionContext(input.sessionId));
  });
  for (const [channel, action] of [[KAIRO_INVOKE.pluginsConnectionConnect, 'connect'], [KAIRO_INVOKE.pluginsConnectionApprove, 'approve'], [KAIRO_INVOKE.pluginsConnectionDisconnect, 'disconnect']] as const) {
    ipcMain.handle(channel, async (_, value) => {
      try {
        const input = ConnectionInput.parse(value); const context = connectionContext(input.sessionId, action !== 'disconnect');
        if (!input.connectionId) throw new Error('Connection ID is required.');
        let state;
        if (action === 'connect') {
          if (!input.expectedHash) throw new Error('Reviewed package hash is required.');
          state = await pluginManager.connect(input.id, input.scope, input.connectionId, input.expectedHash, context, input.token);
        } else if (action === 'approve') {
          if (!input.catalogHash) throw new Error('Reviewed catalog hash is required.');
          state = await pluginManager.approveCatalog(input.id, input.scope, input.connectionId, input.catalogHash, context);
        } else await pluginManager.disconnect(input.id, input.scope, input.sessionId, input.connectionId);
        addAuditLog({ tool: `plugin_connection_${action}`, args: { pluginId: input.id, scope: input.scope, connectionId: input.connectionId, packageHash: input.expectedHash, catalogHash: input.catalogHash }, sessionId: input.sessionId, result: { success: true }, policyTags: ['plugin:connection', `decision:${action}`] });
        return { success: true, state };
      } catch { return ipcFailure('MCP connection action failed. Check task permissions, package integrity, endpoint access and connection mode.'); }
    });
  }
  ipcMain.handle(KAIRO_INVOKE.pluginsGetStore, async () => {
    return getStorePlugins();
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsGetStoreByRegistry, async (_, args) => {
    const url = parseIpcInput(PluginRegistryUrlInputSchema, args, 'plugin registry URL');
    return getStorePluginsByRegistry(url);
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsGetInstalled, async () => {
    return getInstalledPlugins();
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsPrepareInstall, async (_, args) => {
    try {
      const payload = parseIpcInput(PluginPrepareInstallInputSchema, args, 'plugin install review request');
      return await preparePluginInstallReview(payload);
    } catch (e) {
      return ipcFailure(e);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsPrepareUpdate, async (_, args) => {
    try {
      const payload = parseIpcInput(PluginPrepareInstallInputSchema, args, 'plugin update review request');
      return await preparePluginUpdateReview(payload);
    } catch (e) {
      return ipcFailure(e);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsPrepareImport, async (_, args) => {
    try {
      const payload = parseIpcInput(PluginPrepareImportInputSchema, args, 'plugin import review request');
      return await preparePluginImportReview(payload);
    } catch (e) {
      return ipcFailure(e);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsInstallReviewed, async (_, args) => {
    try {
      const payload = parseIpcInput(PluginRequestInputSchema, args, 'reviewed plugin install request');
      await installReviewedPluginWithAudit(payload);
      return ipcSuccess();
    } catch (e) {
      const result = ipcFailure(e);
      recordPluginReviewedInstallFailure(result.error);
      return result;
    }
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsDiscardInstall, async (_, args) => {
    try {
      const payload = parseIpcInput(PluginRequestInputSchema, args, 'plugin install discard request');
      await discardPluginInstallReview(payload);
      return ipcSuccess();
    } catch (e) {
      return ipcFailure(e);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsInstall, async (_, args) => {
    try {
      const payload = parseIpcInput(PluginActionInputSchema, args, 'plugin install request');
      await installPluginWithAudit(payload);
      return ipcSuccess();
    } catch (e) {
      const result = ipcFailure(e);
      recordPluginInstallFailure(result.error);
      return result;
    }
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsSetEnabled, async (_, args) => {
    try {
      const payload = parseIpcInput(PluginSetEnabledInputSchema, args, 'plugin enablement request');
      await setPluginEnabledWithAudit(payload);
      return ipcSuccess();
    } catch (e) {
      const result = ipcFailure(e);
      recordPluginSetEnabledFailure(result.error);
      return result;
    }
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsRollback, async (_, args) => {
    try {
      const payload = parseIpcInput(PluginRollbackInputSchema, args, 'plugin rollback request');
      await rollbackPluginWithAudit(payload);
      return ipcSuccess();
    } catch (e) {
      const result = ipcFailure(e);
      recordPluginRollbackFailure(result.error);
      return result;
    }
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsUninstall, async (_, args) => {
    try {
      const payload = parseIpcInput(PluginActionInputSchema, args, 'plugin uninstall request');
      await uninstallPluginWithAudit(payload);
      return ipcSuccess();
    } catch (e) {
      const result = ipcFailure(e);
      recordPluginUninstallFailure(result.error);
      return result;
    }
  });
}

export { registerPluginHandlers };
