import type { AgentConfig, ModelConfig } from '../../shared/contracts';
import { getFirstProviderKey, isValidProviderKey, splitAgentModel } from './configModelUtils';
import {
  buildAgentModel,
  getProviderDefaultModelId,
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

export function getModelForAgent(agent: AgentConfig): ModelConfig | undefined {
  const parsedModel = splitAgentModel(agent.model);
  if (!parsedModel) {
    return undefined;
  }
  const provider = readKairoPilotConfig().models.providers[parsedModel.providerKey];
  if (!provider) {
    return undefined;
  }
  const modelId = provider.model.some(item => item.id === parsedModel.modelId)
    ? parsedModel.modelId
    : getProviderDefaultModelId(provider);
  return providerToModelConfig(parsedModel.providerKey, provider, modelId);
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
  saveKairoPilotConfig(config);
}

export function deleteModel(id: string) {
  const config = readKairoPilotConfig();
  delete config.models.providers[id];
  const fallbackProviderKey = getFirstProviderKey(config);
  const fallbackProvider = fallbackProviderKey ? config.models.providers[fallbackProviderKey] : undefined;
  if (!fallbackProvider || !fallbackProviderKey) {
    config.agents.list = config.agents.list.map(agent => ({ ...agent, model: '' }));
  } else {
    const fallbackModelId = getProviderDefaultModelId(fallbackProvider);
    config.agents.list = config.agents.list.map(agent => {
      const parsedModel = splitAgentModel(agent.model);
      if (!parsedModel) {
        return { ...agent, model: buildAgentModel(fallbackProviderKey, fallbackModelId) };
      }
      if (parsedModel.providerKey !== id) {
        return agent;
      }
      return {
        ...agent,
        model: buildAgentModel(fallbackProviderKey, fallbackModelId)
      };
    });
  }
  saveKairoPilotConfig(config);
}
