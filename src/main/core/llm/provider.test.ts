import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLLMProvider, describeProvider, providerRegistry, resolveDefaultBaseUrl } from './provider';

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
      multimodalInput: false,
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
        multimodalInput: false
      },
      notes: undefined
    });
  });

  it('为 Anthropic 返回原生适配器与能力声明', () => {
    const provider = createLLMProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet'
    });

    expect(provider.adapter.id).toBe('anthropic-native');
    expect(provider.getCapabilities()).toEqual({
      chat: true,
      stream: true,
      toolCalling: true,
      modelListing: true,
      structuredOutput: false,
      multimodalInput: false,
      protocol: 'native'
    });
  });

  it('暴露默认 baseUrl 解析，便于 UI 自动填充', () => {
    expect(resolveDefaultBaseUrl('openai')).toBe('https://api.openai.com/v1');
    expect(resolveDefaultBaseUrl('ollama')).toBe('http://localhost:11434/v1');
    expect(resolveDefaultBaseUrl('anthropic')).toBe('https://api.anthropic.com/v1');
  });

  it('将 Anthropic 响应归一化为统一 ChatMessage，并转换工具调用', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'msg_1',
      role: 'assistant',
      content: [
        { type: 'text', text: '我先查一下文件。' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'README.md' } }
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 12,
        output_tokens: 8
      }
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLLMProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet'
    });

    const response = await provider.complete({
      messages: [
        { role: 'system', content: '你是一个安全的助手。' },
        { role: 'user', content: '读取 README.md' }
      ],
      tools: [{
        name: 'read_file',
        description: '读取文件内容',
        parameters: z.object({
          path: z.string()
        }),
        execute: vi.fn()
      }]
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01'
      })
    }));
    expect(response).toEqual({
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      finishReason: 'tool_use',
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20
      },
      raw: {
        id: 'msg_1',
        role: 'assistant',
        content: [
          { type: 'text', text: '我先查一下文件。' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'README.md' } }
        ],
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 12,
          output_tokens: 8
        }
      },
      message: {
        role: 'assistant',
        content: '我先查一下文件。',
        tool_calls: [{
          id: 'toolu_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"README.md"}'
          }
        }],
        model: 'claude-3-7-sonnet',
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20
        }
      }
    });
  });

  it('支持 Anthropic 模型列表查询', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: 'claude-sonnet-4-5' },
        { id: 'claude-haiku-4-5' }
      ]
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLLMProvider({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-3-7-sonnet'
    });

    await expect(provider.listModels?.()).resolves.toEqual([
      'claude-sonnet-4-5',
      'claude-haiku-4-5'
    ]);
  });
});
