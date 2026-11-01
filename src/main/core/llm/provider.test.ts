import {resolveDefaultBaseUrl} from './utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLLMProvider, describeProvider, providerRegistry } from './provider';

describe('llm provider registry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('为 OpenAI-compatible provider 返回统一适配器与能力声明', () => {
    const provider = createLLMProvider({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    });

    expect(provider.adapter.id).toBe('openai-compatible');
    expect(provider.getCapabilities()).toEqual({
      chat: true,
      stream: true,
      toolCalling: true,
      modelListing: true,
      structuredOutput: false,
      multimodalInput: true,
      protocol: 'openai-compatible'
    });
    expect(providerRegistry.describe({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    })).toEqual(provider.adapter);
  });

  it('归一化 OpenAI-compatible baseUrl', () => {
    const provider = createLLMProvider({
      provider: 'custom',
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1/chat/completions/',
      model: 'demo-model'
    });

    expect(provider.config.baseUrl).toBe('https://example.com/v1');
  });

  it('输出 provider capability snapshot，供配置界面消费', () => {
    expect(describeProvider({
      provider: 'deepseek',
      apiKey: 'test-key',
      model: 'deepseek-chat'
    })).toEqual({
      provider: 'deepseek',
      adapterId: 'openai-compatible',
      adapterName: 'OpenAI Compatible',
      protocol: 'openai-compatible',
      supported: true,
      defaultBaseUrl: 'https://api.deepseek.com/v1',
      capabilities: {
        chat: true,
        stream: true,
        toolCalling: true,
        modelListing: true,
        structuredOutput: false,
        multimodalInput: true
      },
      notes: undefined
    });
  });

  it('describeProvider 在配置页预览阶段不要求 API Key', () => {
    expect(describeProvider({
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o-mini'
    })).toEqual({
      provider: 'openai',
      adapterId: 'openai-compatible',
      adapterName: 'OpenAI Compatible',
      protocol: 'openai-compatible',
      supported: true,
      defaultBaseUrl: 'https://api.openai.com/v1',
      capabilities: {
        chat: true,
        stream: true,
        toolCalling: true,
        modelListing: true,
        structuredOutput: false,
        multimodalInput: true
      },
      notes: undefined
    });
  });

  it('将 OpenRouter 作为 OpenAI-compatible 提供商接入', () => {
    const provider = createLLMProvider({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-test-key',
      model: 'openai/gpt-4o-mini'
    });

    expect(provider.adapter.id).toBe('openai-compatible');
    expect(provider.config.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(describeProvider({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-test-key',
      model: 'openai/gpt-4o-mini'
    })).toEqual({
      provider: 'openrouter',
      adapterId: 'openai-compatible',
      adapterName: 'OpenAI Compatible',
      protocol: 'openai-compatible',
      supported: true,
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      capabilities: {
        chat: true,
        stream: true,
        toolCalling: true,
        modelListing: true,
        structuredOutput: false,
        multimodalInput: true
      },
      notes: undefined
    });
  });

  it('在远端 OpenAI-compatible provider 缺少 API Key 时不抛构造错误', () => {
    const provider = createLLMProvider({
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o-mini'
    });

    expect(provider.config.apiKey).toBe('');
  });

  it('OpenRouter 在运行前仅校验 API Key 非空，不强依赖前缀格式', () => {
    const provider = createLLMProvider({
      provider: 'openrouter',
      apiKey: 'sk-test-key',
      model: 'openai/gpt-4o-mini'
    });

    expect(provider.config.apiKey).toBe('sk-test-key');
  });

  it('OpenRouter 对话鉴权失败时给出更明确的提示', async () => {
    const provider = createLLMProvider({
      provider: 'openrouter',
      apiKey: 'sk-test-key',
      model: 'qwen/qwen3.6-plus:free'
    }) as unknown as {
      complete: (request: { messages: Array<{ role: string; content: string }> }) => Promise<unknown>
      client: {
        chat: {
          completions: {
            create: () => Promise<never>
          }
        }
      }
    };

    provider.client.chat.completions.create = vi.fn().mockRejectedValue(new Error('401 Missing Authentication header'));

    await expect(provider.complete({
      messages: [{ role: 'user', content: 'hi' }]
    })).rejects.toThrow(/openrouter.*chat failed/);
  });

  it('streaming 请求显式要求返回 usage，保证 token 统计可用', async () => {
    async function* chunks() {
      yield {
        choices: [
          {
            delta: { content: 'ok' }
          }
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5
        }
      };
    }

    const provider = createLLMProvider({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    }) as unknown as {
      stream: (request: { messages: Array<{ role: string; content: string }> }, onEvent: (event: unknown) => void) => Promise<void>
      client: {
        chat: {
          completions: {
            create: ReturnType<typeof vi.fn>
          }
        }
      }
    };

    provider.client.chat.completions.create = vi.fn().mockResolvedValue(chunks());
    const onEvent = vi.fn();

    await provider.stream({
      messages: [{ role: 'user', content: 'hi' }]
    }, onEvent);

    expect(provider.client.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
      stream: true,
      stream_options: {
        include_usage: true
      }
    }), expect.any(Object));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'usage_delta',
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5
      }
    }));
  });

  it('OpenAI-compatible streaming 遇到不支持 stream_options 的端点时自动降级', async () => {
    async function* chunks() {
      yield {
        choices: [
          {
            delta: { content: 'fallback ok' }
          }
        ]
      };
    }

    const provider = createLLMProvider({
      provider: 'custom',
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'custom-model'
    }) as unknown as {
      stream: (request: { messages: Array<{ role: string; content: string }> }, onEvent: (event: unknown) => void) => Promise<void>
      client: {
        chat: {
          completions: {
            create: ReturnType<typeof vi.fn>
          }
        }
      }
    };

    provider.client.chat.completions.create = vi.fn()
      .mockRejectedValueOnce(new Error('Unrecognized request argument supplied: stream_options'))
      .mockResolvedValueOnce(chunks());
    const onEvent = vi.fn();

    await provider.stream({
      messages: [{ role: 'user', content: 'hi' }]
    }, onEvent);

    expect(provider.client.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(provider.client.chat.completions.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      stream_options: {
        include_usage: true
      }
    }), expect.any(Object));
    expect(provider.client.chat.completions.create).toHaveBeenNthCalledWith(2, expect.not.objectContaining({
      stream_options: expect.anything()
    }), expect.any(Object));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'assistant_delta',
      delta: 'fallback ok'
    }));
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'failed'
    }));
  });

  it('获取模型列表失败时向上抛出规范化错误', async () => {
    const provider = createLLMProvider({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-test-key',
      model: 'openai/gpt-4o-mini'
    }) as unknown as {
      listModels: () => Promise<string[]>
      client: {
        models: {
          list: () => Promise<never>
        }
      }
    };

    provider.client.models.list = vi.fn().mockRejectedValue(new Error('401 Missing Authentication header'));

    await expect(provider.listModels()).rejects.toThrow(/openrouter.*models failed/);
  });

  it('Anthropic 原生适配器尚未实现，返回占位适配器', () => {
    const provider = createLLMProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet'
    });

    expect(provider.adapter.id).toBe('native-placeholder');
    expect(provider.getCapabilities()).toEqual({
      chat: false,
      stream: false,
      toolCalling: false,
      modelListing: false,
      structuredOutput: false,
      multimodalInput: false,
      protocol: 'native'
    });
  });

  it('暴露默认 baseUrl 解析，便于 UI 自动填充', () => {
    expect(resolveDefaultBaseUrl('openai')).toBe('https://api.openai.com/v1');
    expect(resolveDefaultBaseUrl('openrouter')).toBe('https://openrouter.ai/api/v1');
    expect(resolveDefaultBaseUrl('ollama')).toBe('http://localhost:11434/v1');
    expect(resolveDefaultBaseUrl('anthropic')).toBe('https://api.anthropic.com/v1');
  });

  it('Anthropic 原生适配器调用 complete 时抛出明确错误', async () => {
    const provider = createLLMProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet'
    });

    await expect(provider.complete({
      messages: [
        { role: 'system', content: '你是一个安全的助手。' },
        { role: 'user', content: '读取 README.md' }
      ]
    })).rejects.toThrow(/尚未接入原生适配器/);
  });

  it('Anthropic 原生适配器调用 stream 时抛出明确错误', async () => {
    const provider = createLLMProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet'
    });
    const onEvent = vi.fn();

    await expect(provider.stream?.({
      messages: [{ role: 'user', content: '读取 README.md' }]
    }, onEvent)).rejects.toThrow(/尚未接入原生适配器/);
  });

  it('Anthropic 原生适配器调用 listModels 时抛出明确错误', async () => {
    const provider = createLLMProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet'
    });

    await expect(provider.listModels?.()).rejects.toThrow(/尚未接入原生适配器/);
  });
});
