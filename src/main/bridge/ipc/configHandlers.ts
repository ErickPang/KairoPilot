
import { z } from 'zod';
import { getWorkbenchConfig,saveWorkbenchConfig } from '../../services/workbenchConfigService';
import { ipcMain } from 'electron';
import { createLLMProvider, describeProvider } from '../../core/llm/provider';
import {
  deleteModelAndRefreshAgents,
  saveModelAndRefreshAgents
} from '../../services/configService';
import {
  getModel,
  readKairoPilotConfig,
  getAppearanceConfig,
  getRedactedModels,
  saveAppearanceConfig,
  getRedactedWebSearchConfig,
  redactKairoPilotConfigSecrets,
  saveWebSearchConfig,
} from '../../store/config';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import {
  WorkbenchSettingsInputSchema,
  AppearanceConfigInputSchema,
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

function registerConfigHandlers() {
  ipcMain.handle(KAIRO_INVOKE.configGetWorkbench, () => getWorkbenchConfig());
  ipcMain.handle(KAIRO_INVOKE.configSaveWorkbench, (_,input) => {
    const value=parseIpcInput(WorkbenchSettingsInputSchema,input,'workbench settings');
    saveWorkbenchConfig(value);return ipcSuccess();
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
      workbench:getWorkbenchConfig(),
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
    await saveModelAndRefreshAgents(payload);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.configSaveAppearance, async (_, appearance) => {
    const payload = parseIpcInput(AppearanceConfigInputSchema, appearance, 'appearance config');
    saveAppearanceConfig(payload);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.configSaveWebSearch, async (_, webSearch) => {
    const payload = parseIpcInput(WebSearchConfigInputSchema, webSearch, 'web search config');
    await saveWebSearchConfig(payload);
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.configDeleteModel, async (_, id) => {
    const modelId = parseIpcInput(z.string().min(1).max(160), id, 'model id');
    deleteModelAndRefreshAgents(modelId);
    return ipcSuccess();
  });

}

export { registerConfigHandlers };
