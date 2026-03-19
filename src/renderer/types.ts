export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'thinking';
  content: string;
  details?: any;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface LegacyAgentConfig {
  provider: 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen';
  apiKey: string;
  baseUrl: string;
  model: string;
  workspace: string;
  systemPrompt: string;
  enableShell: boolean;
  allowedPaths: string[];
  allowedCommands: string[];
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  workspace: string;
  systemPrompt: string;
  modelConfigId: string;
  allowedPaths: string[];
  allowedCommands: string[];
  enableShell: boolean;
}

export interface SystemStats {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuUsage: number;
  memoryUsage: number;
  totalMemory: string;
  uptime: number;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  tool: string;
  args: any;
  result?: any;
  error?: string;
  sessionId?: string;
}
