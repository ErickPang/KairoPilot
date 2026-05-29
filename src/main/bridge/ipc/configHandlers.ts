import { ipcMain } from 'electron';
import { createLLMProvider, describeProvider } from '../../core/llm/provider';
import {
  deleteAgentWithCleanup,
  deleteModelAndRefreshAgents,
  saveAgentAndRefreshRuntime,
  saveLegacyAgentConfigAndRefreshRuntime,
  saveModelAndRefreshAgents
} from '../../services/configService';
import {
  createAgentDraft,
  getAgentConfig,
  getModel,
  readKairoPilotConfig,
  getAppearanceConfig,
  getRedactedModels,
  saveAppearanceConfig,
  getRedactedWebSearchConfig,
  redactKairoPilotConfigSecrets,
  saveWebSearchConfig,
  getAgents,
  setActiveAgentId,
  getActiveAgentId
} from '../../store/config';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import {
  AgentConfigInputSchema,
  AgentDraftSeedSchema,
  AppearanceConfigInputSchema,
  DeleteAgentInputSchema,
  IdInputSchema,
  LegacyAgentConfigInputSchema,
  LlmProviderInputSchema,
  ModelConfigInputSchema,
  parseIpcInput,
  WebSearchConfigInputSchema
} from './configValidation';
import { ipcSuccess } from './ipcResult';

function resolveProviderPayloadApiKey(payload: { id?: string; apiKey?: string }) {
  if (payload.apiKey?.trim()) {
    return payload.apiKey;
  }
  return payload.id ? getModel(payload.id)?.apiKey || '' : '';
}

function redactLegacyAgentConfigSecret(config: ReturnType<typeof getAgentConfig>) {
  return {
    ...config,
    apiKey: '',
    apiKeyStored: Boolean(config.apiKey)
  };
}

function registerConfigHandlers() {
  ipcMain.handle(KAIRO_INVOKE.configGet, async () => {
    return redactLegacyAgentConfigSecret(getAgentConfig());
  });

  ipcMain.handle(KAIRO_INVOKE.configSave, async (_, config) => {
    const payload = parseIpcInput(LegacyAgentConfigInputSchema, config, 'agent config');
    saveLegacyAgentConfigAndRefreshRuntime(payload);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.llmListModels, async (_, config) => {
    const payload = parseIpcInput(LlmProviderInputSchema, config, 'model provider config');
    const llm = createLLMProvider({
      provider: payload.provider,
      apiKey: resolveProviderPayloadApiKey(payload),
      baseUrl: payload.baseUrl,
      model: 'dummy'
    });
    return llm.listModels ? await llm.listModels() : [];
  });

  ipcMain.handle(KAIRO_INVOKE.llmDescribeProvider, async (_, config) => {
    const payload = parseIpcInput(LlmProviderInputSchema, config, 'model provider config');
    return describeProvider({
      provider: payload.provider,
      apiKey: resolveProviderPayloadApiKey(payload),
      baseUrl: payload.baseUrl,
      model: payload.model || 'dummy'
    });
  });

  ipcMain.handle(KAIRO_INVOKE.configGetAll, async () => {
    const config = readKairoPilotConfig();
    return redactKairoPilotConfigSecrets({
      ...config,
      agents: {
        ...config.agents,
        list: getAgents()
      }
    });
  });

  ipcMain.handle(KAIRO_INVOKE.configGetAppearance, async () => {
    return getAppearanceConfig();
  });

  ipcMain.handle(KAIRO_INVOKE.configGetModels, async () => {
    return getRedactedModels();
  });

  ipcMain.handle(KAIRO_INVOKE.configGetWebSearch, async () => {
    return getRedactedWebSearchConfig();
  });

  ipcMain.handle(KAIRO_INVOKE.configSaveModel, async (_, model) => {
    const payload = parseIpcInput(ModelConfigInputSchema, model, 'model config');
    saveModelAndRefreshAgents(payload);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.configSaveAppearance, async (_, appearance) => {
    const payload = parseIpcInput(AppearanceConfigInputSchema, appearance, 'appearance config');
    saveAppearanceConfig(payload);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.configSaveWebSearch, async (_, webSearch) => {
    const payload = parseIpcInput(WebSearchConfigInputSchema, webSearch, 'web search config');
    saveWebSearchConfig(payload);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.configDeleteModel, async (_, id) => {
    const modelId = parseIpcInput(IdInputSchema, id, 'model id');
    deleteModelAndRefreshAgents(modelId);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.configGetAgents, async () => {
    return getAgents();
  });

  ipcMain.handle(KAIRO_INVOKE.configCreateAgentDraft, async (_, seed) => {
    const payload = typeof seed === 'undefined'
      ? undefined
      : parseIpcInput(AgentDraftSeedSchema, seed, 'agent draft seed');
    return createAgentDraft(payload);
  });

  ipcMain.handle(KAIRO_INVOKE.configSaveAgent, async (_, agent) => {
    const payload = parseIpcInput(AgentConfigInputSchema, agent, 'agent config');
    saveAgentAndRefreshRuntime(payload);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.configDeleteAgent, async (_, id) => {
    const payload = parseIpcInput(DeleteAgentInputSchema, id, 'agent delete request');
    const agentId = payload.id;
    const cleanup = await deleteAgentWithCleanup(agentId, payload.deleteWorkspace);
    return ipcSuccess({ cleanup });
  });

  ipcMain.handle(KAIRO_INVOKE.configSetActiveAgent, async (_, id) => {
    const agentId = parseIpcInput(IdInputSchema, id, 'agent id');
    setActiveAgentId(agentId);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.configGetActiveAgentId, async () => {
    return getActiveAgentId();
  });
}

export { registerConfigHandlers };
