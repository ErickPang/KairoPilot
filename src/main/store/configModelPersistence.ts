import type { ModelConfig, ProviderConfig } from '../../shared/contracts';
import { prepareConfigSecretForStorage } from './configSecrets';

export function getProviderDefaultModelId(provider: ProviderConfig): string {
  if (!provider.model.length) throw new Error('Model list is required.');
  return provider.model[0].id;
}

export function buildAgentModel(providerKey: string, modelId: string): string {
  return `${providerKey}/${modelId}`;
}

export function providerToModelConfig(providerKey: string, provider: ProviderConfig, modelId?: string): ModelConfig {
  const resolvedModel = modelId && provider.model.some(item => item.id === modelId)
    ? modelId
    : getProviderDefaultModelId(provider);
  return {
    id: providerKey,
    name: providerKey,
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    apiKeyStored: Boolean(provider.apiKey),
    model: resolvedModel,
    availableModels: provider.model,
    contextWindowTokens: provider.model.find(item=>item.id===resolvedModel)?.contextWindowTokens
  };
}

export function modelToProviderConfig(model: ModelConfig, existing?: ProviderConfig): ProviderConfig {
  const nextApiKey = model.apiKey.trim() || existing?.apiKey || '';
  const availableModels = Array.isArray(model.availableModels) && model.availableModels.length > 0
    ? model.availableModels
    : (existing?.model || [{ id: model.model, name: model.model }]);
  const list = availableModels.some(item => item.id === model.model)
    ? availableModels
    : [...availableModels, { id: model.model, name: model.model }];
  return {
    provider: model.provider,
    baseUrl: model.baseUrl,
    apiKey: nextApiKey,
    apiKeyEncrypted: existing?.apiKey === nextApiKey ? existing.apiKeyEncrypted : undefined,
    model: list
  };
}

export function redactProviderConfig(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    apiKey: '',
    apiKeyEncrypted: undefined,
    apiKeyStored: Boolean(provider.apiKey)
  };
}

export function redactModelConfigSecret(model: ModelConfig): ModelConfig {
  return {
    ...model,
    apiKey: '',
    apiKeyStored: Boolean(model.apiKey)
  };
}

export function sanitizeProviderForStorage(provider: ProviderConfig): ProviderConfig {
  const secret = prepareConfigSecretForStorage(provider.apiKey, provider.apiKeyEncrypted);
  return {
    ...provider,
    apiKey: secret.plainValue,
    apiKeyEncrypted: secret.encryptedValue,
    apiKeyStored: undefined
  };
}
