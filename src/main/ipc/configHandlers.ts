import { ipcMain } from 'electron';
import { OpenAIProvider } from '../core/llm/provider';
import {
  getAgentConfig,
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
} from '../store/config';

function registerConfigHandlers() {
  ipcMain.handle('config:get', async () => {
    return getAgentConfig();
  });

  ipcMain.handle('config:save', async (_, config) => {
    saveAgentConfig(config);
    return { success: true };
  });

  ipcMain.handle('llm:listModels', async (_, config) => {
    try {
      const llm = new OpenAIProvider({
        provider: config.provider || 'openai',
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: 'dummy'
      });
      return await llm.listModels();
    } catch (error) {
      console.warn(`[Handlers] Failed to list models: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  });

  ipcMain.handle('config:get-all', async () => {
    return getKairoPilotConfig();
  });

  ipcMain.handle('config:get-models', async () => {
    return getModels();
  });

  ipcMain.handle('config:save-model', async (_, model) => {
    saveModel(model);
    return { success: true };
  });

  ipcMain.handle('config:delete-model', async (_, id) => {
    deleteModel(id);
    return { success: true };
  });

  ipcMain.handle('config:get-agents', async () => {
    return getAgents();
  });

  ipcMain.handle('config:save-agent', async (_, agent) => {
    saveAgent(agent);
    return { success: true };
  });

  ipcMain.handle('config:delete-agent', async (_, id) => {
    deleteAgent(id);
    return { success: true };
  });

  ipcMain.handle('config:set-active-agent', async (_, id) => {
    setActiveAgentId(id);
    return { success: true };
  });

  ipcMain.handle('config:get-active-agent-id', async () => {
    return getActiveAgentId();
  });
}

export { registerConfigHandlers };
