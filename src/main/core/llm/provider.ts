import { OpenAI } from 'openai';
import { z } from 'zod';
import type { ProviderCapabilitySnapshot, ProviderType } from '../../../shared/contracts';
import type {
  ChatMessage,
  LLMConfig,
  LLMProvider,
  LLMProviderAdapterDescriptor,
  LLMProviderCapabilities,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  ToolDefinition
} from './types';

const OPENAI_COMPATIBLE_PROVIDERS = new Set<ProviderType>([
  'openai',
  'openrouter',
  'ollama',
  'deepseek',
  'zhipu',
  'kimi',
  'qianwen',
  'custom'
]);

const OPENAI_COMPATIBLE_DESCRIPTOR: LLMProviderAdapterDescriptor = {
  id: 'openai-compatible',
  displayName: 'OpenAI Compatible',
  protocol: 'openai-compatible'
};

const ANTHROPIC_DESCRIPTOR: LLMProviderAdapterDescriptor = {
  id: 'anthropic-native',
  displayName: 'Anthropic Native',
  protocol: 'native'
};

const NATIVE_PLACEHOLDER_DESCRIPTOR: LLMProviderAdapterDescriptor = {
  id: 'native-placeholder',
  displayName: 'Native Provider Placeholder',
  protocol: 'native'
};

function createOpenAICompatibleCapabilities(): LLMProviderCapabilities {
  return {
    chat: true,
    stream: true,
    toolCalling: true,
    modelListing: true,
    structuredOutput: false,
    multimodalInput: false,
    protocol: 'openai-compatible'
  };
}

function createNativePlaceholderCapabilities(): LLMProviderCapabilities {
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

function createAnthropicCapabilities(): LLMProviderCapabilities {
  return {
    chat: true,
    stream: true,
    toolCalling: true,
    modelListing: true,
    structuredOutput: false,
    multimodalInput: false,
    protocol: 'native'
  };
}

function normalizeBaseUrl(baseUrl: string): string {
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

function buildProviderError(provider: ProviderType): Error {
  return new Error(`Provider "${provider}" 尚未接入原生适配器。当前阶段仅完成 OpenAI-compatible 抽象收敛，请配置兼容端点或后续补充 native adapter。`);
}

function resolveOpenAICompatibleApiKey(provider: ProviderType, apiKey: string | undefined): string {
  const trimmedApiKey = apiKey?.trim() || '';

  if (provider === 'ollama') {
    return trimmedApiKey || 'ollama';
  }

  if (!trimmedApiKey) {
    throw new Error(`Provider "${provider}" 缺少 API Key，请在模型配置中填写后再试。`);
  }

  return trimmedApiKey;
}

function normalizeOpenAICompatibleError(provider: ProviderType, action: 'chat' | 'stream' | 'models', error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Unknown error';

  if (provider === 'openrouter' && /401\s+Missing Authentication header/i.test(message)) {
    const actionLabel = action === 'models' ? '获取模型列表' : '发起对话';
    return new Error(`OpenRouter ${actionLabel}失败：服务端返回 401 Missing Authentication header。当前配置中的 API Key 已被提交请求，但 OpenRouter 未接受该密钥。请确认使用的是 OpenRouter 控制台生成并可用于聊天接口的密钥。注意：OpenRouter 的 /models 接口可匿名访问，因此“获取模型”成功并不能证明 API Key 可用于对话。`);
  }

  if (provider === 'openrouter') {
    const actionLabel = action === 'models' ? '获取模型列表' : '发起对话';
    return new Error(`OpenRouter ${actionLabel}失败：${message}`);
  }

  return new Error(`${provider} ${action === 'models' ? '获取模型列表' : '请求'}失败：${message}`);
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
    case 'anthropic-native':
      return {
        descriptor,
        capabilities: createAnthropicCapabilities()
      };
    default:
      return {
        descriptor,
        capabilities: createNativePlaceholderCapabilities()
      };
  }
}

type AnthropicRequestMessage = {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
};

type AnthropicResponseContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> };

