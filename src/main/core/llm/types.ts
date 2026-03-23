import { z } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string; // For tool outputs
  tool_call_id?: string; // Essential for OpenAI tool responses
  tool_calls?: Record<string, unknown>[]; // For function calling
  timestamp?: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMConfig {
  provider: 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen' | 'custom';
  apiKey?: string;
  baseUrl?: string; // Essential for Ollama (e.g., http://localhost:11434)
  model: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodSchema; // Using Zod for strict typing
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface LLMProvider {
  chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatMessage>;
  stream?(messages: ChatMessage[], onChunk: (chunk: string) => void): Promise<void>;
  listModels?(): Promise<string[]>;
}
