import type { ProviderType } from '../../../shared/contracts';
import type { LLMProviderAdapterDescriptor, LLMProviderCapabilities } from './types';

export const OPENAI_COMPATIBLE_PROVIDERS = new Set<ProviderType>([
  'openai',
  'openrouter',
  'ollama',
  'deepseek',
  'zhipu',
  'kimi',
  'qianwen',
  'custom'
]);

export const OPENAI_COMPATIBLE_DESCRIPTOR: LLMProviderAdapterDescriptor = {
  id: 'openai-compatible',
  displayName: 'OpenAI Compatible',
  protocol: 'openai-compatible'
};


export const NATIVE_PLACEHOLDER_DESCRIPTOR: LLMProviderAdapterDescriptor = {
  id: 'native-placeholder',
  displayName: 'Native Provider Placeholder',
  protocol: 'native'
};

export function createOpenAICompatibleCapabilities(): LLMProviderCapabilities {
  return {
    chat: true,
    stream: true,
    toolCalling: true,
    modelListing: true,
    structuredOutput: false,
    multimodalInput: true,
    protocol: 'openai-compatible'
  };
}

export function createNativePlaceholderCapabilities(): LLMProviderCapabilities {
  return {
    chat: false,
    stream: false,
    toolCalling: false,
    modelListing: false,
    structuredOutput: false,
    multimodalInput: false,
    protocol: 'native'
  };
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower.endsWith('/chat/completions')) {
    return trimmed.slice(0, -('/chat/completions'.length));
  }
  return trimmed;
}

export function resolveDefaultBaseUrl(provider: ProviderType): string | undefined {
  switch (provider) {
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'ollama':
      return 'http://localhost:11434/v1';
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    case 'zhipu':
      return 'https://open.bigmodel.cn/api/paas/v4';
    case 'kimi':
      return 'https://api.moonshot.cn/v1';
    case 'qianwen':
      return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    case 'custom':
    case 'openai':
      return 'https://api.openai.com/v1';
    default:
      return undefined;
  }
}

export function buildProviderError(provider: ProviderType): Error {
  return new Error(`Provider "${provider}" 尚未接入原生适配器。当前阶段仅完成 OpenAI-compatible 抽象收敛，请配置兼容端点或后续补充 native adapter。`);
}

export function resolveOpenAICompatibleApiKey(_provider: ProviderType, apiKey: string | undefined): string {
  // Placeholder for any provider-specific resolution logic
  return apiKey || '';
}

export function normalizeOpenAICompatibleError(provider: ProviderType, action: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`[${provider}] ${action} failed: ${message}`);
}

export function shouldRetryOpenAIStreamWithoutUsageOptions(error: unknown): boolean {
  return error instanceof Error && error.message.includes('stream_options');
}