type AnthropicMessageResponse = {
  id?: string;
  type?: string;
  role?: 'assistant';
  content?: AnthropicResponseContentBlock[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

export class OpenAICompatibleProvider implements LLMProvider {
  readonly config: LLMConfig;
  readonly adapter = OPENAI_COMPATIBLE_DESCRIPTOR;

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: LLMConfig) {
    const normalizedBaseUrl = config.baseUrl ? normalizeBaseUrl(config.baseUrl) : resolveDefaultBaseUrl(config.provider);
    if (!normalizedBaseUrl) {
      throw buildProviderError(config.provider);
    }
    const resolvedApiKey = resolveOpenAICompatibleApiKey(config.provider, config.apiKey);

    this.config = {
      ...config,
      apiKey: resolvedApiKey,
      baseUrl: normalizedBaseUrl
    };
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: resolvedApiKey,
      baseURL: normalizedBaseUrl,
      dangerouslyAllowBrowser: true
    });
  }

  getCapabilities(): LLMProviderCapabilities {
    return createOpenAICompatibleCapabilities();
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: this.formatMessages(request.messages) as unknown as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
        tools: this.formatTools(request.tools),
        temperature: request.generationConfig?.temperature,
        top_p: request.generationConfig?.topP,
        stop: request.generationConfig?.stop,
        max_tokens: request.generationConfig?.maxOutputTokens
      });

      const choice = Array.isArray(response.choices) ? response.choices[0] : undefined;
      const message = choice?.message;
      if (!message) {
        throw new Error('Invalid OpenAI-compatible chat response: missing choices[0].message');
      }

      const normalizedMessage: ChatMessage = {
        role: message.role || 'assistant',
        content: typeof message.content === 'string' ? message.content : '',
        tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls as unknown as Record<string, unknown>[] : undefined,
        model: this.model,
        usage: response.usage ? {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens
        } : undefined
      };

      return {
        message: normalizedMessage,
        provider: this.config.provider,
        model: this.model,
        usage: normalizedMessage.usage,
        finishReason: choice?.finish_reason || undefined,
        raw: response
      };
    } catch (error) {
      throw normalizeOpenAICompatibleError(this.config.provider, 'chat', error);
    }
  }

  async chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatMessage> {
    const response = await this.complete({
      messages,
      tools
    });
    return response.message;
  }

  async stream(request: LLMRequest, onEvent: (event: LLMStreamEvent) => void): Promise<void> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: this.formatMessages(request.messages) as unknown as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
        tools: this.formatTools(request.tools),
        temperature: request.generationConfig?.temperature,
        top_p: request.generationConfig?.topP,
        stop: request.generationConfig?.stop,
        max_tokens: request.generationConfig?.maxOutputTokens,
        stream: true
      });

      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta;
        const content = delta?.content;
        if (typeof content === 'string' && content.length > 0) {
          onEvent({
            type: 'assistant_delta',
            delta: content,
            provider: this.config.provider,
            model: this.model
          });
        }

        if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) {
          onEvent({
            type: 'tool_call_delta',
            delta: delta.tool_calls as unknown as Record<string, unknown>[],
            provider: this.config.provider,
            model: this.model
          });
        }

        if (chunk.usage) {
          onEvent({
            type: 'usage_delta',
            usage: {
              prompt_tokens: chunk.usage.prompt_tokens,
              completion_tokens: chunk.usage.completion_tokens,
              total_tokens: chunk.usage.total_tokens
            },
            provider: this.config.provider,
            model: this.model
          });
        }
      }

      onEvent({
        type: 'completed',
        provider: this.config.provider,
        model: this.model
      });
    } catch (error) {
      onEvent({
        type: 'failed',
        error: normalizeOpenAICompatibleError(this.config.provider, 'stream', error).message,
        provider: this.config.provider,
        model: this.model
      });
      throw normalizeOpenAICompatibleError(this.config.provider, 'stream', error);
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list({
        timeout: 5000
      });
      return response.data.map((model) => model.id);
    } catch (error) {
      throw normalizeOpenAICompatibleError(this.config.provider, 'models', error);
    }
  }

  private formatMessages(messages: ChatMessage[]) {
    let lastToolCalls: Record<string, unknown>[] = [];

    return messages.map((message) => {
      if (message.role === 'assistant' && message.tool_calls) {
        lastToolCalls = message.tool_calls;
        return message;
      }

      if (message.role === 'tool') {
        let callId = message.tool_call_id;
        if (!callId && lastToolCalls.length > 0) {
          const matchedCall = lastToolCalls.find(
            (call) => (call.function as { name?: string } | undefined)?.name === message.name
          );
          callId = typeof matchedCall?.id === 'string'
            ? matchedCall.id
            : typeof lastToolCalls[0]?.id === 'string'
              ? lastToolCalls[0].id
              : undefined;
        }

        return {
          role: message.role,
          content: message.content,
          tool_call_id: callId || `call_${Math.random().toString(36).slice(2)}`
        };
      }

      return message;
    });
  }

  private formatTools(tools?: ToolDefinition[]) {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.toJsonSchema(tool.parameters)
      }
    }));
  }

  private toJsonSchema(parameters: ToolDefinition['parameters']): Record<string, unknown> {
    try {
      const schema = z.toJSONSchema(parameters) as Record<string, unknown>;
      const jsonSchema = { ...schema };
      delete jsonSchema.$schema;
      if (typeof jsonSchema.type !== 'string') {
        return { type: 'object', properties: {}, additionalProperties: true };
      }
      return jsonSchema;
    } catch {
      return { type: 'object', properties: {}, additionalProperties: true };
    }
  }
}

