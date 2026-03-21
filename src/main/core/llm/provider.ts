import { OpenAI } from 'openai';
import { LLMProvider, ChatMessage, ToolDefinition, LLMConfig } from './types';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private providerName: string;

  constructor(config: LLMConfig) {
    this.providerName = config.provider;
    let baseURL = config.baseUrl;
    if (!baseURL) {
      switch (config.provider) {
        case 'ollama': 
          baseURL = 'http://localhost:11434/v1'; 
          break;
        case 'deepseek': 
          baseURL = 'https://api.deepseek.com/v1'; 
          break;
        case 'zhipu': 
          baseURL = 'https://open.bigmodel.cn/api/paas/v4'; 
          break;
        case 'kimi': 
          baseURL = 'https://api.moonshot.cn/v1'; 
          break;
        case 'qianwen': 
          baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'; 
          break;
        case 'openai':
        default: 
          baseURL = 'https://api.openai.com/v1'; 
          break;
      }
    }

    this.client = new OpenAI({
      apiKey: config.apiKey || 'ollama', // Ollama needs a dummy key
      baseURL: baseURL,
      dangerouslyAllowBrowser: true // Electron main process is node, but just in case
    });
    this.model = config.model;
  }

  async chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatMessage> {
    const openaiTools = tools?.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as unknown as Record<string, unknown> 
      }
    }));

    // Keep track of the last assistant message's tool calls to repair broken history
    let lastToolCalls: Record<string, unknown>[] = [];

    const formattedMessages = messages.map(msg => {
      if (msg.role === 'assistant' && msg.tool_calls) {
        lastToolCalls = msg.tool_calls;
        return msg;
      }
      if (msg.role === 'tool') {
        // Try to recover missing tool_call_id from the last assistant message
        let callId = msg.tool_call_id;
        if (!callId && lastToolCalls.length > 0) {
          const matchedCall = lastToolCalls.find(
            (call: Record<string, unknown>) => (call.function as { name: string })?.name === msg.name
          );
          if (matchedCall) {
            callId = matchedCall.id as string;
          } else {
            callId = lastToolCalls[0].id as string;
          }
        }
        
        return {
          role: msg.role,
          content: msg.content,
          name: msg.name,
          // Fallback to a generated ID to prevent API serialization errors
          tool_call_id: callId || `call_${Math.random().toString(36).substring(2)}`
        };
      }
      return msg;
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: formattedMessages as unknown as Parameters<typeof this.client.chat.completions.create>[0]['messages'],
      tools: openaiTools && openaiTools.length > 0 ? openaiTools : undefined,
    });

    const choice = response.choices[0];
    const message = choice.message;

    return {
      role: message.role,
      content: message.content || '',
      tool_calls: message.tool_calls as unknown as Record<string, unknown>[],
      usage: response.usage ? {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens
      } : undefined
    };
  }

  async listModels(): Promise<string[]> {
    try {
      // Add a short timeout for listing models to prevent UI hanging
      const response = await this.client.models.list({
        timeout: 5000
      });
      return response.data.map(model => model.id);
    } catch (error) {
        // Log a simplified warning instead of full stack trace
        console.warn(`[${this.providerName.toUpperCase()} Provider] Failed to list models: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }
}
