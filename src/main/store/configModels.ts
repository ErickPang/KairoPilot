import type { ModelConfig } from '../../shared/contracts';
import { isValidProviderKey, splitAgentModel } from './configModelUtils';
import {
  buildAgentModel,
  modelToProviderConfig,
  providerToModelConfig,
  redactModelConfigSecret
} from './configModelPersistence';
import { readKairoPilotConfig, saveKairoPilotConfig } from './configRepository';

export function getModels(): ModelConfig[] {
  const providers = readKairoPilotConfig().models.providers;
  return Object.entries(providers).map(([providerKey, provider]) => providerToModelConfig(providerKey, provider));
}

export function getRedactedModels(): ModelConfig[] {
  return getModels().map(redactModelConfigSecret);
}

export function getModel(id: string): ModelConfig | undefined {
  const provider = readKairoPilotConfig().models.providers[id];
  if (!provider) {
    return undefined;
  }
  return providerToModelConfig(id, provider);
}

export function getModelForBinding(binding: string): ModelConfig | undefined {
  const parsedModel = splitAgentModel(binding);
  if (!parsedModel) {
    return undefined;
  }
  const provider = readKairoPilotConfig().models.providers[parsedModel.providerKey];
  if (!provider) {
    return undefined;
  }
  if (!provider.model.some(item=>item.id===parsedModel.modelId)) return undefined;
  return providerToModelConfig(parsedModel.providerKey,provider,parsedModel.modelId);
}

export function saveModel(model: ModelConfig) {
  const config = readKairoPilotConfig();
  if (!isValidProviderKey(model.id)) {
    throw new Error('Invalid provider key: only English letters, numbers, "_" and "-" are allowed');
  }
  const existing = config.models.providers[model.id];
  if (model.provider !== 'ollama' && !model.apiKey.trim() && !existing?.apiKey) {
    throw new Error('API Key is required for this provider.');
  }
  config.models.providers[model.id] = modelToProviderConfig(model, existing);
  if(config.workbench && !config.workbench.defaultModel)config.workbench.defaultModel=buildAgentModel(model.id,model.model || config.models.providers[model.id].model[0]?.id || '');
  saveKairoPilotConfig(config);
}

export function deleteModel(id: string) {
  const config = readKairoPilotConfig();
  delete config.models.providers[id];
  saveKairoPilotConfig(config);
}