export class AnthropicNativeProvider implements LLMProvider {
  readonly config: LLMConfig;
  readonly adapter = ANTHROPIC_DESCRIPTOR;

  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: LLMConfig) {
    const normalizedBaseUrl = config.baseUrl ? normalizeBaseUrl(config.baseUrl) : resolveDefaultBaseUrl(config.provider);
    if (!normalizedBaseUrl) {
      throw buildProviderError(config.provider);
    }

    this.config = {
      ...config,
      baseUrl: normalizedBaseUrl
    };
    this.model = config.model;
    this.baseUrl = normalizedBaseUrl;
  }

  getCapabilities(): LLMProviderCapabilities {
    return createAnthropicCapabilities();
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.requestJson<AnthropicMessageResponse>('/messages', {
      method: 'POST',
      body: JSON.stringify(this.buildAnthropicRequestBody(request))
    });

    const normalizedMessage = this.normalizeAnthropicResponseMessage(response);
    return {
      message: normalizedMessage,
      provider: this.config.provider,
      model: this.model,
      usage: normalizedMessage.usage,
      finishReason: response.stop_reason || undefined,
      raw: response
    };
  }

  async chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatMessage> {
    const response = await this.complete({
      messages,
      tools
    });
    return response.message;
  }

  async stream(request: LLMRequest, onEvent: (event: LLMStreamEvent) => void): Promise<void> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        ...this.buildAnthropicRequestBody(request),
        stream: true
      })
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      const error = new Error(`Anthropic stream failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      onEvent({
        type: 'failed',
        error: error.message,
        provider: this.config.provider,
        model: this.model
      });
      throw error;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    const reader = response.body.getReader();

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        const value = result.value;
        if (!value) {
          continue;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const parsedEvent = this.parseSseEvent(part);
          if (!parsedEvent?.data) {
            continue;
          }
          const payload = JSON.parse(parsedEvent.data) as Record<string, unknown>;

          if (parsedEvent.event === 'content_block_delta') {
            const delta = payload.delta as Record<string, unknown> | undefined;
            if (typeof delta?.text === 'string' && delta.text.length > 0) {
              onEvent({
                type: 'assistant_delta',
                delta: delta.text,
                provider: this.config.provider,
                model: this.model
              });
            }
            if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              const index = typeof payload.index === 'number' ? payload.index : 0;
              const contentBlock = payload.content_block as Record<string, unknown> | undefined;
              const toolId = typeof contentBlock?.id === 'string' ? contentBlock.id : `tool_${index}`;
              const toolName = typeof contentBlock?.name === 'string' ? contentBlock.name : 'unknown';
              onEvent({
                type: 'tool_call_delta',
                delta: [{
                  id: toolId,
                  type: 'function',
                  function: {
                    name: toolName,
                    arguments: delta.partial_json
                  }
                }],
                provider: this.config.provider,
                model: this.model
              });
            }
          }

          if (parsedEvent.event === 'message_delta') {
            const usage = payload.usage as Record<string, unknown> | undefined;
            if (usage) {
              const promptTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
              const completionTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
              onEvent({
                type: 'usage_delta',
                usage: {
                  prompt_tokens: promptTokens,
                  completion_tokens: completionTokens,
                  total_tokens: promptTokens + completionTokens
                },
                provider: this.config.provider,
                model: this.model
              });
            }
          }

          if (parsedEvent.event === 'message_stop') {
            onEvent({
              type: 'completed',
              provider: this.config.provider,
              model: this.model
            });
          }
        }
      }
    } catch (error) {
      onEvent({
        type: 'failed',
        error: error instanceof Error ? error.message : 'Unknown stream error',
        provider: this.config.provider,
        model: this.model
      });
      throw error;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.requestJson<{ data?: Array<{ id?: string }> }>('/models', {
        method: 'GET'
      });
      return Array.isArray(response.data)
        ? response.data.map((model) => model.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
    } catch (error) {
      console.warn(`[ANTHROPIC Provider] Failed to list models: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  private buildAnthropicRequestBody(request: LLMRequest) {
    const systemPrompt = request.messages
      .filter((message) => message.role === 'system' && message.content.trim().length > 0)
      .map((message) => message.content.trim())
      .join('\n\n');

    const messages = this.normalizeAnthropicMessages(request.messages);
    return {
      model: this.model,
      max_tokens: request.generationConfig?.maxOutputTokens ?? 4096,
      messages,
      system: systemPrompt || undefined,
      tools: this.formatAnthropicTools(request.tools),
      temperature: request.generationConfig?.temperature,
      top_p: request.generationConfig?.topP,
      stop_sequences: request.generationConfig?.stop
    };
  }

  private normalizeAnthropicMessages(messages: ChatMessage[]): AnthropicRequestMessage[] {
    const normalizedMessages: AnthropicRequestMessage[] = [];
    let lastAssistantToolCalls: Record<string, unknown>[] = [];

    for (const message of messages) {
      if (message.role === 'system') {
        continue;
      }

      if (message.role === 'assistant') {
        const contentBlocks: Array<Record<string, unknown>> = [];
        if (message.content) {
          contentBlocks.push({
            type: 'text',
            text: message.content
          });
        }

        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          lastAssistantToolCalls = message.tool_calls;
          for (const toolCall of message.tool_calls) {
            const toolId = typeof toolCall.id === 'string' ? toolCall.id : `tool_${Math.random().toString(36).slice(2)}`;
            const fn = toolCall.function as { name?: string; arguments?: string } | undefined;
            contentBlocks.push({
              type: 'tool_use',
              id: toolId,
              name: fn?.name || 'unknown',
              input: this.parseJsonObject(fn?.arguments)
            });
          }
        }

        if (contentBlocks.length > 0) {
          normalizedMessages.push({
            role: 'assistant',
            content: contentBlocks
          });
        }
        continue;
      }

      if (message.role === 'tool') {
        const fallbackToolUse = lastAssistantToolCalls.find((call) => {
          const fn = call.function as { name?: string } | undefined;
          return typeof fn?.name === 'string' && fn.name === message.name;
        });
        normalizedMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: message.tool_call_id || (typeof fallbackToolUse?.id === 'string' ? fallbackToolUse.id : `tool_${Math.random().toString(36).slice(2)}`),
            content: message.content
          }]
        });
        continue;
      }

      normalizedMessages.push({
        role: 'user',
        content: message.content
      });
    }

    return normalizedMessages;
  }

  private normalizeAnthropicResponseMessage(response: AnthropicMessageResponse): ChatMessage {
    const contentBlocks = Array.isArray(response.content) ? response.content : [];
    const textParts = contentBlocks
      .filter((block): block is Extract<AnthropicResponseContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text);
    const toolCalls = contentBlocks
      .filter((block): block is Extract<AnthropicResponseContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {})
        }
      }));

    const promptTokens = response.usage?.input_tokens || 0;
    const completionTokens = response.usage?.output_tokens || 0;

    return {
      role: 'assistant',
      content: textParts.join('\n'),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      model: this.model,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    };
  }

  private formatAnthropicTools(tools?: ToolDefinition[]) {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: this.toJsonSchema(tool.parameters)
    }));
  }

  private async requestJson<T>(pathname: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: this.createHeaders(init.headers)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Anthropic request failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
    }

    return await response.json() as T;
  }

  private createHeaders(extraHeaders?: HeadersInit): HeadersInit {
    return {
      'content-type': 'application/json',
      'x-api-key': this.config.apiKey || '',
      'anthropic-version': '2023-06-01',
      ...extraHeaders
    };
  }

  private parseJsonObject(value: string | undefined): Record<string, unknown> {
    if (!value) {
      return {};
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  private parseSseEvent(part: string): { event?: string; data?: string } | null {
    const lines = part
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return null;
    }
    const eventLine = lines.find((line) => line.startsWith('event:'));
    const dataLines = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
    return {
      event: eventLine?.slice(6).trim(),
      data: dataLines.join('\n')
    };
  }

  private toJsonSchema(parameters: ToolDefinition['parameters']): Record<string, unknown> {
    try {
      const schema = z.toJSONSchema(parameters) as Record<string, unknown>;
      const jsonSchema = { ...schema };
      delete jsonSchema.$schema;
      if (typeof jsonSchema.type !== 'string') {
        return { type: 'object', properties: {}, additionalProperties: true };
      }
      return jsonSchema;
    } catch {
      return { type: 'object', properties: {}, additionalProperties: true };
    }
  }
}

class UnsupportedNativeProvider implements LLMProvider {
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

type ProviderFactoryEntry = {
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

function createDefaultProviderRegistry() {
  const registry = new ProviderRegistry();

  registry.register({
    id: 'openai-compatible',
    descriptor: OPENAI_COMPATIBLE_DESCRIPTOR,
    supports: (config) => OPENAI_COMPATIBLE_PROVIDERS.has(config.provider),
    create: (config) => new OpenAICompatibleProvider(config)
  });

  registry.register({
    id: 'anthropic-native',
    descriptor: ANTHROPIC_DESCRIPTOR,
    supports: (config) => config.provider === 'anthropic',
    create: (config) => new AnthropicNativeProvider(config)
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

export const OpenAIProvider = OpenAICompatibleProvider;
