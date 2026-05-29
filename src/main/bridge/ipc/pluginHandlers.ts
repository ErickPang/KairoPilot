import { ipcMain } from 'electron';
import {
  getInstalledPlugins,
  getStorePlugins,
  installPluginWithAudit,
  recordPluginInstallFailure,
  recordPluginUninstallFailure,
  uninstallPluginWithAudit
} from '../../services/pluginService';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import { parseIpcInput } from './configValidation';
import { PluginActionInputSchema } from './skillPluginValidation';
import { ipcFailure, ipcSuccess } from './ipcResult';

function registerPluginHandlers() {
  ipcMain.handle(KAIRO_INVOKE.pluginsGetStore, async () => {
    return getStorePlugins();
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsGetInstalled, async () => {
    return getInstalledPlugins();
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
