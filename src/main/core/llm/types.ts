import { z } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string; // For tool outputs
  tool_call_id?: string; // Essential for OpenAI tool responses
  tool_calls?: any[]; // For function calling
  timestamp?: number;
}

export interface LLMConfig {
  provider: 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen';
  apiKey?: string;
  baseUrl?: string; // Essential for Ollama (e.g., http://localhost:11434)
  model: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodSchema; // Using Zod for strict typing
  execute: (args: any) => Promise<any>;
}

export interface LLMProvider {
  chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatMessage>;
  stream?(messages: ChatMessage[], onChunk: (chunk: string) => void): Promise<void>;
  listModels?(): Promise<string[]>;
}
