import type { KairoPilotConfig, ProviderConfig, ProviderType } from '../../shared/contracts';
import { resolveDefaultBaseUrl } from '../core/llm/provider';

const PROVIDER_TYPES: ProviderType[] = ['openai', 'openrouter', 'ollama', 'anthropic', 'deepseek', 'zhipu', 'kimi', 'qianwen', 'custom'];

function resolveProviderType(value: unknown, providerKey: string): ProviderType {
  if (typeof value === 'string' && PROVIDER_TYPES.includes(value as ProviderType)) {
    return value as ProviderType;
  }
  const normalizedKey = providerKey.toLowerCase();
  if (PROVIDER_TYPES.includes(normalizedKey as ProviderType)) {
    return normalizedKey as ProviderType;
  }
  return 'custom';
}

export function isValidProviderKey(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);
}

export function normalizeProvider(provider: Partial<ProviderConfig> & { model?: unknown }, fallbackProviderKey: string): ProviderConfig {
  const resolvedProviderType = resolveProviderType(provider.provider, fallbackProviderKey);
  const rawModel = provider.model;
  const rawModelObject = rawModel && typeof rawModel === 'object' ? rawModel as { list?: unknown[] } : undefined;
  const rawModelList = Array.isArray(rawModel)
    ? rawModel
    : (Array.isArray(rawModelObject?.list) ? rawModelObject.list : []);
  const modelList = rawModelList
    .filter(item => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
    .map(item => ({
      id: String((item as { id: string }).id),
      name: String((item as { name?: string }).name || (item as { id: string }).id)
    }));
  const finalModelList = modelList.length > 0 ? modelList : [{ id: 'gpt-4o', name: 'gpt-4o' }];

  return {
    provider: resolvedProviderType,
    baseUrl: provider.baseUrl || resolveDefaultBaseUrl(resolvedProviderType) || 'https://api.openai.com/v1',
    apiKey: provider.apiKey || '',
    model: finalModelList
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
