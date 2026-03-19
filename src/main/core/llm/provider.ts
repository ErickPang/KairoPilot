import { OpenAI } from 'openai';
import { LLMProvider, ChatMessage, ToolDefinition, LLMConfig } from './types';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: LLMConfig) {
    let baseURL = config.baseUrl;
    if (!baseURL) {
      switch (config.provider) {
        case 'ollama': 
          baseURL = 'http://localhost:11434/v1'; 
          break;
        case 'deepseek': 
          baseURL = 'https://api.deepseek.com'; 
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
        // Zod schema needs to be converted to JSON Schema for OpenAI
        // For simplicity, we assume tools handle their own schema conversion or we use a library like zod-to-json-schema
        // But OpenAI SDK helper `zodFunction` is deprecated in favor of manual definition or other helpers.
        // Let's use a simplified approach for now: passing parameters as any, assuming it's JSON Schema compatible
        // In a real implementation, we should use `zod-to-json-schema`
        parameters: (tool.parameters as any) 
      }
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as any,
      tools: openaiTools && openaiTools.length > 0 ? openaiTools : undefined,
    });

    const choice = response.choices[0];
    const message = choice.message;

    return {
      role: message.role,
      content: message.content || '',
      tool_calls: message.tool_calls
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map(model => model.id);
    } catch (error) {
      console.error('Failed to list models:', error);
      return [];
    }
  }
}
