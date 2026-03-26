import { ipcMain } from 'electron';
import { getAgents } from '../store/config';
import { pluginManager, AgentSkill } from '../core/plugins/manager';
import { KAIRO_INVOKE } from '../../shared/ipc';

function registerPluginHandlers() {
  ipcMain.handle(KAIRO_INVOKE.pluginsGetStore, async () => {
    return pluginManager.getStorePlugins();
  });

  ipcMain.handle(KAIRO_INVOKE.pluginsGetInstalled, async () => {
    return pluginManager.getInstalledPlugins();
  });

  ipcMain.handle(KAIRO_INVOKE.skillsGetAll, async () => {
    const agents = getAgents();
    const result: Record<string, AgentSkill[]> = {};
    const mainSkills = await pluginManager.getMergedSkillsForAgent('mainAgent');
    result.public = mainSkills.filter((s: AgentSkill) => s.source === 'public');
    for (const agent of agents) {
      const agentSkills = await pluginManager.getMergedSkillsForAgent(agent.id);
      result[agent.id] = agentSkills.filter((s: AgentSkill) => s.source === 'agent');
    }
    return result;
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
