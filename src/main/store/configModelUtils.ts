import type { KairoPilotConfig, ProviderConfig, ProviderType } from '../../shared/contracts';
import { resolveDefaultBaseUrl } from '../core/llm/utils';
import { resolveConfigSecret } from './configSecrets';

const PROVIDER_TYPES: ProviderType[] = ['openai', 'openrouter', 'ollama', 'anthropic', 'deepseek', 'zhipu', 'kimi', 'qianwen', 'custom'];

export function isValidProviderKey(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);
}

export function normalizeProvider(provider: Partial<ProviderConfig> & { model?: unknown }, providerKey: string): ProviderConfig {
  if (!PROVIDER_TYPES.includes(provider.provider as ProviderType)) throw new Error(`Invalid provider type for ${providerKey}.`);
  const resolvedProviderType = provider.provider!;
  if (!Array.isArray(provider.model) || provider.model.length === 0) throw new Error(`Model list is required for ${providerKey}.`);
  const modelList = provider.model.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string' || !item.name.trim()) throw new Error(`Invalid model entry for ${providerKey}.`);
    if (item.contextWindowTokens !== undefined && (!Number.isInteger(item.contextWindowTokens) || item.contextWindowTokens < 4096 || item.contextWindowTokens > 2000000)) throw new Error(`Invalid model context limit for ${providerKey}.`);
    return { ...item };
  });

  const resolvedApiKey = resolveConfigSecret(provider.apiKey, provider.apiKeyEncrypted);
  return {
    provider: resolvedProviderType,
    baseUrl: provider.baseUrl || resolveDefaultBaseUrl(resolvedProviderType) || 'https://api.openai.com/v1',
    apiKey: resolvedApiKey,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    apiKeyStored: Boolean(resolvedApiKey),
    model: modelList
  };
}

export function getFirstProviderKey(config: KairoPilotConfig): string {
  const keys = Object.keys(config.models.providers);
  return keys[0] || '';
}

export function splitAgentModel(value: string | undefined): { providerKey: string; modelId: string } | null {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const index = value.indexOf('/');
  if (index <= 0 || index >= value.length - 1) {
    return null;
  }
  return {
    providerKey: value.slice(0, index),
    modelId: value.slice(index + 1)
  };
}
