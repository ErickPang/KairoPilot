import { OpenAI } from 'openai';
import {toolSchemas} from '../../context/requestBudget';
import fs from 'node:fs/promises';
import type { ChatMessage, LLMConfig, LLMProvider, LLMProviderCapabilities, LLMRequest, LLMResponse, LLMStreamEvent, ToolDefinition } from '../types';
import { shouldAllowBrowserLikeLlmRuntime } from '../provider';
import {
  normalizeBaseUrl,
  resolveDefaultBaseUrl,
  resolveOpenAICompatibleApiKey,
  normalizeOpenAICompatibleError,
  shouldRetryOpenAIStreamWithoutUsageOptions,
  buildProviderError,
  OPENAI_COMPATIBLE_DESCRIPTOR,
  createOpenAICompatibleCapabilities,
} from '../utils';

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
      maxRetries: config.maxRetries,
      apiKey: resolvedApiKey,
      baseURL: normalizedBaseUrl,
      dangerouslyAllowBrowser: shouldAllowBrowserLikeLlmRuntime()
    });
  }

  getCapabilities(): LLMProviderCapabilities {
    return {...createOpenAICompatibleCapabilities(),contextWindowTokens:this.config.contextWindowTokens};
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    try {
      const messages = await this.formatMessages(request.messages);
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as unknown as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
        tools: this.formatTools(request.tools),
        temperature: request.generationConfig?.temperature,
        top_p: request.generationConfig?.topP,
        stop: request.generationConfig?.stop,
        max_tokens: request.generationConfig?.maxOutputTokens
      }, {signal:request.signal});

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
      const messages = await this.formatMessages(request.messages);
      const basePayload = {
        model: this.model,
        messages: messages as unknown as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
        tools: this.formatTools(request.tools),
        temperature: request.generationConfig?.temperature,
        top_p: request.generationConfig?.topP,
        stop: request.generationConfig?.stop,
        max_tokens: request.generationConfig?.maxOutputTokens,
        stream: true
      };
      const requestOptions = {
        signal: request.signal
      };
      let response: AsyncIterable<{
        choices: Array<{ delta?: { content?: unknown; tool_calls?: unknown } }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        } | null;
      }>;

      try {
        response = await this.client.chat.completions.create({
          ...basePayload,
          stream_options: {
            include_usage: true
          }
        }, requestOptions) as typeof response;
      } catch (error) {
        if (!shouldRetryOpenAIStreamWithoutUsageOptions(error)) {
          throw error;
        }
        response = await this.client.chat.completions.create(basePayload, requestOptions) as typeof response;
      }

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

  private async formatMessages(messages: ChatMessage[]) {
    let lastToolCalls: Record<string, unknown>[] = [];
    const formattedMessages: Array<ChatMessage | Record<string, unknown>> = [];

    for (const message of messages) {
      if (message.role === 'assistant' && message.tool_calls) {
        lastToolCalls = message.tool_calls;
        formattedMessages.push(message);
        continue;
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

        formattedMessages.push({
          role: message.role,
          content: message.content,
          tool_call_id: callId || `call_${Math.random().toString(36).slice(2)}`
        });
        continue;
      }

      if (message.role === 'user' && Array.isArray(message.attachments) && message.attachments.some((attachment) => attachment.kind === 'image')) {
        const content: Array<Record<string, unknown>> = [];
        if (message.content) {
          content.push({ type: 'text', text: message.content });
        }
        for (const attachment of message.attachments.filter((item) => item.kind === 'image')) {
          try {
            const data = (await fs.readFile(attachment.storedPath)).toString('base64');
            content.push({
              type: 'image_url',
              image_url: {
                url: `data:${attachment.mimeType || 'image/png'};base64,${data}`
              }
            });
          } catch {
            continue;
          }
        }
        formattedMessages.push({
          role: 'user',
          content
        });
        continue;
      }

      formattedMessages.push(message);
    }

    return formattedMessages;
  }

  private formatTools(tools?: ToolDefinition[]) {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return toolSchemas(tools);
  }
}
