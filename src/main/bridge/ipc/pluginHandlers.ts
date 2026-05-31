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

function registerPluginHandlers() {
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
