import { z } from 'zod';
import type { ChatAttachment, ProviderType } from '../../../shared/contracts';

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Record<string, unknown>[];
  timestamp?: number;
  model?: string;
  usage?: LLMUsage;
  attachments?: ChatAttachment[];
  references?: import('../../../shared/contracts').ContextReference[];
}

export interface LLMConfig {
  provider: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxRetries?: number;
  contextWindowTokens?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  parametersJsonSchema?: Record<string, unknown>;
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
  metadata?: {
    source?: 'builtin' | 'plugin' | 'skill';
    pluginId?: string;
    pluginName?: string;
    pluginScope?: string;
    originalToolName?: string;
    pluginConnectionId?: string;
    pluginPackageHash?: string;
    pluginCatalogHash?: string;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  };
}

export type LLMProviderProtocol = 'openai-compatible' | 'native';

export interface LLMProviderCapabilities {
  chat: boolean;
  stream: boolean;
  toolCalling: boolean;
  modelListing: boolean;
  structuredOutput: boolean;
  multimodalInput: boolean;
  protocol: LLMProviderProtocol;
  /** 模型上下文窗口大小（tokens），用于动态调整上下文预算。 */
  contextWindowTokens?: number;
}

export interface LLMGenerationConfig {
  temperature?: number;
  topP?: number;
  stop?: string[];
  maxOutputTokens?: number;
}

export interface LLMRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  generationConfig?: LLMGenerationConfig;
  responseFormat?: 'text' | 'json';
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LLMResponse {
  message: ChatMessage;
  provider: ProviderType;
  model: string;
  usage?: LLMUsage;
  finishReason?: string;
  raw?: unknown;
}

export type LLMStreamEvent =
  | {
      type: 'assistant_delta';
      delta: string;
      provider: ProviderType;
      model: string;
    }
  | {
      type: 'tool_call_delta';
      delta: Record<string, unknown>[];
      provider: ProviderType;
      model: string;
    }
  | {
      type: 'usage_delta';
      usage: Partial<LLMUsage>;
      provider: ProviderType;
      model: string;
    }
  | {
      type: 'completed';
      provider: ProviderType;
      model: string;
    }
  | {
      type: 'failed';
      error: string;
      provider: ProviderType;
      model: string;
    };

export interface LLMProviderAdapterDescriptor {
  id: string;
  displayName: string;
  protocol: LLMProviderProtocol;
}

export interface LLMProvider {
  readonly config: LLMConfig;
  readonly adapter: LLMProviderAdapterDescriptor;
  getCapabilities(): LLMProviderCapabilities;
  complete(request: LLMRequest): Promise<LLMResponse>;
  chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatMessage>;
  stream?(request: LLMRequest, onEvent: (event: LLMStreamEvent) => void): Promise<void>;
  listModels?(): Promise<string[]>;
}
