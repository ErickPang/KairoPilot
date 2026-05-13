import { ipcMain } from 'electron';
import { pluginManager } from '../../core/plugins/manager';
import { KAIRO_INVOKE } from '../../../shared/ipc';

function registerPluginHandlers() {
  ipcMain.handle(KAIRO_INVOKE.pluginsGetStore, async () => {
    const plugins = await pluginManager.getStorePlugins();
    // Enrich with permission summaries for the UI
    return plugins.map((plugin) => ({
      ...plugin,
      permissionSummary: pluginManager.getPermissionSummary(plugin)
    }));
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsGetInstalled, async () => {
    return pluginManager.getInstalledPlugins();
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsInstall, async (_, args) => {
    try {
      const id = typeof args === 'string' ? args : args.id;
      const scope = typeof args === 'string' ? 'public' : (args.scope || 'public');
      await pluginManager.installPlugin(id, scope);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsUninstall, async (_, args) => {
    try {
      const id = typeof args === 'string' ? args : args.id;
      const scope = typeof args === 'string' ? 'public' : (args.scope || 'public');
      await pluginManager.uninstallPlugin(id, scope);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}

export { registerPluginHandlers };
