import { ModelConfig, ProviderConfig } from '../types';

export function toModelList(providers: Record<string, ProviderConfig>): ModelConfig[] {
  return Object.entries(providers).map(([providerKey, provider]) => ({
    id: providerKey,
    name: providerKey,
    provider: provider.provider || 'custom',
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    apiKeyStored: provider.apiKeyStored,
    model: provider.model[0]?.id || '',
    availableModels: provider.model
  }));
}
