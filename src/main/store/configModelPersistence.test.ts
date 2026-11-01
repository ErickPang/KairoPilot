import { describe, expect, it } from 'vitest';
import {
  modelToProviderConfig,
  providerToModelConfig,
  redactModelConfigSecret,
  redactProviderConfig
} from './configModelPersistence';

describe('configModelPersistence', () => {
  it('keeps the existing provider key when a saved model is submitted without plaintext credentials', () => {
    const provider = modelToProviderConfig({
      id: 'openai',
      name: 'openai',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      apiKeyStored: true,
      model: 'gpt-4o',
      availableModels: [{ id: 'gpt-4o', name: 'gpt-4o' }]
    }, {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-existing',
      apiKeyEncrypted: 'safe-storage:v1:existing',
      model: [{ id: 'gpt-4o', name: 'gpt-4o' }]
    });

    expect(provider.apiKey).toBe('sk-existing');
    expect(provider.apiKeyEncrypted).toBe('safe-storage:v1:existing');
  });

  it('marks stored credentials for UI models without exposing plaintext after redaction', () => {
    const model = providerToModelConfig('openai', {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-existing',
      model: [{ id: 'gpt-4o', name: 'gpt-4o' }]
    });
    const redactedModel = redactModelConfigSecret(model);
    const redactedProvider = redactProviderConfig({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-existing',
      apiKeyEncrypted: 'safe-storage:v1:existing',
      model: [{ id: 'gpt-4o', name: 'gpt-4o' }]
    });

    expect(redactedModel.apiKey).toBe('');
    expect(redactedModel.apiKeyStored).toBe(true);
    expect(redactedProvider.apiKey).toBe('');
    expect(redactedProvider.apiKeyEncrypted).toBeUndefined();
    expect(redactedProvider.apiKeyStored).toBe(true);
  });
});
