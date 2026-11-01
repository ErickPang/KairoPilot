import type { LLMConfig, LLMProvider, LLMProviderCapabilities, LLMResponse, ChatMessage } from '../types';
import { NATIVE_PLACEHOLDER_DESCRIPTOR } from '../utils';
import { buildProviderError } from '../utils';
import { createNativePlaceholderCapabilities } from '../utils';

export class UnsupportedNativeProvider implements LLMProvider {
  readonly config: LLMConfig;
  readonly adapter = NATIVE_PLACEHOLDER_DESCRIPTOR;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  getCapabilities(): LLMProviderCapabilities {
    return createNativePlaceholderCapabilities();
  }

  async complete(): Promise<LLMResponse> {
    throw buildProviderError(this.config.provider);
  }

  async chat(): Promise<ChatMessage> {
    throw buildProviderError(this.config.provider);
  }

  async stream(): Promise<void> {
    throw buildProviderError(this.config.provider);
  }

  async listModels(): Promise<string[]> {
    throw buildProviderError(this.config.provider);
  }
}
