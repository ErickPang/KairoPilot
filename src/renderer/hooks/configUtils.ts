import { KairoPilotConfig, ModelConfig, ProviderConfig } from '../types';

export function toModelList(providers: Record<string, ProviderConfig>): ModelConfig[] {
  return Object.entries(providers).map(([providerKey, provider]) => ({
    id: providerKey,
    name: providerKey,
    provider: provider.provider || 'custom',
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model[0]?.id || '',
    availableModels: provider.model
  }));
}

export function canInitAgentFromConfig(fullConfig: KairoPilotConfig, agentId: string | null | undefined) {
  if (!agentId) {
    return false;
  }
  const agent = (fullConfig.agents.list || []).find((item) => item.id === agentId);
  if (!agent?.model) {
    return false;
  }
  const slashIndex = agent.model.indexOf('/');
  if (slashIndex <= 0) {
    return false;
  }
  const providerKey = agent.model.slice(0, slashIndex);
  return Boolean(fullConfig.models.providers?.[providerKey]);
}
