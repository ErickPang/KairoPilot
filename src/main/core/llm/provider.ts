import {OPENAI_COMPATIBLE_PROVIDERS,OPENAI_COMPATIBLE_DESCRIPTOR,NATIVE_PLACEHOLDER_DESCRIPTOR,createOpenAICompatibleCapabilities,createNativePlaceholderCapabilities,buildProviderError,resolveDefaultBaseUrl} from './utils';
import type { ProviderCapabilitySnapshot } from '../../../shared/contracts';
import type {
  LLMConfig,
  LLMProvider,
  LLMProviderAdapterDescriptor,
  LLMProviderCapabilities,
} from './types';

export function shouldAllowBrowserLikeLlmRuntime() {
  return typeof window !== 'undefined'
    && typeof document !== 'undefined'
    && process.env.KAIROPILOT_ALLOW_BROWSER_LLM === 'true';
}

function buildProviderNotesFromDescriptor(config: LLMConfig, descriptor: LLMProviderAdapterDescriptor): string | undefined {
  if (descriptor.id === 'native-placeholder') {
    return buildProviderError(config.provider).message;
  }
  if (config.provider === 'custom') {
    return '当前作为 OpenAI-compatible 自定义端点接入。'
  }
  return undefined;
}

function resolveProviderCapabilities(config: LLMConfig): {
  descriptor: LLMProviderAdapterDescriptor;
  capabilities: LLMProviderCapabilities;
} {
  const descriptor = providerRegistry.describe(config) || NATIVE_PLACEHOLDER_DESCRIPTOR;

  switch (descriptor.id) {
    case 'openai-compatible':
      return {
        descriptor,
        capabilities: createOpenAICompatibleCapabilities()
      };
    default:
      return {
        descriptor,
        capabilities: createNativePlaceholderCapabilities()
      };
  }
}




import { OpenAICompatibleProvider } from './providers/openaiCompat';

import { UnsupportedNativeProvider } from './providers/nativePlaceholder';
import { ProviderRegistry } from './registry';

function createDefaultProviderRegistry() {
  const registry = new ProviderRegistry();

  registry.register({
    id: 'openai-compatible',
    descriptor: OPENAI_COMPATIBLE_DESCRIPTOR,
    supports: (config) => OPENAI_COMPATIBLE_PROVIDERS.has(config.provider),
    create: (config) => new OpenAICompatibleProvider(config)
  });

  registry.register({
    id: 'native-placeholder',
    descriptor: NATIVE_PLACEHOLDER_DESCRIPTOR,
    supports: (config) => !OPENAI_COMPATIBLE_PROVIDERS.has(config.provider),
    create: (config) => new UnsupportedNativeProvider(config)
  });

  return registry;
}

export const providerRegistry = createDefaultProviderRegistry();

export function createLLMProvider(config: LLMConfig): LLMProvider {
  return providerRegistry.create(config);
}

export function describeProvider(config: LLMConfig): ProviderCapabilitySnapshot {
  const { descriptor, capabilities } = resolveProviderCapabilities(config);
  return {
    provider: config.provider,
    adapterId: descriptor.id,
    adapterName: descriptor.displayName,
    protocol: descriptor.protocol,
    supported: capabilities.chat,
    defaultBaseUrl: resolveDefaultBaseUrl(config.provider),
    capabilities: {
      chat: capabilities.chat,
      stream: capabilities.stream,
      toolCalling: capabilities.toolCalling,
      modelListing: capabilities.modelListing,
      structuredOutput: capabilities.structuredOutput,
      multimodalInput: capabilities.multimodalInput
    },
    notes: buildProviderNotesFromDescriptor(config, descriptor)
  };
}
