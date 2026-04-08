import { ipcMain } from 'electron';
import { pluginManager } from '../../core/plugins/manager';
import { createLLMProvider, describeProvider } from '../../core/llm/provider';
import { removeAgentRuntime } from '../../assistant/agentRuntime';
import { deleteAuditLogsBySessionIds } from '../../store/audit';
import { deleteSessionsByAgent } from '../../store/chat';
import {
  createAgentDraft,
  deleteAgentWorkspace,
  getAgentConfig,
  getAgent,
  saveAgentConfig,
  getKairoPilotConfig,
  getModels,
  saveModel,
  deleteModel,
  getAgents,
  saveAgent,
  deleteAgent,
  setActiveAgentId,
  getActiveAgentId
} from '../../store/config';
import { KAIRO_INVOKE } from '../../../shared/ipc';

function removeRuntimesForAgents(agentIds: string[]) {
  const uniqueAgentIds = [...new Set(agentIds.filter((id) => typeof id === 'string' && id.length > 0))];
  for (const agentId of uniqueAgentIds) {
    removeAgentRuntime(agentId);
  }
}

function findAgentIdsByProvider(providerId: string) {
  return getAgents()
    .filter((agent) => agent.model === providerId || agent.model.startsWith(`${providerId}/`))
    .map((agent) => agent.id);
}

function registerConfigHandlers() {
  ipcMain.handle(KAIRO_INVOKE.configGet, async () => {
    return getAgentConfig();
  });

  ipcMain.handle(KAIRO_INVOKE.configSave, async (_, config) => {
    const activeAgentId = getActiveAgentId();
    saveAgentConfig(config);
    removeRuntimesForAgents([activeAgentId]);
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.llmListModels, async (_, config) => {
    const llm = createLLMProvider({
      provider: config.provider || 'openai',
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: 'dummy'
    });
    return llm.listModels ? await llm.listModels() : [];
  });

  ipcMain.handle(KAIRO_INVOKE.llmDescribeProvider, async (_, config) => {
    return describeProvider({
      provider: config.provider || 'openai',
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model || 'dummy'
    });
  });

  ipcMain.handle(KAIRO_INVOKE.configGetAll, async () => {
    const config = getKairoPilotConfig();
    return {
      ...config,
      agents: {
        ...config.agents,
        list: getAgents()
      }
    };
  });

  ipcMain.handle(KAIRO_INVOKE.configGetModels, async () => {
    return getModels();
  });

  ipcMain.handle(KAIRO_INVOKE.configSaveModel, async (_, model) => {
    saveModel(model);
    removeRuntimesForAgents(findAgentIdsByProvider(model.id));
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.configDeleteModel, async (_, id) => {
    removeRuntimesForAgents(findAgentIdsByProvider(id));
    deleteModel(id);
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.configGetAgents, async () => {
    return getAgents();
  });

  ipcMain.handle(KAIRO_INVOKE.configCreateAgentDraft, async (_, seed) => {
    return createAgentDraft(seed);
  });

  ipcMain.handle(KAIRO_INVOKE.configSaveAgent, async (_, agent) => {
    saveAgent(agent);
    removeRuntimesForAgents([agent.id]);
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.configDeleteAgent, async (_, id) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('Invalid agent id');
    }
    if (id === 'mainAgent') {
      throw new Error('Main Agent cannot be deleted');
    }
    const agent = getAgent(id);
    if (!agent) {
      return { success: true };
    }
    const sessionIds = deleteSessionsByAgent(id);
    deleteAuditLogsBySessionIds(sessionIds);
    removeAgentRuntime(id);
    deleteAgent(id);
    try {
      await pluginManager.cleanupAgentScopedPlugins(id);
    } catch (error) {
      console.warn(`[Handlers] Failed to clean up scoped plugins for agent ${id}:`, error);
    }
    try {
      deleteAgentWorkspace(agent);
    } catch (error) {
      console.warn(`[Handlers] Failed to delete workspace for agent ${id}:`, error);
    }
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.configSetActiveAgent, async (_, id) => {
    setActiveAgentId(id);
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.configGetActiveAgentId, async () => {
    return getActiveAgentId();
  });
}

export { registerConfigHandlers };
