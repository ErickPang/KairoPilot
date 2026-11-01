import type { LLMConfig, LLMProvider, LLMProviderAdapterDescriptor } from './types';

export type ProviderFactoryEntry = {
  id: string;
  descriptor: LLMProviderAdapterDescriptor;
  supports: (config: LLMConfig) => boolean;
  create: (config: LLMConfig) => LLMProvider;
};

export class ProviderRegistry {
  private readonly entries: ProviderFactoryEntry[] = [];

  register(entry: ProviderFactoryEntry) {
    this.entries.push(entry);
  }

  resolve(config: LLMConfig): ProviderFactoryEntry | undefined {
    return this.entries.find((entry) => entry.supports(config));
  }

  create(config: LLMConfig): LLMProvider {
    const entry = this.resolve(config);
    if (!entry) {
      throw new Error(`No provider adapter registered for "${config.provider}"`);
    }
    return entry.create(config);
  }

  describe(config: LLMConfig): LLMProviderAdapterDescriptor | undefined {
    return this.resolve(config)?.descriptor;
  }
}
